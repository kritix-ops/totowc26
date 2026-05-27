import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/db";
import {
  BET_TYPE_KEYS,
  betLockDefaults,
  settings,
  type BetTypeKey,
} from "@/db/schema";
import { Card } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { FALLBACK_OFFSET_MINUTES } from "@/lib/deadlines";
import { DeadlinesForm } from "./DeadlinesForm";

// Per-day earliest kickoff lives on matches.kickoff_at (UTC) but the
// matchday is keyed by Asia/Jerusalem date - so we group by the Israel
// date to find the right anchor per day. Used purely for display ("היום
// הזה מתחיל ב-19:00") so a missing row is fine; we render "-".
type MatchdayWithKickoff = {
  id: string;
  date: string;
  label: string | null;
  lockOffsetOverrideMinutes: number | null;
  earliestKickoffAt: string | null;
};

export default async function AdminDeadlinesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  await requireAdmin(locale);
  const isHebrew = locale === "he";
  const ChevronBack = isHebrew ? ChevronRight : ChevronLeft;

  const [defaultsRows, settingsRow, matchdayRows, derivedRow, matchRows] =
    await Promise.all([
      db
        .select({
          betType: betLockDefaults.betType,
          offsetMinutes: betLockDefaults.offsetMinutes,
        })
        .from(betLockDefaults),
      db
        .select({ tournamentStartAt: settings.tournamentStartAt })
        .from(settings)
        .where(eq(settings.id, 1))
        .limit(1),
      db.execute<MatchdayWithKickoff>(sql`
        select
          md.id::text as id,
          to_char(md.date, 'YYYY-MM-DD') as date,
          md.label,
          md.lock_offset_override_minutes,
          (
            select min(m.kickoff_at)
            from public.matches m
            where (m.kickoff_at at time zone 'Asia/Jerusalem')::date = md.date
          )::text as "earliestKickoffAt"
        from public.matchdays md
        order by md.date asc
      `),
      db.execute<{ kickoff_at: string | null }>(sql`
        select min(kickoff_at) as kickoff_at from public.matches
      `),
      // Upcoming + currently-live fixtures only - past matches are
      // irrelevant for a deadline override and would bloat the list.
      db.execute<{
        id: string;
        kickoff_at: string;
        lock_at_override: string | null;
        home_team: string;
        away_team: string;
        stage: string;
      }>(sql`
        select
          m.id::text as id,
          m.kickoff_at,
          m.lock_at_override,
          m.home_team,
          m.away_team,
          m.stage::text as stage
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

  const tournamentStartAt = settingsRow[0]?.tournamentStartAt ?? null;
  const derivedRaw =
    (derivedRow as unknown as Array<{ kickoff_at: string | null }>)[0]
      ?.kickoff_at ?? null;
  const matchdays = (matchdayRows as unknown as MatchdayWithKickoff[]).map((m) => ({
    ...m,
    // Re-cast the snake-cased column drizzle returns from raw SQL so
    // the client form receives a clean shape.
    lockOffsetOverrideMinutes:
      (m as unknown as { lock_offset_override_minutes: number | null })
        .lock_offset_override_minutes ?? null,
  }));
  const matchesList = (
    matchRows as unknown as Array<{
      id: string;
      kickoff_at: string;
      lock_at_override: string | null;
      home_team: string;
      away_team: string;
      stage: string;
    }>
  ).map((m) => ({
    id: m.id,
    kickoffAt: m.kickoff_at,
    lockAtOverride: m.lock_at_override,
    homeTeam: m.home_team,
    awayTeam: m.away_team,
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
          {isHebrew ? "חזרה לניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <Clock className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "מועדי סגירת הימורים" : "Betting deadlines"}
        </h1>
        <p className="text-base text-on-surface-variant">
          {isHebrew
            ? "שולט מתי כל סוג הימור נסגר. שלוש שכבות: ברירת מחדל לפי סוג, דריסה לפי יום הימורים, ודריסה לכל הימור או משחק ספציפי (בעמוד עריכת ההימור)."
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
        initialTournamentStartAt={
          tournamentStartAt ? tournamentStartAt.toISOString() : null
        }
        derivedTournamentStartAt={derivedRaw}
        matchdays={matchdays}
        matches={matchesList}
      />
    </section>
  );
}
