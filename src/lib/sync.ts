import "server-only";

import { eq, isNull, and, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import {
  matches,
  matchBets,
  settings,
  teams,
  syncRuns,
  customBets,
  userCustomBetPicks,
} from "@/db/schema";
import {
  fetchWorldCupMatches,
  mapStage,
  mapStatus,
  type FDMatch,
} from "./football-data";
import { fetchFixtureStats, type ApiFootballStats } from "./api-football";
import type { AutoApiFootballStat } from "./bets/types";
import TEAM_NAMES from "../../data/team-names.json";

type LocalisedTeam = { he: string; en: string; flag: string };
const NAMES = TEAM_NAMES as Record<string, LocalisedTeam | undefined>;

async function ensureTeam(code: string, apiName: string) {
  const loc = NAMES[code];
  const nameHe = loc?.he ?? apiName;
  const nameEn = loc?.en ?? apiName;
  const flag = loc?.flag ?? "🏳️";
  await db
    .insert(teams)
    .values({ code, nameHe, nameEn, flag })
    .onConflictDoUpdate({
      target: teams.code,
      set: { nameHe, nameEn, flag },
    });
}

export type SyncReport = {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  scoredBets: number;
  scoredMatches: number;
  scoredAutoCustomBets: number;
  cancelledDuels: number;
  unknownTeams: string[];
};

// Aliases mapping football-data tla values to our 3-letter codes. The two
// match for the common World Cup nations, but football-data occasionally
// uses an alternative (e.g. KOR vs KSA can be confused; or ENG = England,
// GBR = Great Britain). Document overrides here.
const TLA_OVERRIDE: Record<string, string> = {
  // football-data uses "GER" for Germany already.
  // football-data uses "KSA" for Saudi Arabia already.
  // football-data uses "RSA" for South Africa.
  // Add overrides only if a mismatch surfaces in the logs.
};

function normalizeTla(tla: string | null): string | null {
  if (!tla) return null;
  const up = tla.toUpperCase();
  return TLA_OVERRIDE[up] ?? up;
}

export type SyncSource = "cron" | "admin" | "cli";

export async function syncFixtures(
  season = 2026,
  options: { source?: SyncSource; triggeredBy?: string | null } = {},
): Promise<SyncReport> {
  const source = options.source ?? "cron";
  const triggeredBy = options.triggeredBy ?? null;
  const startedAt = new Date();

  // Insert a "started" row right away so a hanging sync is still visible.
  const [run] = await db
    .insert(syncRuns)
    .values({ startedAt, source, triggeredBy, ok: false })
    .returning({ id: syncRuns.id });

  try {
    const report = await _runSync(season);
    const finishedAt = new Date();
    await db
      .update(syncRuns)
      .set({
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        ok: true,
        fetched: report.fetched,
        inserted: report.inserted,
        updated: report.updated,
        skipped: report.skipped,
        scoredBets: report.scoredBets,
        scoredMatches: report.scoredMatches,
        unknownTeams: report.unknownTeams.length ? report.unknownTeams : null,
      })
      .where(eq(syncRuns.id, run.id));
    return report;
  } catch (err) {
    const finishedAt = new Date();
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? null : null;
    await db
      .update(syncRuns)
      .set({
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        ok: false,
        errorMessage: message,
        errorStack: stack,
      })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}

async function _runSync(season: number): Promise<SyncReport> {
  const fixtures = await fetchWorldCupMatches(season);
  const report: SyncReport = {
    fetched: fixtures.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    scoredBets: 0,
    scoredMatches: 0,
    scoredAutoCustomBets: 0,
    cancelledDuels: 0,
    unknownTeams: [],
  };

  for (const f of fixtures) {
    const homeCode = normalizeTla(f.homeTeam.tla);
    const awayCode = normalizeTla(f.awayTeam.tla);
    if (!homeCode) {
      report.unknownTeams.push(f.homeTeam.name);
      report.skipped += 1;
      continue;
    }
    if (!awayCode) {
      report.unknownTeams.push(f.awayTeam.name);
      report.skipped += 1;
      continue;
    }

    await ensureTeam(homeCode, f.homeTeam.name);
    await ensureTeam(awayCode, f.awayTeam.name);

    const { stage, groupId } = mapStage(f.stage, f.group);
    const status = mapStatus(f.status);
    const home = f.score.fullTime.home;
    const away = f.score.fullTime.away;
    const htHome = f.score.halfTime?.home ?? null;
    const htAway = f.score.halfTime?.away ?? null;
    const wentToPen = (f.status as string) === "PEN";

    const result = await db.execute<{ inserted: boolean }>(drizzleSql`
      insert into public.matches
        (home_team, away_team, kickoff_at, stage, group_id, venue, status,
         home_score, away_score, ht_home_score, ht_away_score,
         went_to_penalties, finalized_at, api_fixture_id)
      values
        (${homeCode}, ${awayCode}, ${f.utcDate}, ${stage}, ${groupId},
         ${f.venue ?? null}, ${status}, ${home}, ${away}, ${htHome}, ${htAway},
         ${wentToPen}, ${status === "final" ? f.utcDate : null}, ${f.id})
      on conflict (api_fixture_id) do update set
        home_team = excluded.home_team,
        away_team = excluded.away_team,
        kickoff_at = excluded.kickoff_at,
        stage = excluded.stage,
        group_id = excluded.group_id,
        venue = excluded.venue,
        status = excluded.status,
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        ht_home_score = excluded.ht_home_score,
        ht_away_score = excluded.ht_away_score,
        went_to_penalties = excluded.went_to_penalties,
        finalized_at = case when excluded.status = 'final' and matches.finalized_at is null then now() else matches.finalized_at end
      returning (xmax = 0) as inserted
    `);
    const rows = result as unknown as Array<{ inserted: boolean }>;
    if (rows[0]?.inserted) report.inserted += 1;
    else report.updated += 1;
  }

  // Sync team→group assignments from the actual group-stage matches.
  await syncTeamGroups();

  // Auto-score newly finalised match-bets (the main 1/X/2 prediction).
  const scoring = await scoreFinalMatches();
  report.scoredBets = scoring.scoredBets;
  report.scoredMatches = scoring.scoredMatches;

  // Auto-grade any custom_bets with grading_source='auto_football_data'
  // whose underlying matches are now final. Idempotent: only touches bets
  // in (open, locked) status. Skipped bets stay in the manual grading
  // queue without raising errors.
  report.scoredAutoCustomBets = await scoreAutoCustomBets();

  // Auto-cancel any duel that hit its join deadline without a joiner.
  // The duel-delta formula in bank.ts treats cancelled rows as zero
  // delta, so the opener's stake is effectively refunded once we flip
  // the status here.
  report.cancelledDuels = await cancelExpiredOpenDuels();

  return report;
}

// Find every duel with status='open' whose join deadline has passed
// and flip it to 'cancelled'. The bank formula in src/lib/bank.ts
// excludes cancelled duels from the per-user delta, so this single
// status flip refunds the opener's stake.
export async function cancelExpiredOpenDuels(): Promise<number> {
  const result = await db.execute<{ id: string; opener_id: string; stake: number }>(drizzleSql`
    update public.duels
    set status = 'cancelled'
    where status = 'open'
      and join_deadline_at <= now()
    returning id::text as id, opener_id::text as opener_id, stake
  `);
  const rows = result as unknown as Array<{
    id: string;
    opener_id: string;
    stake: number;
  }>;
  for (const r of rows) {
    console.info("[duel cancel]", {
      duelId: r.id,
      reason: "join_deadline_passed",
      openerId: r.opener_id,
      stake: r.stake,
    });
  }
  return rows.length;
}

async function syncTeamGroups() {
  // Ensure every group letter that appears in match data has a groups row.
  await db.execute(drizzleSql`
    insert into public.groups (id, display_order)
    select distinct m.group_id, ascii(m.group_id) - ascii('A') + 1
    from public.matches m
    where m.stage = 'group' and m.group_id is not null
    on conflict (id) do nothing
  `);
  // Assign group_id to teams based on their actual group-stage matches.
  await db.execute(drizzleSql`
    update public.teams t
    set group_id = sub.gid
    from (
      select distinct on (code) code, group_id as gid from (
        select m.home_team as code, m.group_id from public.matches m
        where m.stage = 'group' and m.group_id is not null
        union all
        select m.away_team as code, m.group_id from public.matches m
        where m.stage = 'group' and m.group_id is not null
      ) all_pairs
      order by code, gid
    ) sub
    where t.code = sub.code and (t.group_id is distinct from sub.gid)
  `);
  // Clear group_id for teams not in any current group-stage match.
  await db.execute(drizzleSql`
    update public.teams t
    set group_id = null
    where t.group_id is not null
      and not exists (
        select 1 from public.matches m
        where m.stage = 'group'
          and m.group_id = t.group_id
          and (m.home_team = t.code or m.away_team = t.code)
      )
  `);
}

function outcome(home: number, away: number): "1" | "X" | "2" {
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

export async function scoreFinalMatches(): Promise<{
  scoredMatches: number;
  scoredBets: number;
}> {
  // Pull the live scoring config in one shot. matchRiskEnabled is
  // re-read each pass so an admin toggle takes effect on the next
  // sync without redeploy. Previously-graded picks (points_earned IS
  // NOT NULL) are never re-scored, so flipping the toggle does not
  // retroactively rewrite history.
  const [s] = await db
    .select({
      scoringExact: settings.scoringExact,
      scoringOutcome: settings.scoringOutcome,
      matchRiskEnabled: settings.matchRiskEnabled,
      matchRiskPenalty: settings.matchRiskPenalty,
    })
    .from(settings)
    .where(eq(settings.id, 1));
  if (!s) return { scoredMatches: 0, scoredBets: 0 };

  const matchRows = await db.execute<{
    id: string;
    home_score: number;
    away_score: number;
  }>(drizzleSql`
    select m.id::text as id, m.home_score, m.away_score
    from public.matches m
    where m.status = 'final'
      and m.home_score is not null
      and m.away_score is not null
      and exists (
        select 1 from public.match_bets mb
        where mb.match_id = m.id and mb.points_earned is null
      )
  `);
  const matchesList = matchRows as unknown as Array<{
    id: string;
    home_score: number;
    away_score: number;
  }>;

  let scoredBets = 0;
  for (const m of matchesList) {
    const actual = outcome(m.home_score, m.away_score);

    const bets = await db
      .select({
        id: matchBets.id,
        userId: matchBets.userId,
        homeScore: matchBets.homeScore,
        awayScore: matchBets.awayScore,
      })
      .from(matchBets)
      .where(and(eq(matchBets.matchId, m.id), isNull(matchBets.pointsEarned)));

    for (const b of bets) {
      const exact = b.homeScore === m.home_score && b.awayScore === m.away_score;
      const correctOutcome = outcome(b.homeScore, b.awayScore) === actual;
      const points = exact
        ? s.scoringExact
        : correctOutcome
          ? s.scoringOutcome
          : s.matchRiskEnabled
            ? -s.matchRiskPenalty
            : 0;

      await db
        .update(matchBets)
        .set({
          pointsEarned: points,
          wasExact: exact,
          wasCorrectOutcome: correctOutcome,
          locked: true,
        })
        .where(eq(matchBets.id, b.id));
      scoredBets += 1;

      console.info("[match score]", {
        userId: b.userId,
        matchId: m.id,
        exact,
        direction: correctOutcome,
        pointsEarned: points,
        riskMode: s.matchRiskEnabled,
      });
    }
  }

  return { scoredMatches: matchesList.length, scoredBets };
}


// ---------- Auto-grading custom_bets ----------
//
// Sister pass to scoreFinalMatches: finds every custom_bets row that
// opted into auto_football_data OR auto_api_football and is still in
// (open, locked) state, then grades it deterministically against the
// relevant data source. The function is idempotent — graded rows are
// skipped on subsequent runs because we only touch status in
// ('open', 'locked').
//
// Two grading sources:
//   auto_football_data → reads from our matches table (final scores,
//                        halftime, went_to_penalties). Always available.
//   auto_api_football  → reads from API-Football's /fixtures/statistics
//                        endpoint (corners, cards, possession, etc.).
//                        Requires API_FOOTBALL_KEY in env AND
//                        matches.api_football_fixture_id populated
//                        (one-shot map script). Until both are in place
//                        the api-football branch returns "not_ready"
//                        and the bet stays in the manual queue.
//
// Data-readiness rules per scope:
//   match scope → matches.status = 'final'
//   day   scope → every match on that Asia/Jerusalem date is final
//   stage scope → not auto-graded yet (manual)
//   group scope → not auto-graded yet (manual)
//   tournament  → not auto-graded here (manual)
type AutoFootballField =
  | "home_score"
  | "away_score"
  | "winner"
  | "ht_score"
  | "total_goals"
  | "ht_total"
  | "went_to_penalties";

type CandidateBet = {
  id: string;
  scope: "match" | "day" | "stage" | "group" | "tournament";
  matchdayId: string | null;
  matchdayDate: string | null;
  matchId: string | null;
  stage: string | null;
  groupId: string | null;
  questionEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  payoutSnapshot: number;
  gradingSource: "auto_football_data" | "auto_api_football" | "manual";
  gradingConfig: {
    source: string;
    field?: string;
    stat?: string;
    aggregate?: "sum_day" | "per_match" | "first_match";
  } | null;
};

export async function scoreAutoCustomBets(): Promise<number> {
  // 1) Candidate set. Both auto sources share the same shape.
  const candidateRows = await db.execute<CandidateBet>(drizzleSql`
    select
      cb.id::text                       as "id",
      cb.scope::text                    as "scope",
      cb.matchday_id::text              as "matchdayId",
      md.date::text                     as "matchdayDate",
      cb.match_id::text                 as "matchId",
      cb.stage::text                    as "stage",
      cb.group_id                       as "groupId",
      cb.question_en                    as "questionEn",
      cb.answer_type::text              as "answerType",
      cb.payout_snapshot                as "payoutSnapshot",
      cb.grading_source::text           as "gradingSource",
      cb.grading_config                 as "gradingConfig"
    from public.custom_bets cb
    left join public.matchdays md on md.id = cb.matchday_id
    where cb.status in ('open', 'locked')
      and cb.grading_source in ('auto_football_data', 'auto_api_football')
  `);
  const candidates = candidateRows as unknown as CandidateBet[];

  let scored = 0;
  for (const bet of candidates) {
    // 2) Compute the resolved value if the data is ready.
    const resolved = await tryResolve(bet);
    if (resolved === "not_ready") continue;
    if (resolved === "skip") {
      console.warn("[grading skipped]", {
        betId: bet.id,
        scope: bet.scope,
        source: bet.gradingSource,
        answerType: bet.answerType,
        reason: "type_mismatch_or_unsupported_combo",
      });
      continue;
    }

    // 3) Grade everyone's pick + flip status. We do this inside a txn
    // per bet so a failed pick update rolls back the bet's status flip.
    try {
      const { picksGraded, winners } = await db.transaction(async (tx) => {
        const picks = await tx
          .select({
            id: userCustomBetPicks.id,
            answer: userCustomBetPicks.answer,
          })
          .from(userCustomBetPicks)
          .where(eq(userCustomBetPicks.customBetId, bet.id));

        let wins = 0;
        for (const pk of picks) {
          const correct = isAutoPickCorrect(bet.answerType, pk.answer as unknown, resolved);
          if (correct) wins += 1;
          await tx
            .update(userCustomBetPicks)
            .set({
              pointsEarned: correct ? bet.payoutSnapshot : 0,
              wasCorrect: correct,
              locked: true,
              updatedAt: new Date(),
            })
            .where(eq(userCustomBetPicks.id, pk.id));
        }

        await tx
          .update(customBets)
          .set({
            status: "graded",
            resolvedValue: resolved,
            gradedAt: new Date(),
            // graded_by stays null — this was a system-driven grade. The
            // FK is `on delete set null` so the column accepts NULL.
            updatedAt: new Date(),
          })
          .where(eq(customBets.id, bet.id));

        return { picksGraded: picks.length, winners: wins };
      });

      console.info("[grading auto]", {
        betId: bet.id,
        scope: bet.scope,
        source: bet.gradingSource,
        resolved,
        picksGraded,
        winners,
      });
      scored += 1;
    } catch (err) {
      // One bad row should not poison the whole sync run. Log and move on.
      console.error("[grading auto] failed:", { betId: bet.id, err });
    }
  }

  return scored;
}

// Resolve the bet's value from the matches table.
//
// Returns:
//   "not_ready"  – the underlying matches are not all final yet. Caller
//                  skips silently; we'll try again on the next sync.
//   "skip"       – the answer_type / field combo isn't supported. Caller
//                  logs a warning so admin can re-author or grade manually.
//   ResolvedValue – ready to grade.
type ResolvedNumber = { type: "number"; value: number };
type ResolvedMulti  = { type: "multi_choice"; value: string };
type ResolvedYesNo  = { type: "yes_no"; value: boolean };
type Resolved = ResolvedNumber | ResolvedMulti | ResolvedYesNo;

async function tryResolve(
  bet: CandidateBet,
): Promise<Resolved | "not_ready" | "skip"> {
  if (bet.gradingSource === "auto_football_data") {
    const field = bet.gradingConfig?.field as AutoFootballField | undefined;
    if (!field) return "skip";
    if (bet.scope === "match") return resolveMatchScope(bet, field);
    if (bet.scope === "day")   return resolveDayScope(bet, field);
    return "skip";
  }
  if (bet.gradingSource === "auto_api_football") {
    const stat = bet.gradingConfig?.stat as AutoApiFootballStat | undefined;
    const aggregate = bet.gradingConfig?.aggregate;
    if (!stat || !aggregate) return "skip";
    if (bet.scope === "match") return resolveMatchScopeApiFootball(bet, stat);
    if (bet.scope === "day")   return resolveDayScopeApiFootball(bet, stat, aggregate);
    return "skip";
  }
  return "skip";
}

async function resolveMatchScope(
  bet: CandidateBet,
  field: AutoFootballField,
): Promise<Resolved | "not_ready" | "skip"> {
  if (!bet.matchId) return "skip";
  const [m] = await db
    .select({
      status: matches.status,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      htHomeScore: matches.htHomeScore,
      htAwayScore: matches.htAwayScore,
      wentToPenalties: matches.wentToPenalties,
    })
    .from(matches)
    .where(eq(matches.id, bet.matchId))
    .limit(1);
  if (!m) return "skip";
  if (m.status !== "final" || m.homeScore === null || m.awayScore === null) {
    return "not_ready";
  }

  // Coerce field → resolved value, then check the answer_type matches.
  return coerceMatchField(bet.answerType, field, {
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    htHomeScore: m.htHomeScore,
    htAwayScore: m.htAwayScore,
    wentToPenalties: m.wentToPenalties,
  });
}

async function resolveDayScope(
  bet: CandidateBet,
  field: AutoFootballField,
): Promise<Resolved | "not_ready" | "skip"> {
  if (!bet.matchdayDate) return "skip";

  // Day-scope only makes sense for fields that aggregate cleanly across
  // multiple matches. Anything per-match (winner / ht_score / one team's
  // score / went_to_penalties) doesn't have a natural aggregation, so we
  // skip it back to manual.
  const aggregable: AutoFootballField[] = ["total_goals", "ht_total"];
  if (!aggregable.includes(field)) return "skip";
  if (bet.answerType !== "number") return "skip";

  // Readiness: every match that day must be final.
  const dayRows = await db.execute<{
    total_matches: number;
    final_matches: number;
    sum_total_goals: number;
    sum_ht_total: number;
  }>(drizzleSql`
    select
      count(*)::int                                              as total_matches,
      count(*) filter (where m.status = 'final'
                             and m.home_score is not null
                             and m.away_score is not null)::int  as final_matches,
      coalesce(sum(coalesce(m.home_score, 0) + coalesce(m.away_score, 0))
        filter (where m.status = 'final'), 0)::int               as sum_total_goals,
      coalesce(sum(coalesce(m.ht_home_score, 0) + coalesce(m.ht_away_score, 0))
        filter (where m.status = 'final'), 0)::int               as sum_ht_total
    from public.matches m
    where (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${bet.matchdayDate}::date
  `);
  const r = (dayRows as unknown as Array<{
    total_matches: number;
    final_matches: number;
    sum_total_goals: number;
    sum_ht_total: number;
  }>)[0];
  if (!r || r.total_matches === 0) return "skip";
  if (r.final_matches < r.total_matches) return "not_ready";

  const value =
    field === "total_goals" ? Number(r.sum_total_goals) : Number(r.sum_ht_total);
  return { type: "number", value };
}

async function resolveMatchScopeApiFootball(
  bet: CandidateBet,
  stat: AutoApiFootballStat,
): Promise<Resolved | "not_ready" | "skip"> {
  if (!bet.matchId) return "skip";
  if (bet.answerType !== "number") return "skip";

  // 1) Confirm the match is final and has been mapped to an API-Football
  // fixture id. If either is false, the bet stays queued.
  const [m] = await db
    .select({
      status: matches.status,
      apiFootballFixtureId: matches.apiFootballFixtureId,
    })
    .from(matches)
    .where(eq(matches.id, bet.matchId))
    .limit(1);
  if (!m || m.status !== "final") return "not_ready";
  if (m.apiFootballFixtureId === null) return "not_ready";

  // 2) Fetch + coerce. fetchFixtureStats returns null when the API key
  // is unset OR on an upstream error; treat both as "try again later".
  const stats = await fetchFixtureStats(m.apiFootballFixtureId);
  if (!stats) return "not_ready";

  return coerceApiFootballStat(stat, stats.combined);
}

async function resolveDayScopeApiFootball(
  bet: CandidateBet,
  stat: AutoApiFootballStat,
  aggregate: "sum_day" | "per_match" | "first_match",
): Promise<Resolved | "not_ready" | "skip"> {
  if (!bet.matchdayDate) return "skip";
  if (bet.answerType !== "number") return "skip";
  if (aggregate === "per_match") return "skip"; // ambiguous at day scope

  // Pull every match on the matchday with its fixture id + final status.
  const rows = await db.execute<{
    api_football_fixture_id: number | null;
    status: string;
    kickoff_at: string;
  }>(drizzleSql`
    select m.api_football_fixture_id, m.status::text, m.kickoff_at::text
    from public.matches m
    where (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${bet.matchdayDate}::date
    order by m.kickoff_at asc
  `);
  const list = rows as unknown as Array<{
    api_football_fixture_id: number | null;
    status: string;
    kickoff_at: string;
  }>;
  if (list.length === 0) return "skip";

  // Every match must be final + mapped. Any missing piece → not_ready.
  const allFinal = list.every((r) => r.status === "final");
  const allMapped = list.every((r) => r.api_football_fixture_id !== null);
  if (!allFinal || !allMapped) return "not_ready";

  if (aggregate === "first_match") {
    const first = list[0];
    if (first.api_football_fixture_id === null) return "not_ready";
    const stats = await fetchFixtureStats(first.api_football_fixture_id);
    if (!stats) return "not_ready";
    return coerceApiFootballStat(stat, stats.combined);
  }

  // sum_day: pull stats for every fixture, then add the combined values.
  let total = 0;
  for (const row of list) {
    const stats = await fetchFixtureStats(row.api_football_fixture_id!);
    if (!stats) return "not_ready";
    const v = stats.combined[stat];
    if (v === undefined) {
      // Wrapper drops % stats from combined (possession, pass_accuracy)
      // because summing them across teams is meaningless. Reaching here
      // means admin chose a non-aggregable stat — return skip so the
      // bet drops into the manual queue with a clear warn.
      return "skip";
    }
    total += v;
  }
  return { type: "number", value: total };
}

function coerceApiFootballStat(
  stat: AutoApiFootballStat,
  combined: ApiFootballStats,
): Resolved | "skip" {
  const value = combined[stat];
  if (value === undefined) return "skip"; // possession / pass_accuracy
  return { type: "number", value };
}

function coerceMatchField(
  answerType: "yes_no" | "number" | "multi_choice" | "free_text",
  field: AutoFootballField,
  m: {
    homeScore: number;
    awayScore: number;
    htHomeScore: number | null;
    htAwayScore: number | null;
    wentToPenalties: boolean | null;
  },
): Resolved | "skip" {
  switch (field) {
    case "home_score":
      return answerType === "number"
        ? { type: "number", value: m.homeScore }
        : "skip";
    case "away_score":
      return answerType === "number"
        ? { type: "number", value: m.awayScore }
        : "skip";
    case "total_goals":
      return answerType === "number"
        ? { type: "number", value: m.homeScore + m.awayScore }
        : "skip";
    case "ht_total":
      if (answerType !== "number") return "skip";
      if (m.htHomeScore === null || m.htAwayScore === null) return "skip";
      return { type: "number", value: m.htHomeScore + m.htAwayScore };
    case "winner":
      return answerType === "multi_choice"
        ? { type: "multi_choice", value: outcome(m.homeScore, m.awayScore) }
        : "skip";
    case "ht_score":
      if (answerType !== "multi_choice") return "skip";
      if (m.htHomeScore === null || m.htAwayScore === null) return "skip";
      return {
        type: "multi_choice",
        value: `${m.htHomeScore}-${m.htAwayScore}`,
      };
    case "went_to_penalties":
      return answerType === "yes_no"
        ? { type: "yes_no", value: m.wentToPenalties === true }
        : "skip";
  }
}

function isAutoPickCorrect(
  answerType: "yes_no" | "number" | "multi_choice" | "free_text",
  pickAnswer: unknown,
  resolved: Resolved,
): boolean {
  if (!pickAnswer || typeof pickAnswer !== "object") return false;
  const a = pickAnswer as { type?: string; value?: unknown };
  if (a.type !== answerType || a.type !== resolved.type) return false;
  return a.value === resolved.value;
}

// Lightweight typing helper for the `FDMatch` consumer above. Keeps the
// public surface of this module small so callers don't need to know about
// football-data internals.
export type { FDMatch };
