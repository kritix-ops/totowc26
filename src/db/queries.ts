import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { execFirstRow, execRows } from "./helpers";
import { approvedPotIlsSql, paidParticipantsSql } from "./pot";
import type { MultiChoiceOption } from "@/lib/bets/types";
import { renderPickAnswer } from "@/lib/bets/format";
import { fetchPlayerNamesById } from "@/lib/bets/players";
import { bankBalanceSql, duelCaseSql, duelDeltaSql } from "@/lib/bank";
import { STAR_PLAYER_RANK, TEAM_RANK } from "@/lib/players/curation";
import type { CurrentStage } from "@/lib/tournament/current-stage";
import {
  attachNonBettors,
  filterToUser,
  groupPickerRows,
  type TransparencyCategory,
  type TransparencyPicker,
  type TransparencyPickerRow,
  type TransparencyQuestionRow,
} from "@/lib/transparency-group";
import {
  computeDuelRecord,
  computeSharedQuestions,
  summarizeHistory,
  type DuelRecord,
  type SharedQuestion,
  type UserHistoryCategory,
  type UserHistoryRow,
  type UserHistorySummary,
} from "@/lib/transparency-history";
import { findOption, type DuelOption } from "@/lib/duels/options";

export type { CurrentStage };

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

// The per-render settings fields the signed-in dashboard reads. Three
// separate Suspense sections (upcoming-matches scoring, pool-digest
// toggle, community/whatsapp card) each used to issue their own
// `select ... from public.settings` on every render — three pooler
// checkouts where one suffices. React `cache()` memoises this within a
// single request so the three concurrent calls collapse to ONE round
// trip, with no cross-request caching and therefore no staleness (an
// admin edit shows on the very next render). See
// _plans/2026-06-10-db-pool-saturation-fix.md.
export type DashboardSettingsRow = {
  scoringExact: number;
  scoringOutcome: number;
  matchRiskEnabled: boolean;
  matchRiskPenalty: number;
  dashboardDigestEnabled: boolean;
  transparencyHistoryEnabled: boolean;
  whatsappGroupUrl: string | null;
};

export const getSettingsRow = cache(
  async (): Promise<DashboardSettingsRow | null> =>
    execFirstRow<DashboardSettingsRow>(sql`
      select
        scoring_exact                as "scoringExact",
        scoring_outcome              as "scoringOutcome",
        match_risk_enabled           as "matchRiskEnabled",
        match_risk_penalty           as "matchRiskPenalty",
        dashboard_digest_enabled     as "dashboardDigestEnabled",
        transparency_history_enabled as "transparencyHistoryEnabled",
        whatsapp_group_url           as "whatsappGroupUrl"
      from public.settings where id = 1
    `),
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

// Today's (or next match day's) fixtures + bets for a single user. Drives
// the home-page "Your bets today" section — see
// _plans/2026-06-11-home-todays-bets-section.md and `TodayBetsSection.tsx`.
//
// Date selection (Asia/Jerusalem):
//   1. If any fixture kicks off today, pick today.
//   2. Else pick the earliest future date that has a fixture (roll forward).
//   3. If neither exists (tournament over), return null and the section
//      collapses to nothing.
//
// "Bets" mixes three sources, all keyed by the chosen date:
//   - match_bets for fixtures on that date (score predictions)
//   - custom_bets scope='match' whose match.kickoff_at lands on that date
//   - custom_bets scope='day' anchored on matchdays.date = that date
// Tournament/stage/group scopes have no per-day anchor and are excluded.
//
// `totals.totalPoints` sums graded points (match_bets.points_earned + custom
// pick net = points_earned − stake_paid). Open/locked rows don't count
// against the total — those are pending and lighting them up red would be
// misleading.
//
// Read-only. Every join to user-keyed tables is filtered by ${userId}, so
// no other player's picks are exposed.
export type TodayBetsFixture = {
  id: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  kickoffAt: string;
  status: "scheduled" | "live" | "final";
  homeScore: number | null;
  awayScore: number | null;
  myHome: number | null;
  myAway: number | null;
  myPoints: number | null;
  myExact: boolean | null;
};

export type TodayBetsBet = {
  id: string;
  scope: "match" | "day";
  matchId: string | null;
  questionHe: string;
  questionEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown; // AnswerConfig — narrowed by renderPickAnswer
  status: "open" | "locked" | "graded" | "reversed";
  lockAt: string;
  myAnswer: unknown; // PickAnswer | null — narrowed by renderPickAnswer
  myStakePaid: number | null;
  myPointsEarned: number | null;
};

export type TodayBetsSummary = {
  date: string;
  isToday: boolean;
  fixtures: TodayBetsFixture[];
  bets: TodayBetsBet[];
  totals: {
    matchBetCount: number;
    customBetCount: number;
    totalPoints: number;
  };
};

export async function getTodayBetsSummary(
  userId: string,
): Promise<TodayBetsSummary | null> {
  // Pick the active date in one round trip: today first, otherwise the
  // earliest future fixture date. NULL out → no future fixtures at all
  // (tournament finished) → return null and let the section collapse.
  const dateRow = await execFirstRow<{
    date: string | null;
    is_today: boolean | null;
  }>(sql`
    with today as (
      select (now() at time zone 'Asia/Jerusalem')::date as d
    ),
    today_has as (
      select 1
      from public.matches m, today
      where (m.kickoff_at at time zone 'Asia/Jerusalem')::date = today.d
      limit 1
    ),
    next_future as (
      select min((m.kickoff_at at time zone 'Asia/Jerusalem')::date) as d
      from public.matches m, today
      where (m.kickoff_at at time zone 'Asia/Jerusalem')::date > today.d
    )
    select
      to_char(coalesce(
        case when exists (table today_has) then (select d from today) end,
        (select d from next_future)
      ), 'YYYY-MM-DD')                       as "date",
      exists (table today_has)               as "is_today"
  `);
  const date = dateRow?.date ?? null;
  if (!date) return null;
  const isToday = dateRow?.is_today === true;

  const fixtures = await execRows<TodayBetsFixture>(sql`
    select
      m.id::text                       as "id",
      m.home_team                      as "homeCode",
      ht.name_he                       as "homeNameHe",
      ht.name_en                       as "homeNameEn",
      m.away_team                      as "awayCode",
      at.name_he                       as "awayNameHe",
      at.name_en                       as "awayNameEn",
      m.kickoff_at                     as "kickoffAt",
      m.status::text                   as "status",
      m.home_score                     as "homeScore",
      m.away_score                     as "awayScore",
      mb.home_score                    as "myHome",
      mb.away_score                    as "myAway",
      mb.points_earned                 as "myPoints",
      mb.was_exact                     as "myExact"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    left join public.match_bets mb
      on mb.match_id = m.id and mb.user_id = ${userId}
    where (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${date}::date
    order by m.kickoff_at asc
  `);

  // Same anchoring rules as getPlayDayDetail. We INNER JOIN
  // user_custom_bet_picks because this section is the user's *placed* bets;
  // admin-published rows the user skipped don't belong here.
  const bets = await execRows<TodayBetsBet>(sql`
    select
      cb.id::text                                 as "id",
      cb.scope::text                              as "scope",
      cb.match_id::text                           as "matchId",
      cb.question_he                              as "questionHe",
      cb.question_en                              as "questionEn",
      cb.answer_type::text                        as "answerType",
      cb.answer_config                            as "answerConfig",
      cb.status::text                             as "status",
      cb.lock_at                                  as "lockAt",
      pk.answer                                   as "myAnswer",
      pk.stake_paid                               as "myStakePaid",
      pk.points_earned                            as "myPointsEarned"
    from public.custom_bets cb
    left join public.matches    m  on m.id = cb.match_id
    left join public.matchdays  md on md.id = cb.matchday_id
    join public.user_custom_bet_picks pk
      on pk.custom_bet_id = cb.id and pk.user_id = ${userId}
    where cb.status in ('open', 'locked', 'graded', 'reversed')
      and (
        (cb.scope = 'day'   and md.date = ${date}::date) or
        (cb.scope = 'match' and (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${date}::date)
      )
    order by
      cb.scope asc,
      cb.lock_at asc
  `);

  let matchBetCount = 0;
  let matchPoints = 0;
  for (const fx of fixtures) {
    if (fx.myHome !== null && fx.myAway !== null) {
      matchBetCount += 1;
      if (fx.myPoints !== null) matchPoints += fx.myPoints;
    }
  }

  let customPoints = 0;
  for (const b of bets) {
    // Only graded/reversed rows feed the total. Open/locked bets are still
    // in flight; their stake is committed but recoverable on edit.
    if (b.status === "graded" || b.status === "reversed") {
      customPoints += (b.myPointsEarned ?? 0) - (b.myStakePaid ?? 0);
    }
  }

  const digest: TodayBetsSummary = {
    date,
    isToday,
    fixtures,
    bets,
    totals: {
      matchBetCount,
      customBetCount: bets.length,
      totalPoints: matchPoints + customPoints,
    },
  };
  console.info("[dashboard today-bets] loaded", {
    userId,
    date,
    isToday,
    fixtures: fixtures.length,
    bets: bets.length,
    totalPoints: digest.totals.totalPoints,
  });
  return digest;
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
      -- Total bets the user has placed across every surface, not just match
      -- predictions. During the live phase most new activity is custom
      -- (live/tournament) picks and duels, so a match-only count looked
      -- frozen on the leaderboard. Counts are raw placements (a later
      -- cancellation still reflects that a bet was made).
      select p.id as user_id,
        (
          (select count(*)::int from public.match_bets mb where mb.user_id = p.id)
          + (select count(*)::int from public.user_custom_bet_picks pk where pk.user_id = p.id)
          + (select count(*)::int from public.duels d
               where d.opener_id = p.id or d.joiner_id = p.id)
        ) as bet_count
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
      -- The monkey bot is ranked separately as a benchmark, never inline
      -- among humans. See getMonkeyBenchmark().
      where p.is_bot = false
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

// Per-user breakdown of the most recent point-changing events. Powers the
// leaderboard accordion: each row expands to show what someone earned (or
// lost) — today's swing up top, yesterday's behind a collapsed toggle.
//
// We keep two slices per user: every event from the last two Jerusalem
// calendar days (today + yesterday, however many there are — a busy match
// day can blow past a fixed cap and would otherwise truncate yesterday
// entirely), PLUS at least the LIMIT most recent events as a rest-day
// fallback so the "since last activity" anchor still has something to show
// when nothing graded in the last two days.
//
// `events` are returned newest-first. `previousPoints` is the leaderboard
// total minus the sum of these events' deltas — that's the "before the
// last ranking" anchor the row shows. Adjustments are intentionally
// included so a manual debit/credit is visible to everyone (transparency
// matters more than hiding the admin's audit trail here).
export const LEADERBOARD_BREAKDOWN_LIMIT = 8;

export type LeaderboardEventKind =
  | "match"
  | "live"
  | "tournament"
  | "duel"
  | "adjustment";

export type LeaderboardEvent = {
  kind: LeaderboardEventKind;
  eventAt: string;
  delta: number;
  titleHe: string;
  titleEn: string;
  detailHe: string | null;
  detailEn: string | null;
  // The match this event ties to, when it has one. matchLabel is the
  // "HOM AWY" team-code pair (null for day/tournament/duel/adjustment that
  // aren't anchored to a single match); matchAt is that match's kickoff,
  // formatted client-side in Asia/Jerusalem.
  matchLabel: string | null;
  matchAt: string | null;
};

export type LeaderboardBreakdown = {
  userId: string;
  events: LeaderboardEvent[];
};

async function loadLeaderboardBreakdownsFromDb(
  userIds: string[],
): Promise<Map<string, LeaderboardEvent[]>> {
  const out = new Map<string, LeaderboardEvent[]>();
  if (userIds.length === 0) return out;

  // The events CTE unions every surface that changes a user's points,
  // each row stamped with its user_id + a comparable timestamp. We then
  // window-rank per user and keep the top LIMIT slice.
  //
  // Build the id set as an explicit `array[$1::uuid, ...]` constructor via
  // sql.join (the same list idiom auto-fill uses). Interpolating the raw
  // JS array as `${userIds}::uuid[]` does NOT work: drizzle expands an
  // array into a parenthesised parameter LIST, so it renders as
  // `($1, ..., $n)::uuid[]` — a record cast to uuid[], which Postgres
  // rejects. The whole query then throws and the leaderboard accordion
  // silently shows "no graded events" for every row (page.tsx swallows
  // the error). See _qa-reports for the 2026-06-14 regression.
  const idList = sql.join(
    userIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await execRows<{
    userId: string;
    kind: LeaderboardEventKind;
    eventAt: string;
    delta: number;
    titleHe: string;
    titleEn: string;
    detailHe: string | null;
    detailEn: string | null;
    matchLabel: string | null;
    matchAt: string | null;
    answerType: "yes_no" | "number" | "multi_choice" | "free_text" | null;
    answerConfig: unknown;
    pickAnswer: unknown;
  }>(sql`
    with target as (
      select unnest(array[${idList}]) as user_id
    ),
    events as (
      -- match bets: graded once the match is final. Use finalized_at
      -- when available so a future re-grade doesn't reorder history.
      select
        mb.user_id                                  as user_id,
        'match'::text                               as kind,
        coalesce(m.finalized_at, m.kickoff_at)      as event_at,
        coalesce(mb.points_earned, 0)::int          as delta,
        (m.home_team || ' ' || m.away_team)         as title_he,
        (m.home_team || ' ' || m.away_team)         as title_en,
        (
          'תחזית ' || coalesce(mb.home_score::text, '?') || ':' || coalesce(mb.away_score::text, '?')
          || ' · תוצאה ' || coalesce(m.home_score::text, '?') || ':' || coalesce(m.away_score::text, '?')
        )                                           as detail_he,
        (
          'Pick ' || coalesce(mb.home_score::text, '?') || ':' || coalesce(mb.away_score::text, '?')
          || ' · result ' || coalesce(m.home_score::text, '?') || ':' || coalesce(m.away_score::text, '?')
        )                                           as detail_en,
        -- Teams sit in the title for match bets, so only the date is new
        -- here. kickoff_at is the scheduled match time the row anchors to.
        null::text                                  as match_label,
        m.kickoff_at                                as match_at,
        -- Pick-answer carriers: only the custom-bet branch fills these.
        null::text                                  as answer_type,
        null::jsonb                                 as answer_config,
        null::jsonb                                 as pick_answer
      from public.match_bets mb
      join public.matches m on m.id = mb.match_id
      join target t on t.user_id = mb.user_id
      where m.status = 'final' and mb.points_earned is not null

      union all

      -- custom bet picks: live (match/day) and tournament/stage/group.
      -- live nets stake against payout; free-pick scopes have stake=0 so
      -- the same formula collapses to just the payout.
      select
        pk.user_id                                  as user_id,
        case when cb.scope in ('match', 'day') then 'live'::text
             else 'tournament'::text
        end                                         as kind,
        coalesce(cb.graded_at, cb.lock_at)          as event_at,
        (coalesce(pk.points_earned, 0) - pk.stake_paid)::int as delta,
        cb.question_he                              as title_he,
        cb.question_en                              as title_en,
        null::text                                  as detail_he,
        null::text                                  as detail_en,
        -- match-scoped bets carry their match; day/tournament scopes have
        -- no single match (cb.match_id null) so the label/date stay null.
        case when cb.match_id is not null
             then (m2.home_team || ' ' || m2.away_team)
             else null
        end                                         as match_label,
        m2.kickoff_at                               as match_at,
        -- Carry the raw pick so the JS layer can render the chosen answer
        -- ("בחירה: 0-8") via the shared renderPickAnswer formatter. detail_*
        -- stays null above and is filled per-row after the query.
        cb.answer_type::text                        as answer_type,
        cb.answer_config                            as answer_config,
        pk.answer                                   as pick_answer
      from public.user_custom_bet_picks pk
      join public.custom_bets cb on cb.id = pk.custom_bet_id
      left join public.matches m2 on m2.id = cb.match_id
      join target t on t.user_id = pk.user_id
      where cb.status in ('graded', 'reversed') and pk.points_earned is not null

      union all

      -- duels settled. Use the existing duelCaseSql so the netting rules
      -- never drift from the leaderboard total.
      select
        opener.user_id                              as user_id,
        'duel'::text                                as kind,
        coalesce(d.settled_at, d.created_at)        as event_at,
        ${duelCaseSql(sql`opener.user_id`)}::int    as delta,
        coalesce(d.question_he, 'דו-קרב')           as title_he,
        coalesce(d.question_en, 'Duel')             as title_en,
        null::text                                  as detail_he,
        null::text                                  as detail_en,
        null::text                                  as match_label,
        null::timestamptz                           as match_at,
        null::text                                  as answer_type,
        null::jsonb                                 as answer_config,
        null::jsonb                                 as pick_answer
      from public.duels d
      join (
        select t.user_id, d2.id as duel_id
        from target t
        join public.duels d2 on d2.opener_id = t.user_id
        union all
        select t.user_id, d2.id as duel_id
        from target t
        join public.duels d2 on d2.joiner_id = t.user_id
      ) opener on opener.duel_id = d.id
      where d.status = 'settled'

      union all

      -- manual point adjustments. The note is intentionally surfaced so a
      -- debit isn't mistaken for a silent bug.
      select
        pa.user_id                                  as user_id,
        'adjustment'::text                          as kind,
        pa.created_at                               as event_at,
        pa.delta::int                               as delta,
        coalesce(pa.reason, 'התאמה ידנית')           as title_he,
        coalesce(pa.reason, 'Manual adjustment')    as title_en,
        null::text                                  as detail_he,
        null::text                                  as detail_en,
        null::text                                  as match_label,
        null::timestamptz                           as match_at,
        null::text                                  as answer_type,
        null::jsonb                                 as answer_config,
        null::jsonb                                 as pick_answer
      from public.point_adjustments pa
      join target t on t.user_id = pa.user_id
    ),
    ranked as (
      select e.*,
        row_number() over (
          partition by e.user_id
          order by e.event_at desc
        ) as rn
      from events e
    )
    select
      r.user_id::text                               as "userId",
      r.kind                                        as "kind",
      r.event_at                                    as "eventAt",
      r.delta                                       as "delta",
      r.title_he                                    as "titleHe",
      r.title_en                                    as "titleEn",
      r.detail_he                                   as "detailHe",
      r.detail_en                                   as "detailEn",
      r.match_label                                 as "matchLabel",
      r.match_at                                    as "matchAt",
      r.answer_type                                 as "answerType",
      r.answer_config                               as "answerConfig",
      r.pick_answer                                 as "pickAnswer"
    from ranked r
    -- Keep the LIMIT most recent events OR anything from today/yesterday
    -- (Jerusalem). The date floor is yesterday 00:00 Jerusalem, expressed
    -- as a UTC instant so it compares cleanly against the timestamptz
    -- event_at column regardless of the server's timezone.
    where r.rn <= ${LEADERBOARD_BREAKDOWN_LIMIT}
       or r.event_at >= (
            date_trunc('day', (now() at time zone 'Asia/Jerusalem'))
            - interval '1 day'
          ) at time zone 'Asia/Jerusalem'
    order by r.user_id, r.event_at desc
  `);

  // Custom-bet rows (live + tournament) carry the raw pick so we can show
  // the player's chosen answer under the question ("בחירה: 0-8"). The
  // player-roster markets (top scorer / golden ball) store a raw
  // api_football_id with an empty options list, so only pay for the roster
  // query when such a bet is actually present — every other answer type
  // resolves from answer_config alone.
  const needsPlayerNames = rows.some(
    (r) =>
      (r.answerConfig as { dynamicSource?: string } | null)?.dynamicSource ===
      "players",
  );
  const playerNames = needsPlayerNames
    ? await fetchPlayerNamesById()
    : undefined;

  for (const r of rows) {
    // Match bets already ship a "pick · result" detail from SQL; custom-bet
    // picks ship none, so derive "בחירה / Pick: <answer>" here from the raw
    // pick via the shared formatter (single source of truth, no SQL drift).
    let detailHe = r.detailHe;
    let detailEn = r.detailEn;
    if (detailHe === null && detailEn === null && r.answerType) {
      const pickHe = renderPickAnswer(
        r.answerType,
        r.answerConfig,
        r.pickAnswer,
        true,
        playerNames,
      );
      const pickEn = renderPickAnswer(
        r.answerType,
        r.answerConfig,
        r.pickAnswer,
        false,
        playerNames,
      );
      detailHe = `בחירה: ${pickHe}`;
      detailEn = `Pick: ${pickEn}`;
    }

    const arr = out.get(r.userId) ?? [];
    arr.push({
      kind: r.kind,
      eventAt: r.eventAt,
      delta: Number(r.delta ?? 0),
      titleHe: r.titleHe,
      titleEn: r.titleEn,
      detailHe,
      detailEn,
      matchLabel: r.matchLabel,
      matchAt: r.matchAt,
    });
    out.set(r.userId, arr);
  }
  return out;
}

export async function getLeaderboardBreakdowns(
  userIds: string[],
): Promise<Map<string, LeaderboardEvent[]>> {
  // Same cache tag as the leaderboard itself — any grading/adjustment
  // event that buster CACHE_TAG_LEADERBOARD also invalidates these
  // breakdowns. Key includes the sorted id list so the cache survives
  // re-orderings between calls.
  const key = [...userIds].sort().join(",");
  const cached = unstable_cache(
    async () => {
      const map = await loadLeaderboardBreakdownsFromDb(userIds);
      // Maps aren't JSON-serialisable through the cache boundary; flatten
      // to an array on the way in, rebuild on the way out.
      return Array.from(map.entries());
    },
    ["leaderboard-breakdowns", key],
    { tags: [CACHE_TAG_LEADERBOARD], revalidate: 60 },
  );
  const entries = await cached();
  return new Map(entries);
}

// The monkey bot's score for one tab, computed with the SAME math the
// leaderboard uses but for the single bot row. Rendered as a separate
// "beat-the-monkey" benchmark line, so it never gets a rank among humans.
// Returns null when no bot profile exists (bootstrap script not run yet).
export type MonkeyBenchmark = {
  userId: string;
  displayName: string;
  points: number;
  grossPoints: number;
  betCount: number;
};

export async function getMonkeyBenchmark(
  tab: LeaderboardTab = "overall",
): Promise<MonkeyBenchmark | null> {
  const monkey = await execFirstRow<{ id: string; displayName: string }>(sql`
    select id::text as "id", display_name as "displayName"
    from public.profiles
    where is_bot = true
    order by created_at asc
    limit 1
  `);
  if (!monkey) return null;
  const id = monkey.id;

  // Per-tab score, mirroring loadLeaderboardFromDb's `scored` CASE for one id.
  const scoreExpr =
    tab === "matches"
      ? sql`(select coalesce(sum(coalesce(mb.points_earned, 0)), 0)::int
             from public.match_bets mb where mb.user_id = ${id})`
      : tab === "live"
        ? sql`(select coalesce(sum(coalesce(pk.points_earned, 0) - pk.stake_paid), 0)::int
               from public.user_custom_bet_picks pk where pk.user_id = ${id})`
        : tab === "duels"
          ? duelDeltaSql(id)
          : bankBalanceSql(id);

  const row = await execFirstRow<{
    points: number;
    gross: number;
    betCount: number;
  }>(sql`
    select
      (${scoreExpr})::int as "points",
      (
        coalesce((select sum(coalesce(mb.points_earned, 0))::int
          from public.match_bets mb where mb.user_id = ${id}), 0)
        + coalesce((select sum(coalesce(pk.points_earned, 0))::int
          from public.user_custom_bet_picks pk where pk.user_id = ${id}), 0)
      )::int as "gross",
      (select count(*)::int from public.match_bets mb where mb.user_id = ${id}) as "betCount"
  `);

  return {
    userId: id,
    displayName: monkey.displayName,
    points: Number(row?.points ?? 0),
    grossPoints: Number(row?.gross ?? 0),
    betCount: Number(row?.betCount ?? 0),
  };
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
        ${approvedPotIlsSql}   as pot,
        ${paidParticipantsSql} as players
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
      ${approvedPotIlsSql}                                              as "pot",
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
      -- Every Asia/Jerusalem date from today onward that has fixtures.
      -- The final status is included (not just scheduled/live) so TODAY's
      -- card does not vanish the moment its matches end - a player needs
      -- to keep reaching the day to review the live bets they already
      -- placed. The today-onward guard keeps finished past days from
      -- piling up at the top of the list as the tournament runs.
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
      where m.status in ('scheduled', 'live', 'final')
        and (m.kickoff_at at time zone 'Asia/Jerusalem')::date
              >= (now() at time zone 'Asia/Jerusalem')::date
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
  // Bookmaker decimal odds captured at publish (string from numeric col).
  // Used by the variable-stake bet card to mirror the server payout calc
  // exactly; null when not captured (legacy or non-pricedmulti-option bets).
  decimalOdds: string | null;
  lockAt: string;
  // open/locked are the actively-bettable window; graded/reversed are
  // shown read-only so a player can still SEE the live bet they placed
  // after the match started and after it's been graded. cancelled (void)
  // is intentionally excluded.
  status: "open" | "locked" | "graded" | "reversed";
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
// the date is malformed OR has no fixtures AND no bets — the page treats
// "malformed" as notFound and "empty" as a friendly empty-day card.
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
      cb.decimal_odds::text                       as "decimalOdds",
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
    where cb.status in ('open', 'locked', 'graded', 'reversed')
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

// Stage of the tournament right now, surfaced in the landing hero stat
// once the countdown reaches zero. "Current" = the stage of the next
// match that is not yet final; if every match is final the tournament
// is over and we fall back to the last-played stage so the hero card
// reads "Final" rather than going blank. Returns null when no fixtures
// exist, in which case the caller should keep showing the countdown.
//
// Why next-non-final and not "latest stage that has any started match":
// in WC2026 the third-place match plays before the final, so we want
// the label to advance to "Third-place match" once the semis wrap, then
// to "Final" once the third-place match is done.
//
// Cached cross-request and invalidated by the same fixtures tag as
// match-status writes (admin sync, manual edits via the bets-overview
// matrix). A 5-minute revalidate floor keeps the label fresh during
// matchdays without hammering the DB.
export const getCurrentStage = unstable_cache(
  async (): Promise<CurrentStage | null> => {
    const row = await execFirstRow<{ stage: CurrentStage | null }>(sql`
      with next_upcoming as (
        select stage
        from public.matches
        where status in ('scheduled', 'live')
        order by kickoff_at asc
        limit 1
      ),
      last_played as (
        select stage
        from public.matches
        where status = 'final'
        order by kickoff_at desc
        limit 1
      )
      select coalesce(
        (select stage from next_upcoming),
        (select stage from last_played)
      ) as stage
    `);
    return row?.stage ?? null;
  },
  ["getCurrentStage"],
  { tags: [CACHE_TAG_FIXTURES], revalidate: 300 },
);

// Transparency feed surfaces every locked bet across the pool so
// players can audit who picked what once a bet stops being editable.
// Drives /[lang]/transparency.
//
// Visibility rules (mirror §9 of the betting overhaul plan):
//   match bets    → visible once the match status is live or final
//   live bets     → visible once custom_bets.lock_at has passed
//                   (scope in 'match' or 'day')
//   tournament    → same lock rule, scope in 'tournament' or 'stage'
//   group         → same lock rule, scope = 'group'
//   duels         → visible from creation; opener identity is part of
//                   the challenge UX so we never hide it
//
// The four custom_bet surfaces map 1:1 to the /bets tabs so a player
// who navigates the app via /bets, /bets/tournament, /bets/groups,
// /bets/live can use the same mental model when filtering here.

// TransparencyCategory now lives in @/lib/transparency-group (imported
// above) so client components can use it without a server-only guard.
// Re-exported here so existing `@/db/queries` import sites keep working.
export type { TransparencyCategory };

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

// /transparency feed: one row per question per tab, with picks folded
// into a `pickers` array and the rest of the paid pool folded into
// `nonBettors`. Drives the tabbed UI added in
// _plans/2026-06-12-transparency-tabs-redesign.md. Pure grouping +
// filter logic lives in src/lib/transparency-group.ts so it can be
// covered by unit tests; this function owns the SQL only.

// Re-export the shared types so /transparency callers can keep
// importing them from @/db/queries (the public surface).
export type { TransparencyPicker, TransparencyQuestionRow };

export type TransparencyByQuestionFilters = {
  tab: TransparencyCategory;
  userId?: string;
  date?: string;
  locale: "he" | "en";
};

// Paid pool baseline: every user whose CURRENT payment is approved
// (same definition as paidParticipantsSql in pot.ts). This is the
// universe against which "didn't bet" is computed for non-duel tabs.
// Duel rows ignore this — duels are 1v1 by design.
async function loadPaidPool(): Promise<
  Array<{ userId: string; displayName: string }>
> {
  return execRows<{ userId: string; displayName: string }>(sql`
    with latest as (
      select distinct on (user_id) user_id, status
      from public.payments
      order by user_id, submitted_at desc
    )
    select p.id::text as "userId", p.display_name as "displayName"
    from latest
    join public.profiles p on p.id = latest.user_id
    where latest.status = 'approved'
    order by p.display_name asc
  `);
}

export async function getTransparencyByQuestion(
  filters: TransparencyByQuestionFilters,
  limit = 100,
): Promise<TransparencyQuestionRow[]> {
  console.info("[transparency tab] query", {
    tab: filters.tab,
    userId: filters.userId ?? "all",
    date: filters.date ?? "all",
    locale: filters.locale,
    limit,
  });

  const homeNameCol = filters.locale === "he" ? sql`ht.name_he` : sql`ht.name_en`;
  const awayNameCol = filters.locale === "he" ? sql`at.name_he` : sql`at.name_en`;
  const questionCol = filters.locale === "he" ? sql`cb.question_he` : sql`cb.question_en`;
  const duelQuestionCol = filters.locale === "he" ? sql`d.question_he` : sql`d.question_en`;
  const yesLabel = filters.locale === "he" ? sql`'כן'` : sql`'Yes'`;
  const noLabel = filters.locale === "he" ? sql`'לא'` : sql`'No'`;

  // Each branch returns the SAME picker-row shape so the page layer
  // never has to special-case a tab. The `question_id` is whatever
  // groups picks together for that tab: match_id for match, custom_bet
  // id for live/tournament/group, duel id for duels.
  let pickerRows: TransparencyPickerRow[];
  if (filters.tab === "match") {
    pickerRows = await execRows<TransparencyPickerRow>(sql`
      select
        m.id::text                                      as "questionId",
        (${homeNameCol} || ' vs ' || ${awayNameCol})    as "question",
        m.kickoff_at::text                              as "eventTime",
        mb.user_id::text                                as "userId",
        p.display_name                                  as "displayName",
        (mb.home_score || '-' || mb.away_score)         as "pickLabel",
        coalesce(mb.stake_paid_main, 0)::int            as "stake",
        mb.points_earned                                as "pointsEarned",
        m.status::text                                  as "status"
      from public.match_bets mb
      join public.matches m  on m.id  = mb.match_id
      join public.teams ht   on ht.code = m.home_team
      join public.teams at   on at.code = m.away_team
      join public.profiles p on p.id  = mb.user_id
      where m.status in ('live', 'final')
        ${filters.date ? sql`and (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${filters.date}::date` : sql``}
      order by m.kickoff_at desc, p.display_name asc
    `);
  } else if (filters.tab === "duel") {
    pickerRows = await execRows<TransparencyPickerRow>(sql`
      select
        d.id::text                                      as "questionId",
        ${duelQuestionCol}                              as "question",
        d.created_at::text                              as "eventTime",
        d.opener_id::text                               as "userId",
        po.display_name                                 as "displayName",
        case when d.opener_answer then ${yesLabel} else ${noLabel} end as "pickLabel",
        d.stake::int                                    as "stake",
        case when d.status = 'settled'
             then case when d.resolved_value = d.opener_answer then d.stake else -d.stake end
             else null
        end                                             as "pointsEarned",
        d.status::text                                  as "status"
      from public.duels d
      join public.profiles po on po.id = d.opener_id
      ${filters.date ? sql`where (d.created_at at time zone 'Asia/Jerusalem')::date = ${filters.date}::date` : sql``}

      union all

      select
        d.id::text                                      as "questionId",
        ${duelQuestionCol}                              as "question",
        coalesce(d.joined_at, d.created_at)::text      as "eventTime",
        d.joiner_id::text                               as "userId",
        pj.display_name                                 as "displayName",
        case when d.opener_answer then ${noLabel} else ${yesLabel} end as "pickLabel",
        d.stake::int                                    as "stake",
        case when d.status = 'settled'
             then case when d.resolved_value = d.opener_answer then -d.stake else d.stake end
             else null
        end                                             as "pointsEarned",
        d.status::text                                  as "status"
      from public.duels d
      join public.profiles pj on pj.id = d.joiner_id
      where d.joiner_id is not null
        ${filters.date ? sql`and (coalesce(d.joined_at, d.created_at) at time zone 'Asia/Jerusalem')::date = ${filters.date}::date` : sql``}
      order by "eventTime" desc, "displayName" asc
    `);
  } else {
    // live / tournament / group — all backed by custom_bets, scoped by
    // mapped from cb.scope: tournament+stage roll up to "tournament",
    // group is its own bucket, match+day are "live". Mirrors the
    // /bets/* tab layout per [[project_bet_scopes_mapping]].
    const scopeCond =
      filters.tab === "tournament"
        ? sql`cb.scope::text in ('tournament', 'stage')`
        : filters.tab === "group"
          ? sql`cb.scope::text = 'group'`
          : sql`cb.scope::text in ('match', 'day')`; // live

    // We deliberately do NOT format the pick label in SQL here. A custom
    // bet's answer can be a country code (JOR), a number-range key
    // (lt_8, 295_265), a player's api_football_id (184), or a yes/no
    // boolean — and the human-readable text for each lives in
    // cb.answer_config (the option list) or, for the dynamic player
    // roster, in the players table. Emitting the raw answer->>'value'
    // leaked those codes onto the transparency page. Instead we pull the
    // raw answer + config and resolve every row through the same
    // renderPickAnswer used by the admin bet surfaces, so the label can
    // never drift from what bettors saw when they picked.
    type CustomPickRawRow = {
      questionId: string;
      question: string;
      eventTime: string;
      userId: string;
      displayName: string;
      answerType: "yes_no" | "number" | "multi_choice" | "free_text";
      answerConfig: unknown;
      answer: unknown;
      stake: number;
      pointsEarned: number | null;
      status: string;
    };
    const rawRows = await execRows<CustomPickRawRow>(sql`
      select
        cb.id::text                                     as "questionId",
        ${questionCol}                                  as "question",
        cb.lock_at::text                                as "eventTime",
        pk.user_id::text                                as "userId",
        p.display_name                                  as "displayName",
        cb.answer_type::text                            as "answerType",
        cb.answer_config                                as "answerConfig",
        pk.answer                                       as "answer",
        pk.stake_paid::int                              as "stake",
        pk.points_earned                                as "pointsEarned",
        cb.status::text                                 as "status"
      from public.user_custom_bet_picks pk
      join public.custom_bets cb on cb.id = pk.custom_bet_id
      join public.profiles p     on p.id  = pk.user_id
      where cb.lock_at <= now()
        and ${scopeCond}
        ${filters.date ? sql`and (cb.lock_at at time zone 'Asia/Jerusalem')::date = ${filters.date}::date` : sql``}
      order by cb.lock_at desc, p.display_name asc
    `);

    // The player-roster markets (golden ball / top scorer) store a raw
    // api_football_id and keep answer_config.options empty, so their
    // labels need the players table. Only pay for that roster query when
    // such a bet is actually in the result — country/range/yes-no bets
    // resolve entirely from answer_config and skip it.
    const needsPlayerNames = rawRows.some(
      (r) =>
        (r.answerConfig as { dynamicSource?: string } | null)
          ?.dynamicSource === "players",
    );
    const playerNames = needsPlayerNames
      ? await fetchPlayerNamesById()
      : undefined;
    const isHebrew = filters.locale === "he";

    pickerRows = rawRows.map((r) => ({
      questionId: r.questionId,
      question: r.question,
      eventTime: r.eventTime,
      userId: r.userId,
      displayName: r.displayName,
      pickLabel: renderPickAnswer(
        r.answerType,
        r.answerConfig,
        r.answer,
        isHebrew,
        playerNames,
      ),
      stake: r.stake,
      pointsEarned: r.pointsEarned,
      status: r.status,
    }));
  }

  let result = groupPickerRows(pickerRows);
  // Duels are 1v1 by design — skip the paid-pool diff there.
  if (filters.tab !== "duel") {
    attachNonBettors(result, await loadPaidPool());
  }
  if (filters.userId) {
    result = filterToUser(result, filters.userId);
  }
  if (result.length > limit) result = result.slice(0, limit);

  const totalPickers = result.reduce((acc, r) => acc + r.pickers.length, 0);
  const totalNonBettors = result.reduce(
    (acc, r) => acc + r.nonBettors.length,
    0,
  );
  console.info("[transparency tab] result", {
    tab: filters.tab,
    questions: result.length,
    pickers: totalPickers,
    nonBettors: totalNonBettors,
  });
  return result;
}

// Pool digest for the dashboard widget. Returns an aggregated view of
// every bet that became visible to the pool today (Asia/Jerusalem):
// total bettors, total questions, top-3 questions by participation
// with each question's top pick (and alt pick for binary bets).
//
// "Today" = a bet locked or went live today in Asia/Jerusalem. This
// keeps the widget fresh — tournament/stage bets only appear on the
// day they locked, not every day for the rest of the tournament.

export type TransparencyDigestItem = {
  category: TransparencyCategory;
  question: string;
  topPickLabel: string;
  topPickCount: number;
  altPickLabel: string | null;
  altPickCount: number | null;
  totalPickers: number;
};

export type TransparencyDigest = {
  date: string;                       // Asia/Jerusalem yyyy-mm-dd
  totalPickersToday: number;
  totalQuestionsToday: number;
  highlights: TransparencyDigestItem[];
};

export async function getTransparencyDigest(
  locale: "he" | "en",
): Promise<TransparencyDigest> {
  // Cross-request cached: this card aggregates "what the pool picked
  // today" across match_bets + custom picks (two multi-CTE scans) and
  // renders on every signed-in dashboard load. A 60s window keeps it
  // near-live (a fresh pick shows within a minute) while collapsing the
  // per-render DB cost to ~one scan per minute per locale. See
  // _plans/2026-06-10-db-pool-saturation-fix.md.
  const cached = unstable_cache(
    () => loadTransparencyDigestFromDb(locale),
    ["transparency-digest", locale],
    { revalidate: 60 },
  );
  return cached();
}

async function loadTransparencyDigestFromDb(
  locale: "he" | "en",
): Promise<TransparencyDigest> {
  const homeNameCol = locale === "he" ? sql`ht.name_he` : sql`ht.name_en`;
  const awayNameCol = locale === "he" ? sql`at.name_he` : sql`at.name_en`;
  const questionCol = locale === "he" ? sql`cb.question_he` : sql`cb.question_en`;
  const yesLabel = locale === "he" ? sql`'כן'` : sql`'Yes'`;
  const noLabel = locale === "he" ? sql`'לא'` : sql`'No'`;

  const dateRow = await execFirstRow<{ today: string }>(sql`
    select to_char((now() at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD') as today
  `);
  const today = dateRow?.today ?? new Date().toISOString().slice(0, 10);

  // picks_per_question: one row per (category, bet_id, pick_value)
  // counting how many pool members chose that exact value. Both
  // sources (match_bets, custom_bets) project into the same shape so
  // they can share the ranking window further down.
  const rows = await execRows<{
    category: TransparencyCategory;
    question: string;
    top_pick_label: string;
    top_pick_count: number;
    alt_pick_label: string | null;
    alt_pick_count: number | null;
    total_pickers: number;
  }>(sql`
    with picks_per_question as (
      select
        'match'::text                                              as category,
        mb.match_id::text                                          as bet_id,
        (${homeNameCol} || ' vs ' || ${awayNameCol})               as question,
        (mb.home_score || '-' || mb.away_score)                    as pick_value,
        count(*)::int                                              as picks
      from public.match_bets mb
      join public.matches m on m.id = mb.match_id
      join public.teams ht  on ht.code = m.home_team
      join public.teams at  on at.code = m.away_team
      where m.status in ('live', 'final')
        and (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${today}::date
      group by mb.match_id, ${homeNameCol}, ${awayNameCol}, mb.home_score, mb.away_score

      union all

      select
        case cb.scope::text
          when 'tournament' then 'tournament'
          when 'stage'      then 'tournament'
          when 'group'      then 'group'
          else 'live'
        end::text                                                  as category,
        cb.id::text                                                as bet_id,
        ${questionCol}                                             as question,
        case pk.answer->>'value'
          when 'true'  then ${yesLabel}
          when 'false' then ${noLabel}
          else coalesce(pk.answer->>'value', '?')
        end                                                        as pick_value,
        count(*)::int                                              as picks
      from public.user_custom_bet_picks pk
      join public.custom_bets cb on cb.id = pk.custom_bet_id
      where cb.lock_at <= now()
        and (cb.lock_at at time zone 'Asia/Jerusalem')::date = ${today}::date
      group by cb.id, cb.scope, ${questionCol}, pick_value
    ),
    ranked as (
      select
        category, bet_id, question, pick_value, picks,
        row_number() over (
          partition by category, bet_id
          order by picks desc, pick_value asc
        ) as rn,
        sum(picks) over (partition by category, bet_id) as total_pickers
      from picks_per_question
    ),
    per_question as (
      select
        category, bet_id, question, total_pickers,
        max(case when rn = 1 then pick_value end)        as top_pick_label,
        max(case when rn = 1 then picks end)::int        as top_pick_count,
        max(case when rn = 2 then pick_value end)        as alt_pick_label,
        max(case when rn = 2 then picks end)::int        as alt_pick_count
      from ranked
      group by category, bet_id, question, total_pickers
    )
    select
      category,
      question,
      top_pick_label,
      top_pick_count,
      alt_pick_label,
      alt_pick_count,
      total_pickers::int as total_pickers
    from per_question
    order by total_pickers desc, question asc
    limit 3
  `);

  const totals = await execFirstRow<{
    total_pickers: number;
    total_questions: number;
  }>(sql`
    with locked_today as (
      select mb.user_id, ('match:' || mb.match_id::text) as question_key
      from public.match_bets mb
      join public.matches m on m.id = mb.match_id
      where m.status in ('live', 'final')
        and (m.kickoff_at at time zone 'Asia/Jerusalem')::date = ${today}::date

      union all

      select pk.user_id, ('custom:' || cb.id::text) as question_key
      from public.user_custom_bet_picks pk
      join public.custom_bets cb on cb.id = pk.custom_bet_id
      where cb.lock_at <= now()
        and (cb.lock_at at time zone 'Asia/Jerusalem')::date = ${today}::date
    )
    select
      count(distinct user_id)::int     as total_pickers,
      count(distinct question_key)::int as total_questions
    from locked_today
  `);

  const digest: TransparencyDigest = {
    date: today,
    totalPickersToday: totals?.total_pickers ?? 0,
    totalQuestionsToday: totals?.total_questions ?? 0,
    highlights: rows.map((r) => ({
      category: r.category,
      question: r.question,
      topPickLabel: r.top_pick_label,
      topPickCount: r.top_pick_count,
      altPickLabel: r.alt_pick_label,
      altPickCount: r.alt_pick_count,
      totalPickers: r.total_pickers,
    })),
  };
  console.info("[dashboard digest] result", {
    date: digest.date,
    totalPickersToday: digest.totalPickersToday,
    totalQuestionsToday: digest.totalQuestionsToday,
    highlights: digest.highlights.length,
  });
  return digest;
}

// ---------- Per-user bet history (/transparency "Player history") ----------
//
// The complete, all-surfaces betting history for ONE player, built from
// the SAME lock-safe visibility rules the transparency feed uses
// (match status in live/final; custom_bets lock_at <= now(); duels public
// from creation). It NEVER reads the bank-history query, which records a
// stake event at pick time and would leak un-locked picks. See
// _plans/2026-06-15-per-user-bet-history.md.
//
// Net is normalised so the page never special-cases a surface:
//   match  → points_earned (already the net 1/X/2 score; null = pending)
//   custom → points_earned - stake_paid (null points = pending)
//   duel   → duelCaseSql (settled only; open/matched = pending)
// cancelled/void custom bets and duels are dropped (refunded → not history).

export type { UserHistoryCategory, UserHistoryRow, UserHistorySummary };

export type UserBetHistory = {
  rows: UserHistoryRow[];
  summary: UserHistorySummary;
};

// Raw shapes from the three branch queries, before JS resolves the
// human-readable pick/result labels.
type MatchHistRow = {
  refId: string;
  question: string;
  sortTs: string;
  pickLabel: string;
  resultLabel: string | null;
  stake: number;
  net: number | null;
  isPending: boolean;
};

type CustomHistRaw = {
  refId: string;
  category: UserHistoryCategory;
  question: string;
  contextLabel: string | null;
  sortTs: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  answer: unknown;
  resolvedValue: unknown;
  stake: number;
  pointsEarned: number | null;
  status: string;
};

type DuelHistRaw = {
  refId: string;
  question: string;
  sortTs: string;
  status: string;
  stake: number;
  net: number | null;
  options: DuelOption[] | null;
  openerId: string;
  joinerId: string | null;
  openerAnswer: boolean | null;
  openerOption: string | null;
  joinerOption: string | null;
  resolvedValue: boolean | null;
  resolvedOption: string | null;
  openerName: string;
  joinerName: string | null;
};

export async function getUserBetHistory(
  userId: string,
  locale: "he" | "en",
): Promise<UserBetHistory> {
  const isHebrew = locale === "he";
  const homeNameCol = isHebrew ? sql`ht.name_he` : sql`ht.name_en`;
  const awayNameCol = isHebrew ? sql`at.name_he` : sql`at.name_en`;
  const cHomeNameCol = isHebrew ? sql`cht.name_he` : sql`cht.name_en`;
  const cAwayNameCol = isHebrew ? sql`cat.name_he` : sql`cat.name_en`;
  const questionCol = isHebrew ? sql`cb.question_he` : sql`cb.question_en`;
  const duelQuestionCol = isHebrew ? sql`d.question_he` : sql`d.question_en`;
  const yesLabel = isHebrew ? "כן" : "Yes";
  const noLabel = isHebrew ? "לא" : "No";

  console.info("[user history] query", { userId, locale });

  // 1/X/2 match picks. points_earned is the net already; null = the
  // match has kicked off but isn't graded yet (pending).
  const matchRowsRaw = await execRows<MatchHistRow>(sql`
    select
      m.id::text                                       as "refId",
      (${homeNameCol} || ' vs ' || ${awayNameCol})      as "question",
      m.kickoff_at::text                               as "sortTs",
      (mb.home_score || '-' || mb.away_score)          as "pickLabel",
      case when m.status = 'final'
                and m.home_score is not null
                and m.away_score is not null
           then (m.home_score || '-' || m.away_score)
           else null end                               as "resultLabel",
      coalesce(mb.stake_paid_main, 0)::int             as "stake",
      mb.points_earned                                 as "net",
      (mb.points_earned is null)                       as "isPending"
    from public.match_bets mb
    join public.matches m on m.id = mb.match_id
    join public.teams ht  on ht.code = m.home_team
    join public.teams at  on at.code = m.away_team
    where mb.user_id = ${userId}
      and m.status in ('live', 'final')
  `);

  // Custom bets (live / tournament / group), cancelled excluded. Pick
  // and result labels are resolved in JS via renderPickAnswer so country
  // codes / number ranges / player ids never leak as raw values.
  const customRaw = await execRows<CustomHistRaw>(sql`
    select
      cb.id::text                                      as "refId",
      case cb.scope::text
        when 'tournament' then 'tournament'
        when 'stage'      then 'tournament'
        when 'group'      then 'group'
        else 'live'
      end                                              as "category",
      ${questionCol}                                   as "question",
      case when cb.match_id is not null
           then (${cHomeNameCol} || ' vs ' || ${cAwayNameCol})
           else null end                               as "contextLabel",
      cb.lock_at::text                                 as "sortTs",
      cb.answer_type::text                             as "answerType",
      cb.answer_config                                 as "answerConfig",
      pk.answer                                        as "answer",
      cb.resolved_value                                as "resolvedValue",
      pk.stake_paid::int                               as "stake",
      pk.points_earned                                 as "pointsEarned",
      cb.status::text                                  as "status"
    from public.user_custom_bet_picks pk
    join public.custom_bets cb on cb.id = pk.custom_bet_id
    left join public.matches mt on mt.id = cb.match_id
    left join public.teams cht  on cht.code = mt.home_team
    left join public.teams cat  on cat.code = mt.away_team
    where pk.user_id = ${userId}
      and cb.lock_at <= now()
      and cb.status <> 'cancelled'
  `);

  // Duels on either side, cancelled excluded. Net is computed by the
  // shared duelCaseSql so the netting rules can never drift from the bank.
  const duelRaw = await execRows<DuelHistRaw>(sql`
    select
      d.id::text                                       as "refId",
      ${duelQuestionCol}                               as "question",
      coalesce(d.joined_at, d.created_at)::text         as "sortTs",
      d.status::text                                   as "status",
      d.stake::int                                     as "stake",
      case when d.status = 'settled'
           then ${duelCaseSql(userId)}
           else null end                               as "net",
      d.options                                        as "options",
      d.opener_id::text                                as "openerId",
      d.joiner_id::text                                as "joinerId",
      d.opener_answer                                  as "openerAnswer",
      d.opener_option                                  as "openerOption",
      d.joiner_option                                  as "joinerOption",
      d.resolved_value                                 as "resolvedValue",
      d.resolved_option                                as "resolvedOption",
      po.display_name                                  as "openerName",
      pj.display_name                                  as "joinerName"
    from public.duels d
    join public.profiles po on po.id = d.opener_id
    left join public.profiles pj on pj.id = d.joiner_id
    where (d.opener_id = ${userId} or d.joiner_id = ${userId})
      and d.status <> 'cancelled'
  `);

  // Player-roster custom markets (golden ball / top scorer) keep their
  // label in the players table; only pay for that lookup when one is here.
  const needsPlayerNames = customRaw.some(
    (r) =>
      (r.answerConfig as { dynamicSource?: string } | null)?.dynamicSource ===
      "players",
  );
  const playerNames = needsPlayerNames
    ? await fetchPlayerNamesById()
    : undefined;

  const matchRows: UserHistoryRow[] = matchRowsRaw.map((r) => ({
    category: "match",
    refId: r.refId,
    question: r.question,
    contextLabel: null,
    sortTs: r.sortTs,
    pickLabel: r.pickLabel,
    resultLabel: r.resultLabel,
    stake: r.stake,
    net: r.isPending ? null : r.net,
    isPending: r.isPending,
    opponentId: null,
    opponentName: null,
  }));

  const customRows: UserHistoryRow[] = customRaw.map((r) => {
    const isPending = r.pointsEarned === null;
    return {
      category: r.category,
      refId: r.refId,
      question: r.question,
      contextLabel: r.contextLabel,
      sortTs: r.sortTs,
      pickLabel: renderPickAnswer(
        r.answerType,
        r.answerConfig,
        r.answer,
        isHebrew,
        playerNames,
      ),
      resultLabel:
        r.resolvedValue == null
          ? null
          : renderPickAnswer(
              r.answerType,
              r.answerConfig,
              r.resolvedValue,
              isHebrew,
              playerNames,
            ),
      stake: r.stake,
      net: isPending ? null : (r.pointsEarned ?? 0) - r.stake,
      isPending,
      opponentId: null,
      opponentName: null,
    };
  });

  const duelRows: UserHistoryRow[] = duelRaw.map((r) => {
    const iAmOpener = r.openerId === userId;
    const opponentId = iAmOpener ? r.joinerId : r.openerId;
    const opponentName = iAmOpener ? r.joinerName : r.openerName;
    const isPending = r.status !== "settled";

    // My pick: legacy yes/no duels carry a boolean, custom-option duels
    // carry an option key resolved against the options array.
    let pickLabel: string;
    if (r.options) {
      const myKey = iAmOpener ? r.openerOption : r.joinerOption;
      const opt = findOption(r.options, myKey);
      pickLabel = opt ? (isHebrew ? opt.labelHe : opt.labelEn) : "—";
    } else {
      const myAnswer = iAmOpener ? r.openerAnswer : !r.openerAnswer;
      pickLabel = myAnswer ? yesLabel : noLabel;
    }

    let resultLabel: string | null = null;
    if (r.status === "settled") {
      if (r.options) {
        const opt = findOption(r.options, r.resolvedOption);
        resultLabel = opt ? (isHebrew ? opt.labelHe : opt.labelEn) : null;
      } else if (r.resolvedValue != null) {
        resultLabel = r.resolvedValue ? yesLabel : noLabel;
      }
    }

    return {
      category: "duel",
      refId: r.refId,
      question: r.question,
      contextLabel: opponentName,
      sortTs: r.sortTs,
      pickLabel,
      resultLabel,
      stake: r.stake,
      net: r.net,
      isPending,
      opponentId,
      opponentName,
    };
  });

  const rows = [...matchRows, ...customRows, ...duelRows].sort((a, b) =>
    a.sortTs < b.sortTs ? 1 : a.sortTs > b.sortTs ? -1 : 0,
  );
  const summary = summarizeHistory(rows);
  console.info("[user history] result", {
    userId,
    rows: rows.length,
    pending: summary.pendingCount,
    net: summary.net,
  });
  return { rows, summary };
}

// ---------- Head-to-head ("me vs. them") ----------

export type HeadToHeadUser = {
  id: string;
  name: string;
  summary: UserHistorySummary;
};

export type HeadToHead = {
  a: HeadToHeadUser;
  b: HeadToHeadUser;
  shared: SharedQuestion[];
  duelRecord: DuelRecord;
};

export async function getUserHeadToHead(
  aId: string,
  bId: string,
  locale: "he" | "en",
): Promise<HeadToHead> {
  const [aHistory, bHistory, names] = await Promise.all([
    getUserBetHistory(aId, locale),
    getUserBetHistory(bId, locale),
    execRows<{ id: string; displayName: string }>(sql`
      select id::text as "id", display_name as "displayName"
      from public.profiles
      where id in (${aId}, ${bId})
    `),
  ]);

  const nameOf = (id: string) =>
    names.find((n) => n.id === id)?.displayName ?? id;

  return {
    a: { id: aId, name: nameOf(aId), summary: aHistory.summary },
    b: { id: bId, name: nameOf(bId), summary: bHistory.summary },
    shared: computeSharedQuestions(aHistory.rows, bHistory.rows),
    duelRecord: computeDuelRecord(aHistory.rows, bId),
  };
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

// Live matches feed for /[lang]/live. Returns:
//   - every fixture currently in 'live' status
//   - matches finalised within the last 90 minutes (so the page still has
//     something to show during half-time / right after the whistle)
//   - every 'scheduled' fixture on the active matchday — defined as today
//     (Asia/Jerusalem) if any non-final match falls there, otherwise the
//     earliest future date that has a scheduled match. Gives the page a
//     "what's coming up" feed alongside the live scoreboard, with the
//     client-side <KickoffCountdown> ticking on each scheduled row.
// Plus the signed-in viewer's pick if any.

export type LiveMatchRow = {
  id: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  kickoffAt: string;
  status: "scheduled" | "live" | "final";
  homeScore: number | null;
  awayScore: number | null;
  myHomeScore: number | null;
  myAwayScore: number | null;
  myPointsEarned: number | null;
};

export async function getLiveMatches(
  userId: string,
  options: { includeUpcoming: boolean } = { includeUpcoming: true },
): Promise<LiveMatchRow[]> {
  const includeUpcoming = options.includeUpcoming;
  return execRows<LiveMatchRow>(sql`
    with target as (
      select case when ${includeUpcoming} then coalesce(
        case when exists (
          select 1 from public.matches m
          where (m.kickoff_at at time zone 'Asia/Jerusalem')::date
                  = (now() at time zone 'Asia/Jerusalem')::date
            and m.status <> 'final'
        ) then (now() at time zone 'Asia/Jerusalem')::date end,
        (select min((m.kickoff_at at time zone 'Asia/Jerusalem')::date)
         from public.matches m
         where m.status <> 'final'
           and (m.kickoff_at at time zone 'Asia/Jerusalem')::date
                 > (now() at time zone 'Asia/Jerusalem')::date)
      ) end as d
    )
    select
      m.id::text                                          as "id",
      m.home_team                                         as "homeCode",
      ht.name_he                                          as "homeNameHe",
      ht.name_en                                          as "homeNameEn",
      m.away_team                                         as "awayCode",
      at.name_he                                          as "awayNameHe",
      at.name_en                                          as "awayNameEn",
      to_char(m.kickoff_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS"Z"')               as "kickoffAt",
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
    cross join target t
    where m.status = 'live'
       or (m.status = 'final'
           and coalesce(m.finalized_at, m.kickoff_at) > now() - interval '90 minutes')
       or (m.status = 'scheduled'
           and t.d is not null
           and (m.kickoff_at at time zone 'Asia/Jerusalem')::date = t.d)
    order by
      case m.status
        when 'live'      then 0
        when 'scheduled' then 1
        else                  2
      end,
      m.kickoff_at asc
    limit 50
  `);
}

// ---------- Past / history queries (newest first) ----------
//
// Used by the "Past" sub-toggle on the bet surfaces. Read-only by
// construction: every function below is a SELECT, no UPDATE/INSERT
// path. See _plans/2026-06-12-bet-history-per-surface.md.

export type PastMatchPickRow = {
  id: string;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  kickoffAt: string;
  // Asia/Jerusalem calendar date (YYYY-MM-DD) the page groups by. Never
  // slice kickoffAt (that's UTC) — a late-night kickoff would land on the
  // wrong day. See memory: Jerusalem timezone is mandatory.
  matchDate: string;
  stage: string;
  // 'live' = match in play, no final score yet; 'final' = whistle blown.
  // 'scheduled' rows that slipped under the 5-minute lock window are
  // bucketed as 'live' from the player's POV — the match is effectively
  // locked even if API-Football hasn't promoted the status yet.
  status: "scheduled" | "live" | "final";
  homeScore: number | null;
  awayScore: number | null;
  myHomeScore: number | null;
  myAwayScore: number | null;
  // Net points written by scoreFinalMatches() on grading. Null when the
  // match hasn't been graded yet (still live, or just finished and the
  // grader hasn't run).
  myPointsEarned: number | null;
  myWasExact: boolean | null;
  myWasCorrectOutcome: boolean | null;
};

// Every match that has kicked off or finished, regardless of whether
// the caller picked it. Newest first by kickoff_at. The user asked for
// "everything" so we include rows with no pick — those render with "—"
// in the my-pick column.
export async function getPastMatchPicks(
  userId: string,
): Promise<PastMatchPickRow[]> {
  return execRows<PastMatchPickRow>(sql`
    select
      m.id::text                                          as "id",
      m.home_team                                         as "homeCode",
      ht.name_he                                          as "homeNameHe",
      ht.name_en                                          as "homeNameEn",
      m.away_team                                         as "awayCode",
      at.name_he                                          as "awayNameHe",
      at.name_en                                          as "awayNameEn",
      m.kickoff_at::text                                  as "kickoffAt",
      to_char((m.kickoff_at at time zone 'Asia/Jerusalem')::date,
              'YYYY-MM-DD')                               as "matchDate",
      m.stage::text                                       as "stage",
      m.status::text                                      as "status",
      m.home_score                                        as "homeScore",
      m.away_score                                        as "awayScore",
      mb.home_score                                       as "myHomeScore",
      mb.away_score                                       as "myAwayScore",
      mb.points_earned                                    as "myPointsEarned",
      mb.was_exact                                        as "myWasExact",
      mb.was_correct_outcome                              as "myWasCorrectOutcome"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    left join public.match_bets mb on mb.match_id = m.id and mb.user_id = ${userId}
    where m.status in ('live', 'final')
       or (m.status = 'scheduled' and m.kickoff_at <= now() + interval '5 minutes')
    order by m.kickoff_at desc
    limit 500
  `);
}

// Past matchdays for the live-bets index. Every Asia/Jerusalem date
// strictly before today that has at least one match. Returned newest
// first. We also pre-count how many of the day's custom bets the
// caller actually picked so the card can show "{n} picks of yours".
export type PastPlayDayRow = {
  date: string;
  matchCount: number;
  firstKickoffAt: string;
  flagsPreview: string;
  myPickCount: number;
};

export async function listPastPlayDays(userId: string): Promise<PastPlayDayRow[]> {
  return execRows<PastPlayDayRow>(sql`
    with days as (
      select to_char((m.kickoff_at at time zone 'Asia/Jerusalem')::date,
                     'YYYY-MM-DD')                          as date,
             min(m.kickoff_at)                              as first_kickoff,
             count(*)::int                                  as match_count,
             string_agg(distinct ht.flag, ' ' order by ht.flag) ||
               ' ' ||
               string_agg(distinct at.flag, ' ' order by at.flag) as flags
      from public.matches m
      join public.teams ht on ht.code = m.home_team
      join public.teams at on at.code = m.away_team
      where (m.kickoff_at at time zone 'Asia/Jerusalem')::date
              < (now() at time zone 'Asia/Jerusalem')::date
      group by (m.kickoff_at at time zone 'Asia/Jerusalem')::date
    ),
    picks as (
      -- Count of custom-bet picks the caller made for each day, across
      -- both day-scope (anchored to matchday) and match-scope (anchored
      -- to a match on that day). Match-pick count is intentionally
      -- excluded — those are summarised by the match-picks past view.
      select day, sum(c)::int as pick_count
      from (
        select to_char(md.date, 'YYYY-MM-DD') as day,
               count(*)::int as c
        from public.user_custom_bet_picks pk
        join public.custom_bets cb on cb.id = pk.custom_bet_id
        join public.matchdays md on md.id = cb.matchday_id
        where pk.user_id = ${userId}
          and cb.scope = 'day'
        group by md.date
        union all
        select to_char((m.kickoff_at at time zone 'Asia/Jerusalem')::date,
                       'YYYY-MM-DD') as day,
               count(*)::int
        from public.user_custom_bet_picks pk
        join public.custom_bets cb on cb.id = pk.custom_bet_id
        join public.matches m on m.id = cb.match_id
        where pk.user_id = ${userId}
          and cb.scope = 'match'
        group by (m.kickoff_at at time zone 'Asia/Jerusalem')::date
      ) per_scope
      group by day
    )
    select
      d.date                                  as "date",
      d.match_count                           as "matchCount",
      d.first_kickoff::text                   as "firstKickoffAt",
      d.flags                                 as "flagsPreview",
      coalesce(p.pick_count, 0)::int          as "myPickCount"
    from days d
    left join picks p on p.day = d.date
    order by d.date desc
    limit 200
  `);
}

// Past tournament/stage custom bets. Includes graded, reversed and
// cancelled - the user wants to see everything that has closed. Rows
// where the caller didn't pick are kept so the past view stays
// symmetric with the upcoming view.
export type PastTournamentBetRow = {
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
  gradedAt: string | null;
  status: "graded" | "reversed" | "cancelled";
  resolvedValue: unknown | null;
  myAnswer: unknown | null;
  myStakePaid: number | null;
  myPointsEarned: number | null;
  myWasCorrect: boolean | null;
};

export async function getPastTournamentBets(
  userId: string,
): Promise<PastTournamentBetRow[]> {
  return execRows<PastTournamentBetRow>(sql`
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
      cb.lock_at::text                            as "lockAt",
      cb.graded_at::text                          as "gradedAt",
      cb.status::text                             as "status",
      cb.resolved_value                           as "resolvedValue",
      pk.answer                                   as "myAnswer",
      pk.stake_paid                               as "myStakePaid",
      pk.points_earned                            as "myPointsEarned",
      pk.was_correct                              as "myWasCorrect"
    from public.custom_bets cb
    left join public.user_custom_bet_picks pk
      on pk.custom_bet_id = cb.id and pk.user_id = ${userId}
    where cb.status in ('graded', 'reversed', 'cancelled')
      and cb.scope in ('tournament', 'stage')
    order by
      coalesce(cb.graded_at, cb.lock_at) desc
    limit 200
  `);
}

// Past group-scope custom bets. Same shape as past tournament bets,
// scoped to cb.scope='group', with the group id surfaced so the page
// can bucket by group like the upcoming view does.
export type PastGroupBetRow = Omit<PastTournamentBetRow, "scope" | "stage"> & {
  groupId: string;
  groupDisplayOrder: number;
};

export async function getPastGroupBets(
  userId: string,
): Promise<PastGroupBetRow[]> {
  return execRows<PastGroupBetRow>(sql`
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
      cb.lock_at::text                            as "lockAt",
      cb.graded_at::text                          as "gradedAt",
      cb.status::text                             as "status",
      cb.resolved_value                           as "resolvedValue",
      pk.answer                                   as "myAnswer",
      pk.stake_paid                               as "myStakePaid",
      pk.points_earned                            as "myPointsEarned",
      pk.was_correct                              as "myWasCorrect"
    from public.custom_bets cb
    join public.groups g on g.id = cb.group_id
    left join public.user_custom_bet_picks pk
      on pk.custom_bet_id = cb.id and pk.user_id = ${userId}
    where cb.status in ('graded', 'reversed', 'cancelled')
      and cb.scope = 'group'
    order by
      coalesce(cb.graded_at, cb.lock_at) desc,
      g.display_order asc
    limit 200
  `);
}

