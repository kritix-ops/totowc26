import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { db } from "@/db";
import { execFirstRow, execRows } from "@/db/helpers";
import {
  BET_TYPE_KEYS,
  STAGE_KEYS,
  betLockDefaults,
  settings,
  stageLockDefaults,
  type BetTypeKey,
  type StageKey,
} from "@/db/schema";
import { Card } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { FALLBACK_OFFSET_MINUTES } from "@/lib/deadlines";
import { DeadlinesForm } from "./DeadlinesForm";

// Per-day earliest kickoff lives on matches.kickoff_at (UTC) but the
// matchday is keyed by Asia/Jerusalem date - so we group by the Israel
// date to find the right anchor per day. Used both for display ("היום
// הזה מתחיל ב-19:00") and to pick the stage that this matchday's
// inherit-placeholder shows. earliestStage is null when the matchday
// has no matches yet.
type MatchdayWithKickoff = {
  id: string;
  date: string;
  label: string | null;
  lockOffsetOverrideMinutes: number | null;
  earliestKickoffAt: string | null;
  earliestStage: string | null;
};

export default async function AdminDeadlinesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const [
    defaultsRows,
    stageRows,
    settingsRow,
    matchdayRows,
    derivedRow,
    matchRows,
  ] = await Promise.all([
      db
        .select({
          betType: betLockDefaults.betType,
          offsetMinutes: betLockDefaults.offsetMinutes,
        })
        .from(betLockDefaults),
      db
        .select({
          stage: stageLockDefaults.stage,
          offsetMinutes: stageLockDefaults.offsetMinutes,
        })
        .from(stageLockDefaults),
      db
        .select({
          tournamentStartAt: settings.tournamentStartAt,
          reminderOffsetMinutes: settings.reminderOffsetMinutes,
        })
        .from(settings)
        .where(eq(settings.id, 1))
        .limit(1),
      execRows<MatchdayWithKickoff>(sql`
        select
          md.id::text                                as "id",
          to_char(md.date, 'YYYY-MM-DD')             as "date",
          md.label                                   as "label",
          md.lock_offset_override_minutes            as "lockOffsetOverrideMinutes",
          earliest.kickoff_at::text                  as "earliestKickoffAt",
          earliest.stage::text                       as "earliestStage"
        from public.matchdays md
        left join lateral (
          select m.kickoff_at, m.stage
          from public.matches m
          where (m.kickoff_at at time zone 'Asia/Jerusalem')::date = md.date
          order by m.kickoff_at asc
          limit 1
        ) earliest on true
        order by md.date asc
      `),
      execFirstRow<{ kickoff_at: string | null }>(sql`
        select min(kickoff_at) as kickoff_at from public.matches
      `),
      // Upcoming + currently-live fixtures only - past matches are
      // irrelevant for a deadline override and would bloat the list.
      execRows<{
        id: string;
        kickoffAt: string;
        lockAtOverride: string | null;
        homeTeam: string;
        awayTeam: string;
        stage: string;
      }>(sql`
        select
          m.id::text          as "id",
          m.kickoff_at::text  as "kickoffAt",
          m.lock_at_override  as "lockAtOverride",
          m.home_team         as "homeTeam",
          m.away_team         as "awayTeam",
          m.stage::text       as "stage"
        from public.matches m
        where m.status <> 'final'
        order by m.kickoff_at asc
      `),
    ]);

  // Map per-type defaults to a complete record (fall back when a row
  // is missing - keeps the form usable even if the table was reset).
  const defaultsMap = { ...FALLBACK_OFFSET_MINUTES };
  for (const r of defaultsRows) {
    if ((BET_TYPE_KEYS as readonly string[]).includes(r.betType)) {
      defaultsMap[r.betType as BetTypeKey] = r.offsetMinutes;
    }
  }

  // Sparse stage defaults: only stages with a saved row are present.
  // The form coerces missing keys to "empty" so the admin sees an
  // empty input that means "inherit the type default".
  const stageDefaultsMap: Partial<Record<StageKey, number>> = {};
  for (const r of stageRows) {
    if ((STAGE_KEYS as readonly string[]).includes(r.stage)) {
      stageDefaultsMap[r.stage as StageKey] = r.offsetMinutes;
    }
  }

  const tournamentStartAt = settingsRow[0]?.tournamentStartAt ?? null;
  const derivedRaw = derivedRow?.kickoff_at ?? null;
  const matchdays = matchdayRows;
  const matchesList = matchRows.map((m) => ({
    id: m.id,
    kickoffAt: m.kickoffAt,
    lockAtOverride: m.lockAtOverride,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    stage: m.stage,
  }));

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-3xl mx-auto w-full">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <Clock className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "מועדי סגירת הימורים" : "Betting deadlines"}
        </h1>
        <p className="text-base text-on-surface-variant">
          {isHebrew
            ? "קובע מתי כל סוג הימור נסגר. שלוש שכבות: ברירת מחדל לפי סוג, דריסה לפי יום הימורים, ודריסה לכל הימור או משחק ספציפי (בעמוד עריכת ההימור)."
            : "Decide when each bet type closes. Three layers: per-type default, per-matchday override, and per-bet/per-match override (set on the bet edit page)."}
        </p>
      </header>

      <Card className="p-4 md:p-5 bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
        <p className="text-sm">
          <strong className="block mb-1">
            {isHebrew ? "שים לב" : "Heads up"}
          </strong>
          {isHebrew
            ? "שינוי ברירת המחדל משפיע באופן מיידי על הימורי תוצאה (1/X/2). הימורים מותאמים שכבר נשמרו עם מועד ספציפי לא יושפעו; כדי להחיל את הברירה החדשה עליהם, ערוך את ההימור וסמן 'השתמש בברירת המחדל'."
            : "Changing a default takes effect immediately for score (1/X/2) bets. Existing custom bets keep their snapshotted lock time; to apply the new default, open the bet and tick 'use defaults'."}
        </p>
      </Card>

      <DeadlinesForm
        locale={locale}
        initialDefaults={defaultsMap}
        initialStageDefaults={stageDefaultsMap}
        initialTournamentStartAt={
          tournamentStartAt ? tournamentStartAt.toISOString() : null
        }
        derivedTournamentStartAt={derivedRaw}
        initialReminderOffsetMinutes={
          settingsRow[0]?.reminderOffsetMinutes ?? 60
        }
        matchdays={matchdays}
        matches={matchesList}
      />
    </section>
  );
}
