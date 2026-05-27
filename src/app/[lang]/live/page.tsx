import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Radio, Sparkles, Goal } from "lucide-react";
import { clsx } from "clsx";
import { getDictionary, hasLocale, type Locale } from "../dictionaries";
import { Card, Chip, LabelCaps } from "@/components/ui";
import { Flag } from "@/components/Flag";
import { getRequestUser } from "@/lib/request-user";
import { getLiveMatches, type LiveMatchRow } from "@/db/queries";
import { getMatchEnrichment } from "@/lib/stats";
import type { ApiMatchEvent } from "@/lib/api-football-data";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";

// /[lang]/live - in-play scoreboard + projected earnings.
//
// Server-rendered with a short revalidate window so the page picks
// up fresh scores from the regular sync cron without any client-side
// polling. The page reads from matches.home_score / away_score, which
// the existing sync.ts loop keeps current.
//
// For each in-play match the user's pick is overlaid alongside the
// live score so they can see whether their stake is on-track. The
// projected payout uses the same scoring rules the grader will apply
// when the match goes final.

// Re-fetch the page every 30 seconds so the live scoreboard reflects
// the latest sync run without forcing the user to refresh.
export const revalidate = 30;

type ScoringConfig = {
  scoringExact: number;
  scoringOutcome: number;
  matchRiskEnabled: boolean;
  matchRiskPenalty: number;
};

export default async function LiveMatchesPage({
  params,
}: PageProps<"/[lang]/live">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const locale = lang as Locale;
  const dict = await getDictionary(locale);

  const user = await getRequestUser();
  if (!user) redirect(localePath(locale, "login"));

  const [matches, scoring] = await Promise.all([
    getLiveMatches(user.id),
    loadScoringConfig(),
  ]);

  const liveCount = matches.filter((m) => m.status === "live").length;

  // Only pull events for matches that are actually live. The wrapper
  // caches 30s in live mode, so worst-case 4 simultaneous matches × 2
  // refreshes/min = 8 calls/min = well within budget. Final matches
  // keep their goals visible from the DB score, no need to hit API.
  const liveEvents = await loadLiveEvents(matches);

  return (
    <section className="px-4 md:px-16 py-6 md:py-12 flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full pb-24">
      <header className="flex flex-col gap-2">
        <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 md:text-[40px] md:leading-[44px] font-bold text-primary inline-flex items-center gap-3">
          <Radio
            className={clsx(
              "h-6 w-6 md:h-7 md:w-7",
              liveCount > 0 ? "text-error animate-pulse" : "text-on-surface",
            )}
            strokeWidth={1.75}
          />
          {dict.live.liveTitle}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {liveCount > 0
            ? dict.live.liveSubtitleWithCount.replace(
                "{n}",
                String(liveCount),
              )
            : dict.live.liveSubtitleEmpty}
        </p>
        <p className="text-[11px] text-on-surface-variant inline-flex items-center gap-1">
          <Sparkles className="h-3 w-3" strokeWidth={2} />
          {dict.live.refreshHint}
        </p>
      </header>

      {matches.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {dict.live.liveEmpty}
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {matches.map((m) => (
            <li key={m.id}>
              <LiveMatchCard
                locale={locale}
                match={m}
                scoring={scoring}
                dict={dict}
                events={liveEvents.get(m.id) ?? null}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LiveMatchCard({
  locale,
  match,
  scoring,
  dict,
  events,
}: {
  locale: Locale;
  match: LiveMatchRow;
  scoring: ScoringConfig;
  dict: Awaited<ReturnType<typeof getDictionary>>;
  events: ApiMatchEvent[] | null;
}) {
  const isHebrew = locale === "he";
  const homeName = isHebrew ? match.homeNameHe : match.homeNameEn;
  const awayName = isHebrew ? match.awayNameHe : match.awayNameEn;
  const hasPick = match.myHomeScore !== null && match.myAwayScore !== null;

  // Projected outcome based on the current score (live) or actual
  // pointsEarned from the grader (final).
  const projection =
    hasPick && match.homeScore !== null && match.awayScore !== null
      ? projectPoints(
          { home: match.myHomeScore!, away: match.myAwayScore! },
          { home: match.homeScore, away: match.awayScore },
          scoring,
        )
      : null;

  const liveScoreLabel =
    match.homeScore !== null && match.awayScore !== null
      ? `${match.homeScore} - ${match.awayScore}`
      : "-";

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {match.status === "live" ? (
            <Chip tone="warning" className="text-xs animate-pulse">
              {dict.live.liveLabel}
            </Chip>
          ) : (
            <Chip tone="secondary" className="text-xs">
              {dict.live.finalLabel}
            </Chip>
          )}
          <span className="text-xs text-on-surface-variant">
            {formatDateTime(match.kickoffAt, locale, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </header>

      <div className="flex items-center gap-3 md:gap-4">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Flag code={match.homeCode} size={32} />
          <span className="text-sm md:text-base font-bold truncate">
            {homeName}
          </span>
        </div>
        <span className="font-[family-name:var(--font-score)] text-3xl md:text-4xl leading-none font-bold tabular-nums bidi-ltr">
          {liveScoreLabel}
        </span>
        <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
          <span className="text-sm md:text-base font-bold truncate text-end">
            {awayName}
          </span>
          <Flag code={match.awayCode} size={32} />
        </div>
      </div>

      {events && events.length > 0 && (
        <ul className="flex flex-col gap-1 pt-2 border-t border-outline-variant">
          {events
            .filter((e) => e.type === "Goal" || e.type === "Card")
            .slice(-5)
            .map((e, i) => (
              <li
                key={`${e.minute}-${e.player}-${i}`}
                className="flex items-center gap-2 text-xs"
              >
                <span className="font-[family-name:var(--font-label)] text-[11px] font-bold tracking-[0.05em] text-on-surface-variant w-9 bidi-ltr">
                  {e.extraMinute ? `${e.minute}+${e.extraMinute}'` : `${e.minute}'`}
                </span>
                {e.type === "Goal" ? (
                  <Goal className="h-3.5 w-3.5 text-secondary shrink-0" strokeWidth={2} />
                ) : (
                  <span
                    className={`inline-block w-2.5 h-3 rounded-[1px] shrink-0 ${
                      e.detail.toLowerCase().includes("red") ? "bg-error" : "bg-yellow-400"
                    }`}
                    aria-hidden
                  />
                )}
                <span className="flex-1 min-w-0 truncate text-on-surface">
                  {e.player}
                </span>
                <span className="text-[11px] text-on-surface-variant truncate max-w-[40%]">
                  {e.teamName}
                </span>
              </li>
            ))}
        </ul>
      )}

      {hasPick ? (
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-outline-variant">
          <div className="flex flex-col gap-0.5">
            <LabelCaps>{dict.live.yourPickLabel}</LabelCaps>
            <span className="font-[family-name:var(--font-score)] text-lg font-bold tabular-nums bidi-ltr">
              {match.myHomeScore} - {match.myAwayScore}
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <LabelCaps>
              {match.status === "final"
                ? dict.live.finalEarnedLabel
                : dict.live.projectionLabel}
            </LabelCaps>
            <ProjectedPoints
              value={
                match.status === "final" && match.myPointsEarned !== null
                  ? match.myPointsEarned
                  : (projection ?? 0)
              }
              suffix={isHebrew ? "נק'" : "pts"}
              provisional={match.status === "live"}
            />
            {match.status === "live" && (
              <span className="text-[10px] text-on-surface-variant">
                {dict.live.provisionalHint}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-outline-variant text-xs text-on-surface-variant">
          <span>{dict.live.noPickLabel}</span>
        </div>
      )}
    </Card>
  );
}

function ProjectedPoints({
  value,
  suffix,
  provisional,
}: {
  value: number;
  suffix: string;
  provisional: boolean;
}) {
  return (
    <span
      className={clsx(
        "font-[family-name:var(--font-score)] text-2xl leading-none font-bold tabular-nums",
        value > 0
          ? "text-secondary"
          : value < 0
            ? "text-error"
            : "text-on-surface",
        provisional && "italic",
      )}
    >
      <bdi>
        {value > 0 ? "+" : ""}
        {value} {suffix}
      </bdi>
    </span>
  );
}

// Mirror the grading rule in src/lib/sync.ts scoreFinalMatches: exact
// pays scoringExact, direction pays scoringOutcome, wrong pays 0 OR
// -matchRiskPenalty if risk mode is on. We re-implement it here
// rather than importing from sync.ts because that file is server-only
// and runs the actual writes; this is a pure projection.
function projectPoints(
  pick: { home: number; away: number },
  actual: { home: number; away: number },
  cfg: ScoringConfig,
): number {
  const exact = pick.home === actual.home && pick.away === actual.away;
  if (exact) return cfg.scoringExact;
  const pickDir = direction(pick.home, pick.away);
  const actualDir = direction(actual.home, actual.away);
  if (pickDir === actualDir) return cfg.scoringOutcome;
  return cfg.matchRiskEnabled ? -cfg.matchRiskPenalty : 0;
}

function direction(home: number, away: number): "1" | "X" | "2" {
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

// Pulls match-detail enrichment in parallel for every match in `live`
// status. Returns a map keyed by our internal match UUID. Matches that
// aren't mapped to an API-Football fixture (or where the API key is
// missing) simply omit the key.
async function loadLiveEvents(
  matches: LiveMatchRow[],
): Promise<Map<string, ApiMatchEvent[]>> {
  const liveOnly = matches.filter((m) => m.status === "live");
  if (liveOnly.length === 0) return new Map();
  const results = await Promise.all(
    liveOnly.map(async (m) => {
      const d = await getMatchEnrichment(m.id, true);
      return [m.id, d?.events ?? []] as const;
    }),
  );
  return new Map(results);
}

async function loadScoringConfig(): Promise<ScoringConfig> {
  const [s] = await db
    .select({
      scoringExact: settings.scoringExact,
      scoringOutcome: settings.scoringOutcome,
      matchRiskEnabled: settings.matchRiskEnabled,
      matchRiskPenalty: settings.matchRiskPenalty,
    })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return {
    scoringExact: s?.scoringExact ?? 15,
    scoringOutcome: s?.scoringOutcome ?? 5,
    matchRiskEnabled: s?.matchRiskEnabled ?? false,
    matchRiskPenalty: s?.matchRiskPenalty ?? 5,
  };
}
