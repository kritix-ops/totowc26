import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./index";

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
  const rows = await db.execute<FixtureWithMyBet>(sql`
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
  return rows as unknown as FixtureWithMyBet[];
}

// Latest final match for which the user has a bet (i.e. their most recent
// finished match). Used by dashboard's "Last bet" card.
export async function getLatestFinalForUser(
  userId: string,
): Promise<FixtureWithMyBet | null> {
  const rows = await db.execute<FixtureWithMyBet>(sql`
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
  const list = rows as unknown as FixtureWithMyBet[];
  return list[0] ?? null;
}

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  displayName: string;
  points: number;
  betCount: number;
  isYou: boolean;
};

export async function getLeaderboard(
  currentUserId: string,
): Promise<LeaderboardEntry[]> {
  const rows = await db.execute<LeaderboardEntry>(sql`
    with totals as (
      select
        p.id::text as user_id,
        p.display_name,
        coalesce(sum(
          coalesce(mb.points_earned, 0) +
          coalesce(mb.points_btts, 0) +
          coalesce(mb.points_over_25, 0) +
          coalesce(mb.points_ht, 0)
        ), 0)::int as match_points,
        coalesce((
          select sum(coalesce(sb.points_earned, 0))
          from public.special_bets sb where sb.user_id = p.id
        ), 0)::int as special_points,
        count(mb.id)::int as bet_count
      from public.profiles p
      left join public.match_bets mb on mb.user_id = p.id
      group by p.id, p.display_name
    ),
    final_totals as (
      select user_id, display_name, bet_count,
             (match_points + special_points) as points
      from totals
    )
    select
      rank() over (order by points desc, display_name asc)::int as "rank",
      user_id::text                                              as "userId",
      display_name                                               as "displayName",
      points                                                     as "points",
      bet_count                                                  as "betCount",
      (user_id::text = ${currentUserId})                         as "isYou"
    from final_totals
    order by rank, display_name asc
  `);
  return rows as unknown as LeaderboardEntry[];
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
  const rows = await db.execute<{ points: number }>(sql`
    select coalesce(sum(
      coalesce(mb.points_earned, 0) +
      coalesce(mb.points_btts, 0) +
      coalesce(mb.points_over_25, 0) +
      coalesce(mb.points_ht, 0)
    ), 0)::int as "points"
    from public.matches m
    join public.match_bets mb
      on mb.match_id = m.id and mb.user_id = ${userId}
    where m.status = 'final'
    group by date_trunc('day', m.kickoff_at)
    order by date_trunc('day', m.kickoff_at) asc
  `);
  const trend = (rows as unknown as Array<{ points: number }>).map((r) =>
    Number(r.points),
  );
  return trend;
}

export async function getFixtureWithBets(
  matchId: string,
): Promise<FixtureRow | null> {
  const rows = await db.execute<FixtureRow>(sql`
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
  const list = rows as unknown as FixtureRow[];
  return list[0] ?? null;
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
  const rows = await db.execute<FriendBet>(sql`
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
  return rows as unknown as FriendBet[];
}

export type MyBet = {
  homeScore: number;
  awayScore: number;
  pointsEarned: number | null;
  wasExact: boolean | null;
  locked: boolean;
  betBtts: boolean | null;
  betOver25: boolean | null;
  betHtHome: number | null;
  betHtAway: number | null;
  pointsBtts: number | null;
  pointsOver25: number | null;
  pointsHt: number | null;
};

export async function getMyBet(
  matchId: string,
  userId: string,
): Promise<MyBet | null> {
  const rows = await db.execute<MyBet>(sql`
    select
      home_score      as "homeScore",
      away_score      as "awayScore",
      points_earned   as "pointsEarned",
      was_exact       as "wasExact",
      locked          as "locked",
      bet_btts        as "betBtts",
      bet_over_25     as "betOver25",
      bet_ht_home     as "betHtHome",
      bet_ht_away     as "betHtAway",
      points_btts     as "pointsBtts",
      points_over_25  as "pointsOver25",
      points_ht       as "pointsHt"
    from public.match_bets
    where match_id = ${matchId}::uuid and user_id = ${userId}
    limit 1
  `);
  const list = rows as unknown as MyBet[];
  return list[0] ?? null;
}

// Profile screen: aggregate stats for one user.
export type ProfileStats = {
  totalPoints: number;
  betsPlaced: number;
  betsFinal: number;
  exactCount: number;
  outcomeCount: number;
  exactAccuracy: number; // percent 0..100
  outcomeAccuracy: number;
  streak: number;
  memberSince: string | null;
};

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const rows = await db.execute<{
    total_points: number;
    bets_placed: number;
    bets_final: number;
    exact_count: number;
    outcome_count: number;
    member_since: string | null;
  }>(sql`
    select
      coalesce(sum(
        coalesce(mb.points_earned, 0) +
        coalesce(mb.points_btts, 0) +
        coalesce(mb.points_over_25, 0) +
        coalesce(mb.points_ht, 0)
      ), 0)::int                                        as total_points,
      count(mb.id)::int                                 as bets_placed,
      count(case when mb.points_earned is not null then 1 end)::int as bets_final,
      count(case when mb.was_exact then 1 end)::int     as exact_count,
      count(case when mb.was_correct_outcome then 1 end)::int as outcome_count,
      (select created_at from public.profiles where id = ${userId})::text as member_since
    from public.match_bets mb
    where mb.user_id = ${userId}
  `);
  const r = (rows as unknown as Array<{
    total_points: number;
    bets_placed: number;
    bets_final: number;
    exact_count: number;
    outcome_count: number;
    member_since: string | null;
  }>)[0];

  const exactAcc = r.bets_final > 0 ? Math.round((r.exact_count / r.bets_final) * 100) : 0;
  const outcomeAcc = r.bets_final > 0 ? Math.round((r.outcome_count / r.bets_final) * 100) : 0;

  // Streak: count trailing correct-outcome bets among the most recent finals.
  const streakRows = await db.execute<{ was_correct_outcome: boolean | null }>(sql`
    select mb.was_correct_outcome
    from public.match_bets mb
    join public.matches m on m.id = mb.match_id
    where mb.user_id = ${userId} and m.status = 'final'
    order by coalesce(m.finalized_at, m.kickoff_at) desc
    limit 50
  `);
  let streak = 0;
  for (const row of streakRows as unknown as Array<{ was_correct_outcome: boolean | null }>) {
    if (row.was_correct_outcome) streak += 1;
    else break;
  }

  return {
    totalPoints: Number(r.total_points),
    betsPlaced: Number(r.bets_placed),
    betsFinal: Number(r.bets_final),
    exactCount: Number(r.exact_count),
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
  const rows = await db.execute<HistoryRow>(sql`
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
  return rows as unknown as HistoryRow[];
}

// Standings predictor: groups with teams and the user's current ordering.
export type GroupWithRanks = {
  id: string;
  displayOrder: number;
  teams: Array<{
    code: string;
    nameHe: string;
    nameEn: string;
    flag: string;
    predictedRank: number | null;
  }>;
};

export async function getGroupsWithPredictions(
  userId: string,
): Promise<GroupWithRanks[]> {
  const rows = await db.execute<{
    group_id: string;
    display_order: number;
    team_code: string;
    name_he: string;
    name_en: string;
    flag: string;
    predicted_rank: number | null;
  }>(sql`
    select
      g.id                       as group_id,
      g.display_order             as display_order,
      t.code                     as team_code,
      t.name_he                  as name_he,
      t.name_en                  as name_en,
      t.flag                     as flag,
      gp.predicted_rank          as predicted_rank
    from public.groups g
    join public.teams t on t.group_id = g.id
    left join public.group_predictions gp
      on gp.user_id = ${userId} and gp.group_id = g.id and gp.team_code = t.code
    order by g.display_order asc, coalesce(gp.predicted_rank, 99) asc, t.code asc
  `);

  const grouped = new Map<string, GroupWithRanks>();
  for (const r of rows as unknown as Array<{
    group_id: string;
    display_order: number;
    team_code: string;
    name_he: string;
    name_en: string;
    flag: string;
    predicted_rank: number | null;
  }>) {
    let entry = grouped.get(r.group_id);
    if (!entry) {
      entry = { id: r.group_id, displayOrder: Number(r.display_order), teams: [] };
      grouped.set(r.group_id, entry);
    }
    entry.teams.push({
      code: r.team_code,
      nameHe: r.name_he,
      nameEn: r.name_en,
      flag: r.flag,
      predictedRank: r.predicted_rank == null ? null : Number(r.predicted_rank),
    });
  }
  return Array.from(grouped.values()).sort((a, b) => a.displayOrder - b.displayOrder);
}

// Bracket predictor: user's picks for champion / runner-up / third / fourth.
export type BracketSlot = "champion" | "runner_up" | "third" | "fourth";

export type BracketRow = {
  slot: BracketSlot;
  teamCode: string | null;
  teamNameHe: string | null;
  teamNameEn: string | null;
  teamFlag: string | null;
};

export async function getBracketPredictions(
  userId: string,
): Promise<Record<BracketSlot, BracketRow>> {
  const rows = await db.execute<{
    slot: BracketSlot;
    team_code: string | null;
    name_he: string | null;
    name_en: string | null;
    flag: string | null;
  }>(sql`
    select
      bp.slot::text as slot,
      bp.team_code  as team_code,
      t.name_he     as name_he,
      t.name_en     as name_en,
      t.flag        as flag
    from public.bracket_predictions bp
    left join public.teams t on t.code = bp.team_code
    where bp.user_id = ${userId}
  `);
  const slots: BracketSlot[] = ["champion", "runner_up", "third", "fourth"];
  const result = {} as Record<BracketSlot, BracketRow>;
  for (const s of slots) {
    result[s] = { slot: s, teamCode: null, teamNameHe: null, teamNameEn: null, teamFlag: null };
  }
  for (const r of rows as unknown as Array<{
    slot: BracketSlot;
    team_code: string | null;
    name_he: string | null;
    name_en: string | null;
    flag: string | null;
  }>) {
    result[r.slot] = {
      slot: r.slot,
      teamCode: r.team_code,
      teamNameHe: r.name_he,
      teamNameEn: r.name_en,
      teamFlag: r.flag,
    };
  }
  return result;
}

export type TeamRow = {
  code: string;
  nameHe: string;
  nameEn: string;
  flag: string;
};

export async function getAllTeams(): Promise<TeamRow[]> {
  const rows = await db.execute<TeamRow>(sql`
    select code, name_he as "nameHe", name_en as "nameEn", flag
    from public.teams
    order by name_en asc
  `);
  return rows as unknown as TeamRow[];
}

export function localizedTeam(
  row: { homeNameHe?: string; awayNameHe?: string; homeNameEn?: string; awayNameEn?: string },
  side: "home" | "away",
  locale: "he" | "en",
): string {
  const key = `${side}Name${locale === "he" ? "He" : "En"}` as keyof typeof row;
  return (row[key] as string) ?? "";
}

// ---------- Live group standings ----------
//
// Derived in pure SQL from finished group-stage matches. Row order follows
// FIFA group-stage tiebreakers: points DESC, goal difference DESC, goals for
// DESC, then team name as a stable final tiebreak. We deliberately stop at
// GF — the remaining tiebreakers (head-to-head + drawing of lots) are rare
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

export async function getLiveStandings(): Promise<LiveGroup[]> {
  const rows = await db.execute<{
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
  }>(sql`
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
  for (const r of rows as unknown as Array<{
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
  }>) {
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
  const rows = await db.execute<TeamProfile>(sql`
    select code, name_he as "nameHe", name_en as "nameEn", flag, group_id as "groupId"
    from public.teams
    where code = ${code.toUpperCase()}
    limit 1
  `);
  const list = rows as unknown as TeamProfile[];
  return list[0] ?? null;
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
  const rows = await db.execute<TeamMatchRow>(sql`
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
  return rows as unknown as TeamMatchRow[];
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
  const rows = await db.execute<H2HMatch>(sql`
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
  return rows as unknown as H2HMatch[];
}

// ---------- Public pool stats ----------
//
// Used by the landing/dashboard hero card. The pot is the sum of all
// approved entry-fee payments; the player count is how many distinct users
// have an approved payment (i.e. paid in). Both numbers must be live — the
// hero card never shows a placeholder.

export type PoolStats = {
  potIls: number;
  participants: number;
};

export async function getPoolStats(): Promise<PoolStats> {
  const rows = await db.execute<{ pot: number; players: number }>(sql`
    select
      coalesce(sum(amount_ils) filter (where status = 'approved'), 0)::int as pot,
      count(distinct user_id) filter (where status = 'approved')::int       as players
    from public.payments
  `);
  const r = (rows as unknown as Array<{ pot: number; players: number }>)[0];
  return {
    potIls: Number(r?.pot ?? 0),
    participants: Number(r?.players ?? 0),
  };
}

// Earliest scheduled match kickoff — i.e. when the tournament starts. Used
// by the landing hero countdown. Returns null if no fixtures have been
// seeded yet, in which case the caller should hide the countdown rather
// than show a placeholder.
export async function getTournamentStart(): Promise<string | null> {
  const rows = await db.execute<{ kickoff_at: string }>(sql`
    select min(kickoff_at) as kickoff_at
    from public.matches
  `);
  const r = (rows as unknown as Array<{ kickoff_at: string | null }>)[0];
  return r?.kickoff_at ?? null;
}
