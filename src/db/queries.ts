import "server-only";
import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "./index";
import { execFirstRow, execRows } from "./helpers";
import type { MultiChoiceOption } from "@/lib/bets/types";
import { duelCaseSql, duelDeltaSql } from "@/lib/bank";
import { STAR_PLAYER_RANK, TEAM_RANK } from "@/lib/players/curation";

// Cache tags used to invalidate cross-request cached queries from the
// server actions that mutate the underlying tables. Mutations call
// revalidateTag(...) targeting the specific surface that changed,
// instead of nuking the whole layout cache the way
// revalidatePath("/", "layout") used to. See _plans/2026-05-27-perf-
// overhaul-instant-nav.md §"Phase 4" for the wiring.
export const CACHE_TAG_FIXTURES = "fixtures";
export const CACHE_TAG_POOL = "pool";
export const CACHE_TAG_LEADERBOARD = "leaderboard";
export const CACHE_TAG_SETTINGS = "settings";

// Cached cross-request — admin can only change this via the scoring
// settings panel, which calls revalidatePath that drops the entry.
// Two pages (home + bets) ask for it on every render so caching saves
// a settings table round-trip on every navigation.
export const getBetLockMinutes = unstable_cache(
  async (): Promise<number> => {
    const row = await execFirstRow<{ bet_lock_minutes: number }>(sql`
      select bet_lock_minutes from public.settings where id = 1
    `);
    return row?.bet_lock_minutes ?? 5;
  },
  ["getBetLockMinutes"],
  { tags: [CACHE_TAG_SETTINGS], revalidate: 600 },
);

export type LocalizedName = { he: string; en: string };

export type FixtureRow = {
  id: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  homeFlag: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  awayFlag: string;
  kickoffAt: string;
  stage: string;
  groupId: string | null;
  status: "scheduled" | "live" | "final";
  homeScore: number | null;
  awayScore: number | null;
  finalizedAt: string | null;
};

export type FixtureWithMyBet = FixtureRow & {
  myHome: number | null;
  myAway: number | null;
  myPoints: number | null;
  myExact: boolean | null;
};

// Upcoming fixtures (status != final), ordered by kickoff. With caller's bet.
export async function getUpcomingFixtures(
  userId: string,
  limit = 10,
): Promise<FixtureWithMyBet[]> {
  return execRows<FixtureWithMyBet>(sql`
    select
      m.id::text                       as "id",
      m.home_team                      as "homeCode",
      ht.name_he                       as "homeNameHe",
      ht.name_en                       as "homeNameEn",
      ht.flag                          as "homeFlag",
      m.away_team                      as "awayCode",
      at.name_he                       as "awayNameHe",
      at.name_en                       as "awayNameEn",
      at.flag                          as "awayFlag",
      m.kickoff_at                     as "kickoffAt",
      m.stage::text                    as "stage",
      m.group_id                       as "groupId",
      m.status::text                   as "status",
      m.home_score                     as "homeScore",
      m.away_score                     as "awayScore",
      m.finalized_at                   as "finalizedAt",
      mb.home_score                    as "myHome",
      mb.away_score                    as "myAway",
      mb.points_earned                 as "myPoints",
      mb.was_exact                     as "myExact"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    left join public.match_bets mb
      on mb.match_id = m.id and mb.user_id = ${userId}
    where m.status <> 'final'
    order by m.kickoff_at asc
    limit ${limit}
  `);
}

// Latest final match for which the user has a bet (i.e. their most recent
// finished match). Used by dashboard's "Last bet" card.
export async function getLatestFinalForUser(
  userId: string,
): Promise<FixtureWithMyBet | null> {
  return execFirstRow<FixtureWithMyBet>(sql`
    select
      m.id::text          as "id",
      m.home_team         as "homeCode",
      ht.name_he          as "homeNameHe",
      ht.name_en          as "homeNameEn",
      ht.flag             as "homeFlag",
      m.away_team         as "awayCode",
      at.name_he          as "awayNameHe",
      at.name_en          as "awayNameEn",
      at.flag             as "awayFlag",
      m.kickoff_at        as "kickoffAt",
      m.stage::text       as "stage",
      m.group_id          as "groupId",
      m.status::text      as "status",
      m.home_score        as "homeScore",
      m.away_score        as "awayScore",
      m.finalized_at      as "finalizedAt",
      mb.home_score       as "myHome",
      mb.away_score       as "myAway",
      mb.points_earned    as "myPoints",
      mb.was_exact        as "myExact"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    left join public.match_bets mb
      on mb.match_id = m.id and mb.user_id = ${userId}
    where m.status = 'final'
    order by coalesce(m.finalized_at, m.kickoff_at) desc
    limit 1
  `);
}

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  displayName: string;
  points: number;        // category-specific score (see tab semantics below)
  grossPoints: number;   // sum of payouts before stake deduction (skill proxy)
  betCount: number;
  wastedStakes: number;  // stakes paid on bets that returned zero (tie-break)
  isYou: boolean;
};

export type LeaderboardTab = "overall" | "matches" | "live" | "duels";

// Per-tab leaderboard. The four tabs match the betting surfaces:
//
//   overall  - full bank balance (starting + match payouts + live net +
//              duel delta + admin adjustments). Tie-break: fewest wasted
//              stakes (highest hit rate) then display_name.
//   matches  - Σ match_bets.points_earned only. Tie-break: count of
//              exact-score hits desc.
//   live     - Σ user_custom_bet_picks.points_earned − Σ stake_paid.
//              Tie-break: total stakes paid asc (fewer stakes = more
//              efficient hits).
//   duels    - Σ duel-delta only (see src/lib/bank.ts §7.3 for the
//              CASE rules). Tie-break: count of duels participated desc.
//
// All four return the same LeaderboardEntry shape so the UI doesn't
// branch on tab-specific columns. `points` carries the tab-specific
// score; `grossPoints` always carries the user's total gross payouts
// (across every surface) so the secondary column stays comparable.
// Cached cross-request, scoped by (userId, tab) because the `isYou`
// marker varies per viewer. The underlying ranking is the same across
// users; the cost of per-viewer entries is small and the win is
// huge — this CTE has 5 sub-queries × every profile in the pool, so
// even at a friends-pool scale it's the heaviest query the home and
// leaderboard pages run. Invalidated by CACHE_TAG_LEADERBOARD which
// scoring/grading/adjustment actions tag-bust.
async function loadLeaderboardFromDb(
  currentUserId: string,
  tab: LeaderboardTab,
): Promise<LeaderboardEntry[]> {
  return execRows<LeaderboardEntry>(sql`
    with match_points as (
      select p.id as user_id,
        coalesce((
          select sum(coalesce(mb.points_earned, 0))::int
          from public.match_bets mb where mb.user_id = p.id
        ), 0) as score,
        coalesce((
          select count(*)::int from public.match_bets mb
          where mb.user_id = p.id and mb.was_exact = true
        ), 0) as exact_count
      from public.profiles p
    ),
    live_net as (
      select p.id as user_id,
        coalesce((
          select sum(coalesce(pk.points_earned, 0))::int
          from public.user_custom_bet_picks pk where pk.user_id = p.id
        ), 0) as payouts,
        coalesce((
          select sum(pk.stake_paid)::int
          from public.user_custom_bet_picks pk where pk.user_id = p.id
        ), 0) as stakes,
        coalesce((
          select sum(case when pk.points_earned = 0 then pk.stake_paid else 0 end)::int
          from public.user_custom_bet_picks pk where pk.user_id = p.id
        ), 0) as wasted_stakes
      from public.profiles p
    ),
    duel_stats as (
      select p.id as user_id,
        ${duelDeltaSql(sql`p.id`)} as delta,
        coalesce((
          select count(*)::int from public.duels d
          where (d.opener_id = p.id or d.joiner_id = p.id)
            and d.status in ('matched', 'settled')
        ), 0) as duel_count
      from public.profiles p
    ),
    adjustments as (
      select p.id as user_id,
        coalesce((
          select sum(pa.delta)::int
          from public.point_adjustments pa where pa.user_id = p.id
        ), 0) as total_adj
      from public.profiles p
    ),
    bet_counts as (
      select p.id as user_id,
        (select count(*)::int from public.match_bets mb where mb.user_id = p.id) as bet_count
      from public.profiles p
    ),
    base as (
      select
        p.id::text                                            as user_id,
        p.display_name                                        as display_name,
        mp.score                                              as match_score,
        mp.exact_count                                        as exact_count,
        ln.payouts                                            as live_payouts,
        ln.stakes                                             as live_stakes,
        ln.wasted_stakes                                      as wasted_stakes,
        ds.delta                                              as duel_delta,
        ds.duel_count                                         as duel_count,
        adj.total_adj                                         as adjustments,
        bc.bet_count                                          as bet_count,
        (select starting_bank from public.settings where id = 1)::int as starting_bank,
        (mp.score + ln.payouts)::int                          as gross_points
      from public.profiles p
      join match_points mp on mp.user_id  = p.id
      join live_net ln     on ln.user_id  = p.id
      join duel_stats ds   on ds.user_id  = p.id
      join adjustments adj on adj.user_id = p.id
      join bet_counts bc   on bc.user_id  = p.id
    ),
    scored as (
      select
        base.*,
        case ${tab}::text
          when 'matches' then match_score
          when 'live'    then (live_payouts - live_stakes)::int
          when 'duels'   then duel_delta
          else (starting_bank + match_score + live_payouts - live_stakes
                + duel_delta + adjustments)::int
        end as score,
        case ${tab}::text
          when 'matches' then -exact_count               -- desc on hits
          when 'live'    then live_stakes                -- asc on stakes
          when 'duels'   then -duel_count                -- desc on count
          else wasted_stakes                             -- asc on waste
        end as tiebreak
      from base
    )
    select
      rank() over (
        order by score desc,
                 tiebreak asc,
                 display_name asc
      )::int                                              as "rank",
      user_id                                             as "userId",
      display_name                                        as "displayName",
      score::int                                          as "points",
      gross_points::int                                   as "grossPoints",
      bet_count::int                                      as "betCount",
      wasted_stakes::int                                  as "wastedStakes",
      (user_id = ${currentUserId})                        as "isYou"
    from scored
    order by "rank", display_name asc
  `);
}

export async function getLeaderboard(
  currentUserId: string,
  tab: LeaderboardTab = "overall",
): Promise<LeaderboardEntry[]> {
  const cached = unstable_cache(
    async () => loadLeaderboardFromDb(currentUserId, tab),
    ["leaderboard", currentUserId, tab],
    { tags: [CACHE_TAG_LEADERBOARD], revalidate: 60 },
  );
  return cached();
}

export type MyRankSummary = {
  myRank: number;
  total: number;
  gapToLeader: number;
  myPoints: number;
};

export async function getMyRankSummary(
  userId: string,
): Promise<MyRankSummary> {
  const board = await getLeaderboard(userId);
  const me = board.find((r) => r.isYou) ?? null;
  const leader = board[0] ?? null;
  return {
    myRank: me?.rank ?? 0,
    total: board.length,
    gapToLeader: leader && me ? leader.points - me.points : 0,
    myPoints: me?.points ?? 0,
  };
}

// Points trend per matchday for one user. We bucket points by the calendar
// day of the match kickoff so the chart shows accumulation across the
// tournament without us needing a separate matchday column.
export async function getPointsTrend(userId: string): Promise<number[]> {
  const rows = await execRows<{ points: number }>(sql`
    select coalesce(sum(coalesce(mb.points_earned, 0)), 0)::int as "points"
    from public.matches m
    join public.match_bets mb
      on mb.match_id = m.id and mb.user_id = ${userId}
    where m.status = 'final'
    group by date_trunc('day', m.kickoff_at)
    order by date_trunc('day', m.kickoff_at) asc
  `);
  return rows.map((r) => Number(r.points));
}

export async function getFixtureWithBets(
  matchId: string,
): Promise<FixtureRow | null> {
  return execFirstRow<FixtureRow>(sql`
    select
      m.id::text          as "id",
      m.home_team         as "homeCode",
      ht.name_he          as "homeNameHe",
      ht.name_en          as "homeNameEn",
      ht.flag             as "homeFlag",
      m.away_team         as "awayCode",
      at.name_he          as "awayNameHe",
      at.name_en          as "awayNameEn",
      at.flag             as "awayFlag",
      m.kickoff_at        as "kickoffAt",
      m.stage::text       as "stage",
      m.group_id          as "groupId",
      m.status::text      as "status",
      m.home_score        as "homeScore",
      m.away_score        as "awayScore",
      m.finalized_at      as "finalizedAt"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    where m.id = ${matchId}::uuid
    limit 1
  `);
}

export type FriendBet = {
  userId: string;
  displayName: string;
  homeScore: number;
  awayScore: number;
  pointsEarned: number | null;
  isYou: boolean;
};

export async function getMatchBets(
  matchId: string,
  currentUserId: string,
): Promise<FriendBet[]> {
  return execRows<FriendBet>(sql`
    select
      p.id::text                  as "userId",
      p.display_name              as "displayName",
      mb.home_score               as "homeScore",
      mb.away_score               as "awayScore",
      mb.points_earned            as "pointsEarned",
      (p.id::text = ${currentUserId}) as "isYou"
    from public.match_bets mb
    join public.profiles p on p.id = mb.user_id
    where mb.match_id = ${matchId}::uuid
    order by mb.points_earned desc nulls last, p.display_name asc
  `);
}

export type MyBet = {
  homeScore: number;
  awayScore: number;
  pointsEarned: number | null;
  wasExact: boolean | null;
  locked: boolean;
};

export async function getMyBet(
  matchId: string,
  userId: string,
): Promise<MyBet | null> {
  return execFirstRow<MyBet>(sql`
    select
      home_score    as "homeScore",
      away_score    as "awayScore",
      points_earned as "pointsEarned",
      was_exact     as "wasExact",
      locked        as "locked"
    from public.match_bets
    where match_id = ${matchId}::uuid and user_id = ${userId}
    limit 1
  `);
}

// Profile screen: aggregate stats for one user.
//
// `totalPoints` is the user's current bank balance, which is also the
// number that ranks them on the leaderboard. `availablePoints` mirrors
// it because every stake is debited from the bank the moment it's
// placed - there is no separate "locked" pool. Showing both gives the
// user the two mental framings they expect (score vs. spending power)
// without diverging from the source of truth.
//
// The category breakdown (`pointsFromMatches` / `pointsFromLiveBets` /
// `pointsFromTournamentBets` / `pointsFromDuels` / `pointsFromAdjustments`)
// sums to `totalPoints - startingBank`, so the user can audit where
// each gained or lost point came from.
export type ProfileStats = {
  totalPoints: number;
  availablePoints: number;
  startingBank: number;

  // Category breakdown (net contribution to the bank, excluding starting).
  pointsFromMatches: number;
  pointsFromLiveBets: number;
  pointsFromTournamentBets: number;
  pointsFromDuels: number;
  pointsFromAdjustments: number;

  // Match-pick hit rate. Numerator = correct outcomes on placed bets;
  // denominator = total finalized matches in the tournament so the
  // user sees their score against the *available* universe of matches,
  // not just the subset they bet on.
  correctOutcomeCount: number;
  exactCount: number;
  totalFinalMatches: number;

  // Legacy fields kept so other consumers don't break.
  betsPlaced: number;
  betsFinal: number;
  outcomeCount: number;
  exactAccuracy: number; // percent 0..100
  outcomeAccuracy: number;
  streak: number;
  memberSince: string | null;
};

// Row shape returned by the profile-stats aggregate. Kept as a local
// type because the SELECT projects raw snake_case names that are
// transformed into the camelCase ProfileStats just below; if these were
// exported we'd risk a consumer leaking the DB-shape into UI code.
type ProfileStatsRow = {
  starting_bank: number;
  points_from_matches: number;
  points_from_live_bets: number;
  points_from_tournament_bets: number;
  points_from_duels: number;
  points_from_adjustments: number;
  bets_placed: number;
  bets_final: number;
  exact_count: number;
  outcome_count: number;
  total_final_matches: number;
  member_since: string | null;
};

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const r = await execFirstRow<ProfileStatsRow>(sql`
    select
      (select starting_bank from public.settings where id = 1)::int as starting_bank,

      coalesce((
        select sum(coalesce(mb.points_earned, 0))::int
        from public.match_bets mb where mb.user_id = ${userId}
      ), 0) as points_from_matches,

      coalesce((
        select sum(coalesce(pk.points_earned, 0) - pk.stake_paid)::int
        from public.user_custom_bet_picks pk
        join public.custom_bets cb on cb.id = pk.custom_bet_id
        where pk.user_id = ${userId}
          and cb.scope in ('match', 'day')
      ), 0) as points_from_live_bets,

      coalesce((
        select sum(coalesce(pk.points_earned, 0) - pk.stake_paid)::int
        from public.user_custom_bet_picks pk
        join public.custom_bets cb on cb.id = pk.custom_bet_id
        where pk.user_id = ${userId}
          and cb.scope in ('tournament', 'stage', 'group')
      ), 0) as points_from_tournament_bets,

      ${duelDeltaSql(userId)} as points_from_duels,

      coalesce((
        select sum(pa.delta)::int
        from public.point_adjustments pa where pa.user_id = ${userId}
      ), 0) as points_from_adjustments,

      coalesce((
        select count(*)::int from public.match_bets mb where mb.user_id = ${userId}
      ), 0) as bets_placed,
      coalesce((
        select count(*)::int from public.match_bets mb
        where mb.user_id = ${userId} and mb.points_earned is not null
      ), 0) as bets_final,
      coalesce((
        select count(*)::int from public.match_bets mb
        where mb.user_id = ${userId} and mb.was_exact
      ), 0) as exact_count,
      coalesce((
        select count(*)::int from public.match_bets mb
        where mb.user_id = ${userId} and mb.was_correct_outcome
      ), 0) as outcome_count,

      coalesce((
        select count(*)::int from public.matches where status = 'final'
      ), 0) as total_final_matches,

      (select created_at from public.profiles where id = ${userId})::text as member_since
  `);
  if (!r) {
    throw new Error(`profile stats row missing for user ${userId}`);
  }

  const startingBank = Number(r.starting_bank);
  const pointsFromMatches = Number(r.points_from_matches);
  const pointsFromLiveBets = Number(r.points_from_live_bets);
  const pointsFromTournamentBets = Number(r.points_from_tournament_bets);
  const pointsFromDuels = Number(r.points_from_duels);
  const pointsFromAdjustments = Number(r.points_from_adjustments);
  const totalPoints =
    startingBank
    + pointsFromMatches
    + pointsFromLiveBets
    + pointsFromTournamentBets
    + pointsFromDuels
    + pointsFromAdjustments;

  const betsFinal = Number(r.bets_final);
  const exactAcc = betsFinal > 0 ? Math.round((Number(r.exact_count) / betsFinal) * 100) : 0;
  const outcomeAcc = betsFinal > 0 ? Math.round((Number(r.outcome_count) / betsFinal) * 100) : 0;

  // Streak: count trailing correct-outcome bets among the most recent finals.
  const streakRows = await execRows<{ was_correct_outcome: boolean | null }>(sql`
    select mb.was_correct_outcome
    from public.match_bets mb
    join public.matches m on m.id = mb.match_id
    where mb.user_id = ${userId} and m.status = 'final'
    order by coalesce(m.finalized_at, m.kickoff_at) desc
    limit 50
  `);
  let streak = 0;
  for (const row of streakRows) {
    if (row.was_correct_outcome) streak += 1;
    else break;
  }

  return {
    totalPoints,
    availablePoints: totalPoints,
    startingBank,
    pointsFromMatches,
    pointsFromLiveBets,
    pointsFromTournamentBets,
    pointsFromDuels,
    pointsFromAdjustments,
    correctOutcomeCount: Number(r.outcome_count),
    exactCount: Number(r.exact_count),
    totalFinalMatches: Number(r.total_final_matches),
    betsPlaced: Number(r.bets_placed),
    betsFinal,
    outcomeCount: Number(r.outcome_count),
    exactAccuracy: exactAcc,
    outcomeAccuracy: outcomeAcc,
    streak,
    memberSince: r.member_since,
  };
}

// Profile screen: recent matches a user has interacted with.
export type HistoryRow = {
  matchId: string;
  status: "scheduled" | "live" | "final";
  kickoffAt: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  homeFlag: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  awayFlag: string;
  homeScore: number | null;
  awayScore: number | null;
  myHome: number | null;
  myAway: number | null;
  pointsEarned: number | null;
  wasExact: boolean | null;
};

export async function getMyHistory(
  userId: string,
  limit = 20,
): Promise<HistoryRow[]> {
  return execRows<HistoryRow>(sql`
    select
      m.id::text       as "matchId",
      m.status::text   as "status",
      m.kickoff_at     as "kickoffAt",
      m.home_team      as "homeCode",
      ht.name_he       as "homeNameHe",
      ht.name_en       as "homeNameEn",
      ht.flag          as "homeFlag",
      m.away_team      as "awayCode",
      at.name_he       as "awayNameHe",
      at.name_en       as "awayNameEn",
      at.flag          as "awayFlag",
      m.home_score     as "homeScore",
      m.away_score     as "awayScore",
      mb.home_score    as "myHome",
      mb.away_score    as "myAway",
      mb.points_earned as "pointsEarned",
      mb.was_exact     as "wasExact"
    from public.match_bets mb
    join public.matches m on m.id = mb.match_id
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    where mb.user_id = ${userId}
    order by coalesce(m.finalized_at, m.kickoff_at) desc
    limit ${limit}
  `);
}

// Profile screen: the user's own custom-bet picks (live + tournament).
// Returned ordered most-recent-first. `scopes` lets the caller decide
// which UI bucket to fetch - the profile page asks for the live bucket
// ('match','day') and the tournament bucket ('tournament','stage','group')
// in two parallel calls so each section can render independently.
export type MyCustomPickRow = {
  pickId: string;
  customBetId: string;
  scope: "match" | "day" | "group" | "stage" | "tournament";
  stage: "group" | "r32" | "r16" | "qf" | "sf" | "third_place" | "final" | null;
  groupId: string | null;
  questionHe: string;
  questionEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  myAnswer: unknown;
  status: "draft" | "open" | "locked" | "graded" | "cancelled";
  stakePaid: number;
  pointsEarned: number | null;
  wasCorrect: boolean | null;
  lockAt: string;
  pickedAt: string;
  resolvedValue: unknown;
  // For match-anchored bets we surface the fixture so the card can
  // render flags + matchup. Null for day/group/stage/tournament scopes.
  matchId: string | null;
  homeCode: string | null;
  homeNameHe: string | null;
  homeNameEn: string | null;
  awayCode: string | null;
  awayNameHe: string | null;
  awayNameEn: string | null;
};

export async function getMyCustomPicks(
  userId: string,
  scopes: Array<"match" | "day" | "group" | "stage" | "tournament">,
  limit = 10,
): Promise<MyCustomPickRow[]> {
  if (scopes.length === 0) return [];
  // drizzle's `inArray` would work but the `scope` column is an enum,
  // which inArray serialises as text rather than the enum type. Building
  // the IN list inline keeps the cast simple.
  const scopeList = sql.join(
    scopes.map((s) => sql`${s}`),
    sql`, `,
  );
  return execRows<MyCustomPickRow>(sql`
    select
      pk.id::text                                 as "pickId",
      cb.id::text                                 as "customBetId",
      cb.scope::text                              as "scope",
      cb.stage::text                              as "stage",
      cb.group_id                                 as "groupId",
      cb.question_he                              as "questionHe",
      cb.question_en                              as "questionEn",
      cb.answer_type::text                        as "answerType",
      cb.answer_config                            as "answerConfig",
      pk.answer                                   as "myAnswer",
      cb.status::text                             as "status",
      pk.stake_paid                               as "stakePaid",
      pk.points_earned                            as "pointsEarned",
      pk.was_correct                              as "wasCorrect",
      cb.lock_at::text                            as "lockAt",
      pk.created_at::text                         as "pickedAt",
      cb.resolved_value                           as "resolvedValue",
      m.id::text                                  as "matchId",
      m.home_team                                 as "homeCode",
      ht.name_he                                  as "homeNameHe",
      ht.name_en                                  as "homeNameEn",
      m.away_team                                 as "awayCode",
      at.name_he                                  as "awayNameHe",
      at.name_en                                  as "awayNameEn"
    from public.user_custom_bet_picks pk
    join public.custom_bets cb on cb.id = pk.custom_bet_id
    left join public.matches m on m.id = cb.match_id
    left join public.teams ht on ht.code = m.home_team
    left join public.teams at on at.code = m.away_team
    where pk.user_id = ${userId}
      and cb.scope::text in (${scopeList})
    order by pk.updated_at desc
    limit ${limit}
  `);
}

// Profile screen: the user's duels (either side). Returns most-recent-first
// with opponent display name resolved and the user's net delta computed
// inline so the card can render +/- without re-deriving the rule table.
export type MyDuelRow = {
  duelId: string;
  questionHe: string;
  questionEn: string;
  myAnswer: boolean;
  isOpener: boolean;
  opponentDisplayName: string | null;
  opponentId: string | null;
  stake: number;
  status: "open" | "matched" | "settled" | "cancelled";
  resolvedValue: boolean | null;
  myPointsDelta: number;
  createdAt: string;
  joinDeadlineAt: string;
  resolveAt: string;
  scope: "match" | "day" | "tournament";
};

export async function getMyDuels(
  userId: string,
  limit = 10,
): Promise<MyDuelRow[]> {
  return execRows<MyDuelRow>(sql`
    select
      d.id::text                                          as "duelId",
      d.question_he                                       as "questionHe",
      d.question_en                                       as "questionEn",
      case when d.opener_id = ${userId}
           then d.opener_answer
           else not d.opener_answer
      end                                                 as "myAnswer",
      (d.opener_id = ${userId})                           as "isOpener",
      case when d.opener_id = ${userId}
           then pj.display_name
           else po.display_name
      end                                                 as "opponentDisplayName",
      case when d.opener_id = ${userId}
           then d.joiner_id::text
           else d.opener_id::text
      end                                                 as "opponentId",
      d.stake::int                                        as "stake",
      d.status::text                                      as "status",
      d.resolved_value                                    as "resolvedValue",
      (${duelCaseSql(userId)})::int                       as "myPointsDelta",
      d.created_at::text                                  as "createdAt",
      d.join_deadline_at::text                            as "joinDeadlineAt",
      d.resolve_at::text                                  as "resolveAt",
      d.scope::text                                       as "scope"
    from public.duels d
    left join public.profiles po on po.id = d.opener_id
    left join public.profiles pj on pj.id = d.joiner_id
    where d.opener_id = ${userId} or d.joiner_id = ${userId}
    order by d.created_at desc
    limit ${limit}
  `);
}

export type TeamRow = {
  code: string;
  nameHe: string;
  nameEn: string;
  flag: string;
};

export async function getAllTeams(): Promise<TeamRow[]> {
  return execRows<TeamRow>(sql`
    select code, name_he as "nameHe", name_en as "nameEn", flag
    from public.teams
    order by name_en asc
  `);
}

export function localizedTeam(
  row: { homeNameHe?: string; awayNameHe?: string; homeNameEn?: string; awayNameEn?: string },
  side: "home" | "away",
  locale: "he" | "en",
): string {
  const key = `${side}Name${locale === "he" ? "He" : "En"}` as keyof typeof row;
  return (row[key] as string) ?? "";
}

// ---------- Player roster ----------
//
// Populated by `scripts/api-football-sync-squads.mjs`. `nameHe` may
// be null until the translation pipeline (PR-3) fills it; the
// `displayName` helper below picks `nameHe` when the locale is
// Hebrew AND it exists, otherwise falls back to `nameEn` so the UI
// never renders an empty string mid-tournament.

export type PlayerRow = {
  id: string;
  apiFootballId: number;
  teamCode: string;
  nameEn: string;
  nameHe: string | null;
  position: string | null;
  jerseyNumber: number | null;
  photoUrl: string | null;
};

export async function getSquadByTeam(teamCode: string): Promise<PlayerRow[]> {
  return execRows<PlayerRow>(sql`
    select
      p.id::text                 as "id",
      p.api_football_id          as "apiFootballId",
      p.team_code                as "teamCode",
      p.name_en                  as "nameEn",
      p.name_he                  as "nameHe",
      p.position                 as "position",
      p.jersey_number            as "jerseyNumber",
      p.photo_url                as "photoUrl"
    from public.players p
    where p.team_code = ${teamCode}
    order by p.jersey_number nulls last, p.name_en asc
  `);
}

export async function getAllPlayers(): Promise<PlayerRow[]> {
  return execRows<PlayerRow>(sql`
    select
      p.id::text                 as "id",
      p.api_football_id          as "apiFootballId",
      p.team_code                as "teamCode",
      p.name_en                  as "nameEn",
      p.name_he                  as "nameHe",
      p.position                 as "position",
      p.jersey_number            as "jerseyNumber",
      p.photo_url                as "photoUrl"
    from public.players p
    order by p.team_code asc, p.jersey_number nulls last, p.name_en asc
  `);
}

export async function getPlayerById(id: string): Promise<PlayerRow | null> {
  return execFirstRow<PlayerRow>(sql`
    select
      p.id::text                 as "id",
      p.api_football_id          as "apiFootballId",
      p.team_code                as "teamCode",
      p.name_en                  as "nameEn",
      p.name_he                  as "nameHe",
      p.position                 as "position",
      p.jersey_number            as "jerseyNumber",
      p.photo_url                as "photoUrl"
    from public.players p
    where p.id = ${id}::uuid
    limit 1
  `);
}

// Pick the right name for the current locale. Falls back to nameEn
// when nameHe is null so signed-in Hebrew users do not see an empty
// chip while the translation pipeline is still running.
export function localizedPlayerName(
  player: { nameEn: string; nameHe: string | null },
  locale: "he" | "en",
): string {
  if (locale === "he" && player.nameHe) return player.nameHe;
  return player.nameEn;
}

// ---------- Player picker (tournament-bet player selection) ----------
//
// Returns the full 1,357-row roster shaped as SearchableOption[] for
// the user-facing PlayerPicker. Sorted: hand-curated stars first
// (Messi, Mbappé, Haaland, ...), then players from stronger national
// teams (per src/lib/players/curation.ts TEAM_RANK), then locale-
// alphabetical within the same team rank. The picker passes this
// list to <SearchableChoicePicker> with lazyChunkSize so only the
// first 10 render until the user clicks "Load more" or searches.

export type PickerLocale = "he" | "en";

export async function loadPlayersForPicker(
  locale: PickerLocale,
): Promise<MultiChoiceOption[]> {
  type Row = {
    apiFootballId: number;
    teamCode: string;
    nameEn: string;
    nameHe: string | null;
    position: string | null;
    jerseyNumber: number | null;
    teamNameEn: string;
    teamNameHe: string;
    teamFlag: string;
  };
  const rows = await execRows<Row>(sql`
    select
      p.api_football_id   as "apiFootballId",
      p.team_code         as "teamCode",
      p.name_en           as "nameEn",
      p.name_he           as "nameHe",
      p.position          as "position",
      p.jersey_number     as "jerseyNumber",
      t.name_en           as "teamNameEn",
      t.name_he           as "teamNameHe",
      t.flag              as "teamFlag"
    from public.players p
    join public.teams   t on t.code = p.team_code
  `);

  const options: MultiChoiceOption[] = rows.map((r) => {
    const positionKey = positionTermKey(r.position);
    const positionHe = positionKey ? POSITION_TERM[positionKey].he : (r.position ?? "");
    const positionEn = positionKey ? POSITION_TERM[positionKey].en : (r.position ?? "");
    const jerseyTag = r.jerseyNumber != null ? `#${r.jerseyNumber}` : "";
    const subtitleHe = [jerseyTag, positionHe].filter(Boolean).join(" · ") || undefined;
    const subtitleEn = [jerseyTag, positionEn].filter(Boolean).join(" · ") || undefined;
    return {
      value:      String(r.apiFootballId),
      labelHe:    r.nameHe ?? r.nameEn,
      labelEn:    r.nameEn,
      groupHe:    r.teamNameHe,
      groupEn:    r.teamNameEn,
      subtitleHe,
      subtitleEn,
      icon:       r.teamFlag,
    };
  });

  // Sort: star rank → team rank → locale-alphabetical label.
  // Side map for O(1) team lookup since MultiChoiceOption itself
  // doesn't carry team_code.
  const teamByValue = new Map<string, string>(
    rows.map((r) => [String(r.apiFootballId), r.teamCode]),
  );
  const collator = new Intl.Collator(locale === "he" ? "he" : "en", { sensitivity: "base" });
  options.sort((a, b) => {
    const aStar = STAR_PLAYER_RANK.get(Number(a.value)) ?? Number.POSITIVE_INFINITY;
    const bStar = STAR_PLAYER_RANK.get(Number(b.value)) ?? Number.POSITIVE_INFINITY;
    if (aStar !== bStar) return aStar - bStar;
    const aTeam = TEAM_RANK.get(teamByValue.get(a.value) ?? "") ?? 99;
    const bTeam = TEAM_RANK.get(teamByValue.get(b.value) ?? "") ?? 99;
    if (aTeam !== bTeam) return aTeam - bTeam;
    const aLabel = locale === "he" ? a.labelHe : a.labelEn;
    const bLabel = locale === "he" ? b.labelHe : b.labelEn;
    return collator.compare(aLabel, bLabel);
  });

  return options;
}

// Tiny lookup so we don't pull the full glossary just for 4 position
// names. Kept here to avoid a circular import between queries.ts and
// the translations module.
const POSITION_TERM = {
  goalkeeper:  { he: "שוער",  en: "Goalkeeper" },
  defender:    { he: "מגן",   en: "Defender" },
  midfielder:  { he: "קשר",   en: "Midfielder" },
  forward:     { he: "חלוץ",  en: "Forward" },
} as const;

function positionTermKey(apiPosition: string | null): keyof typeof POSITION_TERM | null {
  if (!apiPosition) return null;
  const lower = apiPosition.toLowerCase();
  if (lower === "goalkeeper") return "goalkeeper";
  if (lower === "defender")   return "defender";
  if (lower === "midfielder") return "midfielder";
  if (lower === "attacker" || lower === "forward") return "forward";
  return null;
}

// ---------- Live group standings ----------
//
// Derived in pure SQL from finished group-stage matches. Row order follows
// FIFA group-stage tiebreakers: points DESC, goal difference DESC, goals for
// DESC, then team name as a stable final tiebreak. We deliberately stop at
// GF - the remaining tiebreakers (head-to-head + drawing of lots) are rare
// enough that the admin can resolve manually if it ever happens.

export type LiveStandingRow = {
  groupId: string;
  position: number;
  code: string;
  nameHe: string;
  nameEn: string;
  flag: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
};

export type LiveGroup = {
  id: string;
  displayOrder: number;
  rows: LiveStandingRow[];
};

// Raw row shape from the group-standings CTE. Lifted to a type so the
// for-loop below can stay typed without an `as unknown as Array<...>`
// cast at the iteration site.
type LiveStandingsRowRaw = {
  group_id: string;
  display_order: number;
  code: string;
  name_he: string;
  name_en: string;
  flag: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
};

export async function getLiveStandings(): Promise<LiveGroup[]> {
  const rows = await execRows<LiveStandingsRowRaw>(sql`
    with leg as (
      -- One row per (team, match) for every finished group-stage match.
      -- Materialising both sides via UNION lets the aggregation below stay
      -- symmetric and trivially correct.
      select
        m.group_id,
        m.home_team as team_code,
        m.home_score as gf,
        m.away_score as ga,
        case
          when m.home_score > m.away_score then 3
          when m.home_score = m.away_score then 1
          else 0
        end as pts,
        case when m.home_score > m.away_score then 1 else 0 end as won,
        case when m.home_score = m.away_score then 1 else 0 end as drawn,
        case when m.home_score < m.away_score then 1 else 0 end as lost
      from public.matches m
      where m.stage = 'group'
        and m.status = 'final'
        and m.home_score is not null
        and m.away_score is not null
      union all
      select
        m.group_id,
        m.away_team as team_code,
        m.away_score as gf,
        m.home_score as ga,
        case
          when m.away_score > m.home_score then 3
          when m.away_score = m.home_score then 1
          else 0
        end as pts,
        case when m.away_score > m.home_score then 1 else 0 end as won,
        case when m.away_score = m.home_score then 1 else 0 end as drawn,
        case when m.away_score < m.home_score then 1 else 0 end as lost
      from public.matches m
      where m.stage = 'group'
        and m.status = 'final'
        and m.home_score is not null
        and m.away_score is not null
    ),
    agg as (
      select
        g.id                                  as group_id,
        g.display_order                       as display_order,
        t.code                                as code,
        t.name_he                             as name_he,
        t.name_en                             as name_en,
        t.flag                                as flag,
        coalesce(count(leg.*) filter (where leg.team_code is not null), 0)::int as played,
        coalesce(sum(leg.won), 0)::int        as won,
        coalesce(sum(leg.drawn), 0)::int      as drawn,
        coalesce(sum(leg.lost), 0)::int       as lost,
        coalesce(sum(leg.gf), 0)::int         as goals_for,
        coalesce(sum(leg.ga), 0)::int         as goals_against,
        coalesce(sum(leg.gf) - sum(leg.ga), 0)::int as goal_diff,
        coalesce(sum(leg.pts), 0)::int        as points
      from public.groups g
      join public.teams t on t.group_id = g.id
      left join leg on leg.team_code = t.code and leg.group_id = g.id
      group by g.id, g.display_order, t.code, t.name_he, t.name_en, t.flag
    )
    select * from agg
    order by display_order asc, points desc, goal_diff desc, goals_for desc, name_en asc
  `);

  const grouped = new Map<string, LiveGroup>();
  let runningPos = 0;
  let lastGroup: string | null = null;
  for (const r of rows) {
    if (r.group_id !== lastGroup) {
      runningPos = 0;
      lastGroup = r.group_id;
    }
    runningPos += 1;
    let entry = grouped.get(r.group_id);
    if (!entry) {
      entry = { id: r.group_id, displayOrder: Number(r.display_order), rows: [] };
      grouped.set(r.group_id, entry);
    }
    entry.rows.push({
      groupId: r.group_id,
      position: runningPos,
      code: r.code,
      nameHe: r.name_he,
      nameEn: r.name_en,
      flag: r.flag,
      played: Number(r.played),
      won: Number(r.won),
      drawn: Number(r.drawn),
      lost: Number(r.lost),
      goalsFor: Number(r.goals_for),
      goalsAgainst: Number(r.goals_against),
      goalDiff: Number(r.goal_diff),
      points: Number(r.points),
    });
  }
  return Array.from(grouped.values()).sort(
    (a, b) => a.displayOrder - b.displayOrder,
  );
}

// ---------- Team profile data ----------

export type TeamProfile = {
  code: string;
  nameHe: string;
  nameEn: string;
  flag: string;
  groupId: string | null;
};

export async function getTeamByCode(code: string): Promise<TeamProfile | null> {
  return execFirstRow<TeamProfile>(sql`
    select code, name_he as "nameHe", name_en as "nameEn", flag, group_id as "groupId"
    from public.teams
    where code = ${code.toUpperCase()}
    limit 1
  `);
}

export type TeamMatchRow = {
  matchId: string;
  kickoffAt: string;
  stage: string;
  groupId: string | null;
  status: "scheduled" | "live" | "final";
  isHome: boolean;
  opponentCode: string;
  opponentNameHe: string;
  opponentNameEn: string;
  opponentFlag: string;
  goalsFor: number | null;
  goalsAgainst: number | null;
  wentToPenalties: boolean | null;
};

export async function getTeamMatches(code: string): Promise<TeamMatchRow[]> {
  const upper = code.toUpperCase();
  return execRows<TeamMatchRow>(sql`
    select
      m.id::text                                    as "matchId",
      m.kickoff_at                                  as "kickoffAt",
      m.stage::text                                 as "stage",
      m.group_id                                    as "groupId",
      m.status::text                                as "status",
      (m.home_team = ${upper})                      as "isHome",
      case when m.home_team = ${upper}
           then m.away_team else m.home_team end    as "opponentCode",
      case when m.home_team = ${upper}
           then aw.name_he else ho.name_he end      as "opponentNameHe",
      case when m.home_team = ${upper}
           then aw.name_en else ho.name_en end      as "opponentNameEn",
      case when m.home_team = ${upper}
           then aw.flag else ho.flag end            as "opponentFlag",
      case when m.home_team = ${upper}
           then m.home_score else m.away_score end  as "goalsFor",
      case when m.home_team = ${upper}
           then m.away_score else m.home_score end  as "goalsAgainst",
      m.went_to_penalties                           as "wentToPenalties"
    from public.matches m
    join public.teams ho on ho.code = m.home_team
    join public.teams aw on aw.code = m.away_team
    where m.home_team = ${upper}
       or m.away_team = ${upper}
    order by m.kickoff_at asc
  `);
}

// ---------- Head-to-head ----------

export type H2HMatch = {
  matchId: string;
  kickoffAt: string;
  stage: string;
  status: "scheduled" | "live" | "final";
  aGoals: number | null;
  bGoals: number | null;
  aIsHome: boolean;
  wentToPenalties: boolean | null;
};

// Tournament matches between two teams (past + scheduled). Codes are
// 3-letter; case-insensitive. Returns chronological order.
export async function getHeadToHead(a: string, b: string): Promise<H2HMatch[]> {
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  return execRows<H2HMatch>(sql`
    select
      m.id::text                              as "matchId",
      m.kickoff_at                            as "kickoffAt",
      m.stage::text                           as "stage",
      m.status::text                          as "status",
      case when m.home_team = ${A}
           then m.home_score else m.away_score end as "aGoals",
      case when m.home_team = ${A}
           then m.away_score else m.home_score end as "bGoals",
      (m.home_team = ${A})                    as "aIsHome",
      m.went_to_penalties                     as "wentToPenalties"
    from public.matches m
    where (m.home_team = ${A} and m.away_team = ${B})
       or (m.home_team = ${B} and m.away_team = ${A})
    order by m.kickoff_at asc
  `);
}

// ---------- Public pool stats ----------
//
// Used by the landing/dashboard hero card. The pot is the sum of all
// approved entry-fee payments; the player count is how many distinct users
// have an approved payment (i.e. paid in). Both numbers must be live - the
// hero card never shows a placeholder.

export type PoolStats = {
  potIls: number;
  participants: number;
};

// Cached cross-request — the pool only changes when a payment row is
// inserted or its status flips. Admin payment-actions call
// revalidateTag(CACHE_TAG_POOL) after the mutation, so every visitor
// sees the new number on their next paint without us hammering the
// payments table on every render.
export const getPoolStats = unstable_cache(
  async (): Promise<PoolStats> => {
    const r = await execFirstRow<{ pot: number; players: number }>(sql`
      select
        coalesce(sum(amount_ils) filter (where status = 'approved'), 0)::int as pot,
        count(distinct user_id) filter (where status = 'approved')::int       as players
      from public.payments
    `);
    return {
      potIls: Number(r?.pot ?? 0),
      participants: Number(r?.players ?? 0),
    };
  },
  ["getPoolStats"],
  { tags: [CACHE_TAG_POOL], revalidate: 600 },
);

// ---------- Prize-pool split ----------
//
// Dynamic prize amounts for the top 4 finishers. The admin tunes only the
// percentages (settings.prize_pct_N); each amount = floor(pot * pct / 100)
// so it tracks the live pot without any cash math in the admin UI.

// 7-way category prize split (king 1/2/3 + matches/live/duels winner + reserve).
// Groups by category rather than rank 1-4 so the prize UI can render
// alongside the four-tab leaderboard.
export type CategoryPrizeKey =
  | "king_first"
  | "king_second"
  | "king_third"
  | "matches_winner"
  | "live_winner"
  | "duels_winner"
  | "reserve";

export type CategoryPrizeBreakdown = {
  potIls: number;
  // Fixed setup cost pulled off the pot before percentages are applied.
  // The whole category split runs on `distributableIls`.
  overheadIls: number;
  distributableIls: number;
  prizes: Array<{ key: CategoryPrizeKey; pct: number; ils: number }>;
  totalAwardedIls: number;
};

// Cached cross-request. Splits the prize pot by category (king 1/2/3 +
// matches/live/duels winner + reserve) for the rules page. Tagged with
// both pool and settings — payments and the prize percentages both
// invalidate it.
async function loadCategoryPrizeBreakdownFromDb(): Promise<CategoryPrizeBreakdown> {
  const r = await execFirstRow<{
    pot: number;
    overhead: number;
    king_first: number;
    king_second: number;
    king_third: number;
    matches_winner: number;
    live_winner: number;
    duels_winner: number;
    reserve: number;
  }>(sql`
    select
      coalesce((
        select sum(amount_ils) filter (where status = 'approved')
        from public.payments
      ), 0)::int                                                        as "pot",
      (select admin_overhead_ils        from public.settings where id = 1)::int as "overhead",
      (select prize_king_first_pct      from public.settings where id = 1)::int as "king_first",
      (select prize_king_second_pct     from public.settings where id = 1)::int as "king_second",
      (select prize_king_third_pct      from public.settings where id = 1)::int as "king_third",
      (select prize_matches_winner_pct  from public.settings where id = 1)::int as "matches_winner",
      (select prize_live_winner_pct     from public.settings where id = 1)::int as "live_winner",
      (select prize_duels_winner_pct    from public.settings where id = 1)::int as "duels_winner",
      (select prize_reserve_pct         from public.settings where id = 1)::int as "reserve"
  `);
  const pot = Number(r?.pot ?? 0);
  const overhead = Number(r?.overhead ?? 0);
  // Distributable pot floors at 0 — if the pot has not covered the
  // setup cost yet, every category prize is 0 ILS but the percentages
  // still render so users can see the shape of the eventual split.
  const distributable = Math.max(0, pot - overhead);
  const keys: Array<{ key: CategoryPrizeKey; pct: number }> = [
    { key: "king_first",     pct: Number(r?.king_first ?? 0) },
    { key: "king_second",    pct: Number(r?.king_second ?? 0) },
    { key: "king_third",     pct: Number(r?.king_third ?? 0) },
    { key: "matches_winner", pct: Number(r?.matches_winner ?? 0) },
    { key: "live_winner",    pct: Number(r?.live_winner ?? 0) },
    { key: "duels_winner",   pct: Number(r?.duels_winner ?? 0) },
    { key: "reserve",        pct: Number(r?.reserve ?? 0) },
  ];
  const prizes = keys.map((k) => ({
    ...k,
    ils: Math.floor((distributable * k.pct) / 100),
  }));
  const totalAwardedIls = prizes.reduce((s, p) => s + p.ils, 0);
  return {
    potIls: pot,
    overheadIls: overhead,
    distributableIls: distributable,
    prizes,
    totalAwardedIls,
  };
}

export const getCategoryPrizeBreakdown = unstable_cache(
  loadCategoryPrizeBreakdownFromDb,
  ["getCategoryPrizeBreakdown"],
  { tags: [CACHE_TAG_POOL, CACHE_TAG_SETTINGS], revalidate: 600 },
);

// ---------- Points-bank history ----------
//
// Returns every event that touches a user's bank, ordered chronologically.
// The UI on /[lang]/me/bank walks this in order to show a running balance.

export type BankEventKind =
  | "start"
  | "payout_match"
  | "stake_custom"
  | "payout_custom"
  | "adjustment";

export type BankEvent = {
  at: string;
  kind: BankEventKind;
  delta: number;
  detail: string | null;
};

export async function getBankHistory(userId: string): Promise<BankEvent[]> {
  return execRows<BankEvent>(sql`
    with start_event as (
      select
        p.created_at::text                                             as "at",
        'start'::text                                                  as "kind",
        (select starting_bank from public.settings where id = 1)::int  as "delta",
        null::text                                                     as "detail"
      from public.profiles p
      where p.id = ${userId}
    ),
    match_payouts as (
      -- Payout for the main 1/X/2 prediction once the match goes final.
      select mb.updated_at::text       as "at",
             'payout_match'::text      as "kind",
             coalesce(mb.points_earned, 0) as "delta",
             mb.match_id::text         as "detail"
      from public.match_bets mb
      where mb.user_id = ${userId} and mb.points_earned is not null
    ),
    custom_stakes as (
      -- One row per custom-bet pick at the moment it was placed.
      select pk.created_at::text       as "at",
             'stake_custom'::text      as "kind",
             -pk.stake_paid            as "delta",
             pk.custom_bet_id::text    as "detail"
      from public.user_custom_bet_picks pk
      where pk.user_id = ${userId} and pk.stake_paid > 0
    ),
    custom_payouts as (
      select pk.updated_at::text       as "at",
             'payout_custom'::text     as "kind",
             coalesce(pk.points_earned, 0) as "delta",
             pk.custom_bet_id::text    as "detail"
      from public.user_custom_bet_picks pk
      where pk.user_id = ${userId} and pk.points_earned is not null
    ),
    adjustments as (
      select pa.created_at::text       as "at",
             'adjustment'::text        as "kind",
             pa.delta                  as "delta",
             pa.reason                 as "detail"
      from public.point_adjustments pa
      where pa.user_id = ${userId}
    ),
    all_events as (
      select * from start_event
      union all select * from match_payouts
      union all select * from custom_stakes
      union all select * from custom_payouts
      union all select * from adjustments
    )
    select "at", "kind"::text as "kind", "delta"::int as "delta", "detail"
    from all_events
    order by "at" desc
    limit 500
  `);
}

// ---------- Custom bets - player surfaces ----------
//
// Three queries power the play pages:
//   listOpenPlayDays   → /play index - every date that has at least one open
//                        custom bet, plus the day's match count + a 1‑line
//                        fixtures preview so the card is informative.
//   getPlayDayDetail   → /play/[date] - the fixtures + every open custom bet
//                        that targets that day (scope='day' OR scope='match'
//                        anchored on a match that day), with the caller's
//                        current pick (if any) folded onto each bet row.
//   getOpenTournamentBetCount / getOpenGroupBetCount - counters for the
//                        pinned tournament / groups cards on the index.

export type PlayDayRow = {
  date: string;                    // YYYY-MM-DD, Asia/Jerusalem
  openBetCount: number;
  matchCount: number;
  firstKickoffAt: string;
  flagsPreview: string;            // "🇧🇷 🇩🇪 🇺🇸 …" (already in DB)
};

export async function listOpenPlayDays(): Promise<PlayDayRow[]> {
  return execRows<PlayDayRow>(sql`
    with days as (
      -- Every Asia/Jerusalem date that has either fixtures OR open bets.
      select to_char((m.kickoff_at at time zone 'Asia/Jerusalem')::date,
                     'YYYY-MM-DD') as date,
             min(m.kickoff_at)                                as first_kickoff,
             count(*)::int                                    as match_count,
             string_agg(distinct ht.flag, ' ' order by ht.flag) ||
               ' ' ||
               string_agg(distinct at.flag, ' ' order by at.flag) as flags
      from public.matches m
      join public.teams ht on ht.code = m.home_team
      join public.teams at on at.code = m.away_team
      where m.status in ('scheduled', 'live')
      group by (m.kickoff_at at time zone 'Asia/Jerusalem')::date
    ),
    bet_counts as (
      -- Open bets per day, counting both day-scope (direct matchday FK)
      -- and match-scope (FK on a match whose Asia/Jerusalem date matches).
      select day::text as date, sum(c)::int as open_bet_count
      from (
        select to_char(md.date, 'YYYY-MM-DD')::date as day,
               count(*)::int as c
        from public.custom_bets cb
        join public.matchdays md on md.id = cb.matchday_id
        where cb.scope = 'day' and cb.status = 'open' and cb.lock_at > now()
        group by md.date
        union all
        select (m.kickoff_at at time zone 'Asia/Jerusalem')::date as day,
               count(*)::int
        from public.custom_bets cb
        join public.matches m on m.id = cb.match_id
        where cb.scope = 'match' and cb.status = 'open' and cb.lock_at > now()
        group by (m.kickoff_at at time zone 'Asia/Jerusalem')::date
      ) per_scope
      group by day
    )
    select
      d.date                                          as "date",
      coalesce(bc.open_bet_count, 0)::int             as "openBetCount",
      d.match_count                                   as "matchCount",
      d.first_kickoff::text                           as "firstKickoffAt",
      d.flags                                         as "flagsPreview"
    from days d
    left join bet_counts bc on bc.date::text = d.date
    order by d.date asc
  `);
}

export type PlayFixture = {
  id: string;
  kickoffAt: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  status: "scheduled" | "live" | "final";
  myHome: number | null;
  myAway: number | null;
};

export type PlayBetRow = {
  id: string;
  scope: "match" | "day";          // only these two scopes appear on /play/[date]
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;            // raw JSONB - caller casts via AnswerConfig
  stakeSnapshot: number;
  payoutSnapshot: number;
  lockAt: string;
  status: "open" | "locked";        // we only fetch these two
  matchId: string | null;
  matchLabel: string | null;        // "BRA vs GER" for match-scope
  myAnswer: unknown | null;         // raw JSONB; null when caller hasn't picked
  myStakePaid: number | null;
};

export type PlayDayDetail = {
  date: string;
  matchdayId: string | null;
  fixtures: PlayFixture[];
  bets: PlayBetRow[];
} | null;

// Returns everything `/play/[date]` needs in one trip. Returns null when
// the date has no fixtures AND no bets (so the page can render notFound).
export async function getPlayDayDetail(
  date: string,
  userId: string,
): Promise<PlayDayDetail> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const fxList = await execRows<PlayFixture>(sql`
    select
      m.id::text       as "id",
      m.kickoff_at     as "kickoffAt",
      m.home_team      as "homeCode",
      ht.name_he       as "homeNameHe",
      ht.name_en       as "homeNameEn",
      m.away_team      as "awayCode",
      at.name_he       as "awayNameHe",
      at.name_en       as "awayNameEn",
      m.status::text   as "status",
      mb.home_score    as "myHome",
      mb.away_score    as "myAway"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    left join public.match_bets mb on mb.match_id = m.id and mb.user_id = ${userId}
    where (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${date}::date
    order by m.kickoff_at asc
  `);

  const betList = await execRows<PlayBetRow>(sql`
    select
      cb.id::text                                 as "id",
      cb.scope::text                              as "scope",
      cb.question_he                              as "questionHe",
      cb.question_en                              as "questionEn",
      cb.grading_rule_he                          as "gradingRuleHe",
      cb.grading_rule_en                          as "gradingRuleEn",
      cb.answer_type::text                        as "answerType",
      cb.answer_config                            as "answerConfig",
      cb.stake_snapshot                           as "stakeSnapshot",
      cb.payout_snapshot                          as "payoutSnapshot",
      cb.lock_at                                  as "lockAt",
      cb.status::text                             as "status",
      cb.match_id::text                           as "matchId",
      case when cb.match_id is not null
        then m.home_team || ' vs ' || m.away_team
        else null end                             as "matchLabel",
      pk.answer                                   as "myAnswer",
      pk.stake_paid                               as "myStakePaid"
    from public.custom_bets cb
    left join public.matches    m  on m.id = cb.match_id
    left join public.matchdays  md on md.id = cb.matchday_id
    left join public.user_custom_bet_picks pk
      on pk.custom_bet_id = cb.id and pk.user_id = ${userId}
    where cb.status in ('open', 'locked')
      and (
        (cb.scope = 'day'   and md.date = ${date}::date) or
        (cb.scope = 'match' and (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${date}::date)
      )
    order by
      cb.scope asc,
      cb.lock_at asc
  `);

  if (fxList.length === 0 && betList.length === 0) return null;

  const md = await execFirstRow<{ id: string | null }>(sql`
    select md.id::text as id
    from public.matchdays md
    where md.date = ${date}::date
    limit 1
  `);
  const matchdayId = md?.id ?? null;

  return {
    date,
    matchdayId,
    fixtures: fxList,
    bets: betList,
  };
}

// Tournament + stage bets for /play/tournament. We expose `stage` so the
// page can group bets under "Group stage", "QF", "Final", etc. Bets with
// scope='tournament' have stage=null and render in their own bucket.
export type TournamentPlayBetRow = {
  id: string;
  scope: "tournament" | "stage";
  stage: "group" | "r32" | "r16" | "qf" | "sf" | "third_place" | "final" | null;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  stakeSnapshot: number;
  payoutSnapshot: number;
  lockAt: string;
  status: "open" | "locked";
  myAnswer: unknown | null;
  myStakePaid: number | null;
};

export async function getTournamentPlayBets(
  userId: string,
): Promise<TournamentPlayBetRow[]> {
  return execRows<TournamentPlayBetRow>(sql`
    select
      cb.id::text                                 as "id",
      cb.scope::text                              as "scope",
      cb.stage::text                              as "stage",
      cb.question_he                              as "questionHe",
      cb.question_en                              as "questionEn",
      cb.grading_rule_he                          as "gradingRuleHe",
      cb.grading_rule_en                          as "gradingRuleEn",
      cb.answer_type::text                        as "answerType",
      cb.answer_config                            as "answerConfig",
      cb.stake_snapshot                           as "stakeSnapshot",
      cb.payout_snapshot                          as "payoutSnapshot",
      cb.lock_at                                  as "lockAt",
      cb.status::text                             as "status",
      pk.answer                                   as "myAnswer",
      pk.stake_paid                               as "myStakePaid"
    from public.custom_bets cb
    left join public.user_custom_bet_picks pk
      on pk.custom_bet_id = cb.id and pk.user_id = ${userId}
    where cb.status in ('open', 'locked')
      and cb.scope in ('tournament', 'stage')
    order by
      case cb.stage
        when 'group'        then 1
        when 'r32'          then 2
        when 'r16'          then 3
        when 'qf'           then 4
        when 'sf'           then 5
        when 'third_place'  then 6
        when 'final'        then 7
        else                     8
      end asc nulls last,
      cb.lock_at asc
  `);
}

// Per-group bets for /play/groups. Returned with the group's display
// order so the UI can present panels in A..H sequence.
export type GroupPlayBetRow = {
  id: string;
  groupId: string;
  groupDisplayOrder: number;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  stakeSnapshot: number;
  payoutSnapshot: number;
  lockAt: string;
  status: "open" | "locked";
  myAnswer: unknown | null;
  myStakePaid: number | null;
};

export async function getGroupPlayBets(
  userId: string,
): Promise<GroupPlayBetRow[]> {
  return execRows<GroupPlayBetRow>(sql`
    select
      cb.id::text                                 as "id",
      cb.group_id                                 as "groupId",
      g.display_order                             as "groupDisplayOrder",
      cb.question_he                              as "questionHe",
      cb.question_en                              as "questionEn",
      cb.grading_rule_he                          as "gradingRuleHe",
      cb.grading_rule_en                          as "gradingRuleEn",
      cb.answer_type::text                        as "answerType",
      cb.answer_config                            as "answerConfig",
      cb.stake_snapshot                           as "stakeSnapshot",
      cb.payout_snapshot                          as "payoutSnapshot",
      cb.lock_at                                  as "lockAt",
      cb.status::text                             as "status",
      pk.answer                                   as "myAnswer",
      pk.stake_paid                               as "myStakePaid"
    from public.custom_bets cb
    join public.groups g on g.id = cb.group_id
    left join public.user_custom_bet_picks pk
      on pk.custom_bet_id = cb.id and pk.user_id = ${userId}
    where cb.status in ('open', 'locked')
      and cb.scope = 'group'
    order by g.display_order asc, cb.lock_at asc
  `);
}

// Counters for the pinned cards on /play. Cheap - single index scan each.
export async function getOpenTournamentBetCount(): Promise<number> {
  const row = await execFirstRow<{ n: number }>(sql`
    select count(*)::int as n
    from public.custom_bets
    where status = 'open'
      and scope in ('tournament', 'stage')
      and lock_at > now()
  `);
  return row?.n ?? 0;
}

export async function getOpenGroupBetCount(): Promise<number> {
  const row = await execFirstRow<{ n: number }>(sql`
    select count(*)::int as n
    from public.custom_bets
    where status = 'open' and scope = 'group' and lock_at > now()
  `);
  return row?.n ?? 0;
}

// Earliest scheduled match kickoff - i.e. when the tournament starts. Used
// by the landing hero countdown. Returns null if no fixtures have been
// seeded yet, in which case the caller should hide the countdown rather
// than show a placeholder.
//
// Cached cross-request: the value only moves when the fixtures table
// changes (admin sync, manual edits). The home page asks for this on
// every paint, so caching it means most renders skip the DB roundtrip
// entirely. Revalidation: admin sync actions call
// revalidateTag(CACHE_TAG_FIXTURES) after fixture imports.
export const getTournamentStart = unstable_cache(
  async (): Promise<string | null> => {
    const row = await execFirstRow<{ kickoff_at: string | null }>(sql`
      select min(kickoff_at) as kickoff_at
      from public.matches
    `);
    return row?.kickoff_at ?? null;
  },
  ["getTournamentStart"],
  { tags: [CACHE_TAG_FIXTURES], revalidate: 3600 },
);

// Transparency feed surfaces every locked bet across the pool so
// players can audit who picked what once a bet stops being editable.
// Drives /[lang]/transparency.
//
// Visibility rules (mirror §9 of the betting overhaul plan):
//   match bets    → visible once the match status is live or final
//   live bets     → visible once custom_bets.lock_at has passed
//   duels         → visible from creation; opener identity is part of
//                   the challenge UX so we never hide it

export type TransparencyCategory = "match" | "live" | "duel";

export type TransparencyRow = {
  category: TransparencyCategory;
  eventTime: string;
  userId: string;
  displayName: string;
  question: string;
  pickLabel: string;
  stake: number;
  pointsEarned: number | null;
  status: string;
  bookId: string;
};

export type TransparencyFilters = {
  userId?: string;
  category?: TransparencyCategory;
  date?: string;
  locale: "he" | "en";
};

export async function getTransparencyFeed(
  filters: TransparencyFilters,
  limit = 100,
): Promise<TransparencyRow[]> {
  const homeNameCol = filters.locale === "he" ? sql`ht.name_he` : sql`ht.name_en`;
  const awayNameCol = filters.locale === "he" ? sql`at.name_he` : sql`at.name_en`;
  const questionCol = filters.locale === "he" ? sql`cb.question_he` : sql`cb.question_en`;
  const duelQuestionCol = filters.locale === "he" ? sql`d.question_he` : sql`d.question_en`;
  const yesLabel = filters.locale === "he" ? sql`'כן'` : sql`'Yes'`;
  const noLabel = filters.locale === "he" ? sql`'לא'` : sql`'No'`;

  // Build the WHERE clause from optional filters. Each one is an AND
  // condition; if none are supplied we omit the WHERE entirely.
  const conds: ReturnType<typeof sql>[] = [];
  if (filters.category) conds.push(sql`src.category = ${filters.category}`);
  if (filters.userId) conds.push(sql`src.user_id = ${filters.userId}::uuid`);
  if (filters.date) {
    conds.push(
      sql`(src.event_time at time zone 'Asia/Jerusalem')::date = ${filters.date}::date`,
    );
  }
  let whereClause = sql``;
  if (conds.length > 0) {
    whereClause = sql`where ${conds[0]}`;
    for (let i = 1; i < conds.length; i += 1) {
      whereClause = sql`${whereClause} and ${conds[i]}`;
    }
  }

  return execRows<TransparencyRow>(sql`
    with combined as (
      select
        'match'::text                                              as category,
        m.kickoff_at::text                                         as event_time,
        mb.user_id::text                                           as user_id,
        p.display_name                                             as display_name,
        (${homeNameCol} || ' vs ' || ${awayNameCol})               as question,
        (mb.home_score || '-' || mb.away_score)                    as pick_label,
        coalesce(mb.stake_paid_main, 0)::int                       as stake,
        mb.points_earned                                           as points_earned,
        m.status::text                                             as status,
        mb.id::text                                                as book_id
      from public.match_bets mb
      join public.matches m  on m.id  = mb.match_id
      join public.teams ht   on ht.code = m.home_team
      join public.teams at   on at.code = m.away_team
      join public.profiles p on p.id  = mb.user_id
      where m.status in ('live', 'final')

      union all

      select
        'live'::text                                               as category,
        cb.lock_at::text                                           as event_time,
        pk.user_id::text                                           as user_id,
        p.display_name                                             as display_name,
        ${questionCol}                                             as question,
        case pk.answer->>'value'
          when 'true'  then ${yesLabel}
          when 'false' then ${noLabel}
          else coalesce(pk.answer->>'value', '?')
        end                                                        as pick_label,
        pk.stake_paid::int                                         as stake,
        pk.points_earned                                           as points_earned,
        cb.status::text                                            as status,
        pk.id::text                                                as book_id
      from public.user_custom_bet_picks pk
      join public.custom_bets cb on cb.id = pk.custom_bet_id
      join public.profiles p     on p.id  = pk.user_id
      where cb.lock_at <= now()

      union all

      select
        'duel'::text                                               as category,
        d.created_at::text                                         as event_time,
        d.opener_id::text                                          as user_id,
        po.display_name                                            as display_name,
        ${duelQuestionCol}                                         as question,
        case when d.opener_answer then ${yesLabel} else ${noLabel} end as pick_label,
        d.stake::int                                               as stake,
        case when d.status = 'settled'
             then case when d.resolved_value = d.opener_answer then d.stake else -d.stake end
             else null
        end                                                        as points_earned,
        d.status::text                                             as status,
        d.id::text                                                 as book_id
      from public.duels d
      join public.profiles po on po.id = d.opener_id

      union all

      select
        'duel'::text                                               as category,
        coalesce(d.joined_at, d.created_at)::text                  as event_time,
        d.joiner_id::text                                          as user_id,
        pj.display_name                                            as display_name,
        ${duelQuestionCol}                                         as question,
        case when d.opener_answer then ${noLabel} else ${yesLabel} end as pick_label,
        d.stake::int                                               as stake,
        case when d.status = 'settled'
             then case when d.resolved_value = d.opener_answer then -d.stake else d.stake end
             else null
        end                                                        as points_earned,
        d.status::text                                             as status,
        ('joiner:' || d.id::text)                                  as book_id
      from public.duels d
      join public.profiles pj on pj.id = d.joiner_id
      where d.joiner_id is not null
    )
    select
      src.category       as "category",
      src.event_time     as "eventTime",
      src.user_id        as "userId",
      src.display_name   as "displayName",
      src.question       as "question",
      src.pick_label     as "pickLabel",
      src.stake          as "stake",
      src.points_earned  as "pointsEarned",
      src.status         as "status",
      src.book_id        as "bookId"
    from combined src
    ${whereClause}
    order by src.event_time desc
    limit ${limit}
  `);
}

export async function getTransparencyUsers(): Promise<
  Array<{ id: string; displayName: string }>
> {
  return execRows<{ id: string; displayName: string }>(sql`
    select distinct p.id::text as "id", p.display_name as "displayName"
    from public.profiles p
    where exists (select 1 from public.match_bets mb where mb.user_id = p.id)
       or exists (select 1 from public.user_custom_bet_picks pk where pk.user_id = p.id)
       or exists (select 1 from public.duels d where d.opener_id = p.id or d.joiner_id = p.id)
    order by p.display_name asc
  `);
}

// Aggregated per-user performance card for /me/bank.
//
// Splits earnings into the three surfaces (matches / live / duels)
// plus accuracy counters. Every value is computed live from the
// source tables - no materialised cache - so the numbers always
// reflect the same balance the leaderboard uses.

export type BankStats = {
  matchPoints: number;        // Σ match_bets.points_earned (can be negative under risk mode)
  livePoints: number;         // Σ (payouts − stake_paid) for live bets (net)
  duelDelta: number;          // duel delta from the bank.ts formula
  matchHits: number;          // count of match bets that were direction or exact
  exactHits: number;          // count of match bets with exact-score correct
  duelsOpened: number;
  duelsJoined: number;
  duelsWon: number;           // settled duels where the user was on the winning side
  duelsParticipated: number;  // matched + settled regardless of outcome
};

export async function getBankStats(userId: string): Promise<BankStats> {
  const r = await execFirstRow<{
    match_points: number;
    live_points: number;
    duel_delta: number;
    match_hits: number;
    exact_hits: number;
    duels_opened: number;
    duels_joined: number;
    duels_won: number;
    duels_participated: number;
  }>(sql`
    select
      coalesce((
        select sum(coalesce(mb.points_earned, 0))::int
        from public.match_bets mb where mb.user_id = ${userId}
      ), 0)                                                       as match_points,

      coalesce((
        select sum(coalesce(pk.points_earned, 0) - pk.stake_paid)::int
        from public.user_custom_bet_picks pk where pk.user_id = ${userId}
      ), 0)                                                       as live_points,

      ${duelDeltaSql(userId)}                                     as duel_delta,

      coalesce((
        select count(*)::int from public.match_bets mb
        where mb.user_id = ${userId}
          and (mb.was_exact = true or mb.was_correct_outcome = true)
      ), 0)                                                       as match_hits,

      coalesce((
        select count(*)::int from public.match_bets mb
        where mb.user_id = ${userId} and mb.was_exact = true
      ), 0)                                                       as exact_hits,

      coalesce((
        select count(*)::int from public.duels d
        where d.opener_id = ${userId}
      ), 0)                                                       as duels_opened,

      coalesce((
        select count(*)::int from public.duels d
        where d.joiner_id = ${userId}
      ), 0)                                                       as duels_joined,

      coalesce((
        select count(*)::int from public.duels d
        where d.status = 'settled'
          and (
            (d.opener_id = ${userId} and d.resolved_value = d.opener_answer)
            or
            (d.joiner_id = ${userId} and d.resolved_value <> d.opener_answer)
          )
      ), 0)                                                       as duels_won,

      coalesce((
        select count(*)::int from public.duels d
        where (d.opener_id = ${userId} or d.joiner_id = ${userId})
          and d.status in ('matched', 'settled')
      ), 0)                                                       as duels_participated
  `);
  return {
    matchPoints: Number(r?.match_points ?? 0),
    livePoints: Number(r?.live_points ?? 0),
    duelDelta: Number(r?.duel_delta ?? 0),
    matchHits: Number(r?.match_hits ?? 0),
    exactHits: Number(r?.exact_hits ?? 0),
    duelsOpened: Number(r?.duels_opened ?? 0),
    duelsJoined: Number(r?.duels_joined ?? 0),
    duelsWon: Number(r?.duels_won ?? 0),
    duelsParticipated: Number(r?.duels_participated ?? 0),
  };
}

// Live matches feed for /[lang]/live. Returns every fixture currently
// in 'live' status plus matches finalised within the last 90 minutes
// (so the page still has something to show during half-time / right
// after the whistle) and the signed-in viewer's pick if any.

export type LiveMatchRow = {
  id: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  kickoffAt: string;
  status: "live" | "final";
  homeScore: number | null;
  awayScore: number | null;
  myHomeScore: number | null;
  myAwayScore: number | null;
  myPointsEarned: number | null;
};

export async function getLiveMatches(userId: string): Promise<LiveMatchRow[]> {
  return execRows<LiveMatchRow>(sql`
    select
      m.id::text                                          as "id",
      m.home_team                                         as "homeCode",
      ht.name_he                                          as "homeNameHe",
      ht.name_en                                          as "homeNameEn",
      m.away_team                                         as "awayCode",
      at.name_he                                          as "awayNameHe",
      at.name_en                                          as "awayNameEn",
      m.kickoff_at::text                                  as "kickoffAt",
      m.status::text                                      as "status",
      m.home_score                                        as "homeScore",
      m.away_score                                        as "awayScore",
      mb.home_score                                       as "myHomeScore",
      mb.away_score                                       as "myAwayScore",
      mb.points_earned                                    as "myPointsEarned"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    left join public.match_bets mb on mb.match_id = m.id and mb.user_id = ${userId}
    where m.status = 'live'
       or (m.status = 'final'
           and coalesce(m.finalized_at, m.kickoff_at) > now() - interval '90 minutes')
    order by
      case when m.status = 'live' then 0 else 1 end,
      m.kickoff_at asc
    limit 50
  `);
}

