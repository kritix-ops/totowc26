import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { CalendarX2, ChevronLeft, ChevronRight } from "lucide-react";
import { hasLocale, type Locale } from "../../dictionaries";
import { db } from "@/db";
import { execRows } from "@/db/helpers";
import { settings } from "@/db/schema";
import { Card } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import { requireAdmin } from "@/lib/admin";
import type { CancelResolutionConfig } from "@/lib/matches/cancel";
import { MatchStatusCard, type AdminMatchRow } from "./MatchStatusCard";
import { AdvanceTeamCard, type AdvanceMatchRow } from "./AdvanceTeamCard";

// Admin surface for handling a match that is called off. FULL-admin only
// (gated again here on top of the action-level check) because canceling a
// match rewrites every player's 1/X/2 scoring, not just live bets.
// See _plans/2026-06-22-match-cancel-postpone-admin.md.
export default async function AdminMatchesPage({
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

  const [settingsRow, rows, advanceRows] = await Promise.all([
    db
      .select({ cancelSplitDefaultPoints: settings.cancelSplitDefaultPoints })
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1),
    // Everything not yet final: upcoming + live + the special holding states
    // (postponed / canceled). Final matches are already scored and have no
    // status actions, so they are excluded to keep the list focused.
    execRows<{
      id: string;
      kickoffAt: string;
      stage: string;
      status: string;
      cancelResolution: string | null;
      cancelResolutionConfig: CancelResolutionConfig;
      homeHe: string;
      homeEn: string;
      awayHe: string;
      awayEn: string;
      guessCount: number;
      liveBetCount: number;
    }>(sql`
      select
        m.id::text                  as "id",
        m.kickoff_at::text          as "kickoffAt",
        m.stage::text               as "stage",
        m.status::text              as "status",
        m.cancel_resolution::text   as "cancelResolution",
        m.cancel_resolution_config  as "cancelResolutionConfig",
        ht.name_he                  as "homeHe",
        ht.name_en                  as "homeEn",
        at.name_he                  as "awayHe",
        at.name_en                  as "awayEn",
        (select count(*) from public.match_bets mb where mb.match_id = m.id)::int as "guessCount",
        (select count(*) from public.custom_bets cb
          where cb.match_id = m.id and cb.scope = 'match')::int as "liveBetCount"
      from public.matches m
      join public.teams ht on ht.code = m.home_team
      join public.teams at on at.code = m.away_team
      where m.status <> 'final'
      order by m.kickoff_at asc
    `),
    // Final knockout matches: surfaced so an admin can correct the "who
    // advances?" result the auto-grader recorded (or set it when the feed
    // couldn't). Group matches have no advancement, so they're excluded.
    execRows<{
      id: string;
      stage: string;
      kickoffAt: string;
      homeCode: string;
      awayCode: string;
      homeHe: string;
      homeEn: string;
      awayHe: string;
      awayEn: string;
      advancingTeam: string | null;
      advancePickCount: number;
    }>(sql`
      select
        m.id::text                  as "id",
        m.stage::text               as "stage",
        m.kickoff_at::text          as "kickoffAt",
        m.home_team                 as "homeCode",
        m.away_team                 as "awayCode",
        ht.name_he                  as "homeHe",
        ht.name_en                  as "homeEn",
        at.name_he                  as "awayHe",
        at.name_en                  as "awayEn",
        m.advancing_team            as "advancingTeam",
        (select count(*) from public.match_advance_bets ab
          where ab.match_id = m.id)::int as "advancePickCount"
      from public.matches m
      join public.teams ht on ht.code = m.home_team
      join public.teams at on at.code = m.away_team
      where m.status = 'final' and m.stage <> 'group'
      order by m.kickoff_at desc
    `),
  ]);

  const splitDefault = settingsRow[0]?.cancelSplitDefaultPoints ?? 0;

  const matches: AdminMatchRow[] = rows.map((m) => ({
    id: m.id,
    homeName: isHebrew ? m.homeHe : m.homeEn,
    awayName: isHebrew ? m.awayHe : m.awayEn,
    kickoffIso: m.kickoffAt,
    kickoffLabel: formatDateTime(m.kickoffAt, locale, {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    stage: m.stage,
    status: m.status as AdminMatchRow["status"],
    cancelResolution: m.cancelResolution as AdminMatchRow["cancelResolution"],
    cancelResolutionConfig: m.cancelResolutionConfig,
    guessCount: m.guessCount,
    liveBetCount: m.liveBetCount,
  }));

  const advanceMatches: AdvanceMatchRow[] = advanceRows.map((m) => ({
    id: m.id,
    homeName: isHebrew ? m.homeHe : m.homeEn,
    awayName: isHebrew ? m.awayHe : m.awayEn,
    homeCode: m.homeCode,
    awayCode: m.awayCode,
    stage: m.stage,
    kickoffLabel: formatDateTime(m.kickoffAt, locale, {
      day: "2-digit",
      month: "2-digit",
    }),
    advancingTeam: m.advancingTeam,
    advancePickCount: m.advancePickCount,
  }));

  return (
    <section className="px-4 md:px-10 py-6 md:py-10 flex flex-col gap-6 max-w-3xl mx-auto w-full pb-24 md:pb-12">
      <header className="flex flex-col gap-2">
        <Link
          href={localePath(locale, "admin")}
          className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary self-start"
        >
          <ChevronBack className="h-4 w-4" />
          {isHebrew ? "חזרה לדף הניהול" : "Back to admin"}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[24px] leading-8 md:text-[36px] md:leading-[40px] font-bold text-primary inline-flex items-center gap-3">
          <CalendarX2 className="h-6 w-6 md:h-8 md:w-8" strokeWidth={1.75} />
          {isHebrew ? "ניהול משחקים" : "Match management"}
        </h1>
        <p className="text-base text-on-surface-variant">
          {isHebrew
            ? "טיפול במשחק שנדחה או בוטל. דחייה מקפיאה הכל עד שתקבע מועד חדש. ביטול מחזיר מיד את כל הלייבים על המשחק, ומחכה להחלטה שלך איך לסגור את ניחושי התוצאה — בלי ניקוד עד אז."
            : "Handle a postponed or canceled match. Postpone freezes everything until you set a new kickoff. Cancel immediately refunds the match's live bets and waits for your decision on how the 1/X/2 guesses settle — no scoring until then."}
        </p>
      </header>

      <Card className="p-4 md:p-5 bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
        <p className="text-sm">
          <strong className="block mb-1">
            {isHebrew ? "איך זה עובד" : "How it works"}
          </strong>
          {isHebrew
            ? "ביטול אף פעם לא מוריד נקודות על ניחוש שגוי — אי אפשר לחזות ביטול. אפשרויות הסגירה: ביטול מלא (החזר, אפס נקודות), תוצאה טכנית (ניקוד מול תוצאה שתקבע), או חלוקת נקודות שווה לכולם."
            : "Canceling never deducts points for a wrong guess — a cancellation can't be predicted. Settlement options: full void (refund, zero points), a technical result (graded vs a score you set), or an equal split to everyone."}
        </p>
      </Card>

      {matches.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew
            ? "אין משחקים פעילים לטיפול."
            : "No active matches to manage."}
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {matches.map((m) => (
            <li key={m.id}>
              <MatchStatusCard
                locale={locale}
                match={m}
                splitDefaultPoints={splitDefault}
              />
            </li>
          ))}
        </ul>
      )}

      {advanceMatches.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface mt-2">
            {isHebrew ? "תוצאות 'מי עולה' (נוקאאוט)" : "\"Who advances\" results (knockout)"}
          </h2>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "התוצאה נקבעת אוטומטית מהמנצח בפועל (כולל הארכות ופנדלים). כאן אפשר לתקן ידנית — תיקון מאפס ומדרג מחדש את ניחושי 'מי עולה' של המשחק."
              : "Set automatically from the actual winner (incl. extra time & penalties). Correct it here — a correction resets and re-grades this match's \"who advances\" picks."}
          </p>
          <ul className="flex flex-col gap-3">
            {advanceMatches.map((m) => (
              <li key={m.id}>
                <AdvanceTeamCard locale={locale} match={m} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
