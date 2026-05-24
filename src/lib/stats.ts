import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fetchTopScorers, type FDScorer } from "./football-data";

// ---------- Live top scorers ----------

export type LiveScorer = {
  rank: number;
  name: string;
  teamCode: string | null;
  teamName: string;
  goals: number;
  assists: number;
};

// Wraps `fetchTopScorers` from the football-data client. The underlying fetch
// is cached for 1h by the football-data wrapper, so calling this on every
// page render is cheap. Returns an empty array on failure so the UI can
// degrade to "data unavailable" instead of crashing the whole page.
export async function getLiveTopScorers(limit = 20): Promise<LiveScorer[]> {
  let raw: FDScorer[] = [];
  try {
    raw = await fetchTopScorers(2026, limit);
  } catch (err) {
    console.warn("[stats] fetchTopScorers failed, returning empty list:", err);
    return [];
  }
  return raw
    .filter((s) => !!s.player?.name)
    .map((s, i) => ({
      rank: i + 1,
      name: s.player.name,
      teamCode: s.team?.tla ?? null,
      teamName: s.team?.name ?? "",
      goals: s.goals ?? 0,
      assists: s.assists ?? 0,
    }));
}

// ---------- Recent results ----------

export type RecentResult = {
  matchId: string;
  kickoffAt: string;
  finalizedAt: string | null;
  stage: string;
  groupId: string | null;
  homeCode: string;
  homeNameHe: string;
  homeNameEn: string;
  awayCode: string;
  awayNameHe: string;
  awayNameEn: string;
  homeScore: number;
  awayScore: number;
  wentToPenalties: boolean | null;
};

export async function getRecentResults(limit = 10): Promise<RecentResult[]> {
  const rows = await db.execute<RecentResult>(sql`
    select
      m.id::text                                  as "matchId",
      m.kickoff_at                                as "kickoffAt",
      m.finalized_at                              as "finalizedAt",
      m.stage::text                               as "stage",
      m.group_id                                  as "groupId",
      m.home_team                                 as "homeCode",
      ht.name_he                                  as "homeNameHe",
      ht.name_en                                  as "homeNameEn",
      m.away_team                                 as "awayCode",
      at.name_he                                  as "awayNameHe",
      at.name_en                                  as "awayNameEn",
      m.home_score                                as "homeScore",
      m.away_score                                as "awayScore",
      m.went_to_penalties                         as "wentToPenalties"
    from public.matches m
    join public.teams ht on ht.code = m.home_team
    join public.teams at on at.code = m.away_team
    where m.status = 'final'
      and m.home_score is not null
      and m.away_score is not null
    order by coalesce(m.finalized_at, m.kickoff_at) desc
    limit ${limit}
  `);
  return rows as unknown as RecentResult[];
}

// ---------- Goals per matchday ----------
//
// Buckets all finished matches by their calendar date and sums total goals.
// This gives a fair-grained chart without us needing to model matchday
// numbers explicitly (which is awkward across group stage + knockouts).

export type GoalsPerDay = {
  day: string; // YYYY-MM-DD
  matches: number;
  goals: number;
};

export async function getGoalsPerDay(): Promise<GoalsPerDay[]> {
  const rows = await db.execute<{
    day: string;
    matches: number;
    goals: number;
  }>(sql`
    select
      to_char(date_trunc('day', m.kickoff_at at time zone 'Asia/Jerusalem'), 'YYYY-MM-DD') as day,
      count(*)::int as matches,
      coalesce(sum(coalesce(m.home_score, 0) + coalesce(m.away_score, 0)), 0)::int as goals
    from public.matches m
    where m.status = 'final'
      and m.home_score is not null
      and m.away_score is not null
    group by date_trunc('day', m.kickoff_at at time zone 'Asia/Jerusalem')
    order by date_trunc('day', m.kickoff_at at time zone 'Asia/Jerusalem') asc
  `);
  return (rows as unknown as GoalsPerDay[]).map((r) => ({
    day: r.day,
    matches: Number(r.matches),
    goals: Number(r.goals),
  }));
}

// ---------- All teams (with group + small record) ----------
//
// Returns every team with its group letter, a flag, and W-D-L-Pts taken from
// the same SQL used by the live standings. Used by the all-teams grid on
// the club hub.

export type TeamCardRow = {
  code: string;
  nameHe: string;
  nameEn: string;
  flag: string;
  groupId: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
};

export async function getAllTeamsWithRecord(): Promise<TeamCardRow[]> {
  const rows = await db.execute<TeamCardRow>(sql`
    with leg as (
      select m.home_team as code,
        case when m.home_score > m.away_score then 1 else 0 end as won,
        case when m.home_score = m.away_score then 1 else 0 end as drawn,
        case when m.home_score < m.away_score then 1 else 0 end as lost,
        case
          when m.home_score > m.away_score then 3
          when m.home_score = m.away_score then 1
          else 0
        end as pts
      from public.matches m
      where m.stage = 'group' and m.status = 'final'
        and m.home_score is not null and m.away_score is not null
      union all
      select m.away_team as code,
        case when m.away_score > m.home_score then 1 else 0 end as won,
        case when m.away_score = m.home_score then 1 else 0 end as drawn,
        case when m.away_score < m.home_score then 1 else 0 end as lost,
        case
          when m.away_score > m.home_score then 3
          when m.away_score = m.home_score then 1
          else 0
        end as pts
      from public.matches m
      where m.stage = 'group' and m.status = 'final'
        and m.home_score is not null and m.away_score is not null
    )
    select
      t.code                                  as "code",
      t.name_he                               as "nameHe",
      t.name_en                               as "nameEn",
      t.flag                                  as "flag",
      t.group_id                              as "groupId",
      coalesce(count(leg.*), 0)::int          as "played",
      coalesce(sum(leg.won), 0)::int          as "won",
      coalesce(sum(leg.drawn), 0)::int        as "drawn",
      coalesce(sum(leg.lost), 0)::int         as "lost",
      coalesce(sum(leg.pts), 0)::int          as "points"
    from public.teams t
    left join leg on leg.code = t.code
    group by t.code, t.name_he, t.name_en, t.flag, t.group_id
    order by t.group_id asc nulls last, t.name_en asc
  `);
  return (rows as unknown as TeamCardRow[]).map((r) => ({
    code: r.code,
    nameHe: r.nameHe,
    nameEn: r.nameEn,
    flag: r.flag,
    groupId: r.groupId,
    played: Number(r.played),
    won: Number(r.won),
    drawn: Number(r.drawn),
    lost: Number(r.lost),
    points: Number(r.points),
  }));
}

// ---------- Tournament headline numbers ----------

export type TournamentSummary = {
  totalMatches: number;
  playedMatches: number;
  totalGoals: number;
  avgGoalsPerMatch: number;
  cleanSheets: number;
  drawCount: number;
};

export async function getTournamentSummary(): Promise<TournamentSummary> {
  const rows = await db.execute<{
    total_matches: number;
    played_matches: number;
    total_goals: number;
    clean_sheets: number;
    draw_count: number;
  }>(sql`
    select
      count(*)::int                                                 as total_matches,
      count(*) filter (where status = 'final')::int                 as played_matches,
      coalesce(sum(coalesce(home_score, 0) + coalesce(away_score, 0))
               filter (where status = 'final'), 0)::int             as total_goals,
      count(*) filter (where status = 'final'
                       and (home_score = 0 or away_score = 0))::int as clean_sheets,
      count(*) filter (where status = 'final'
                       and home_score = away_score)::int            as draw_count
    from public.matches
  `);
  const r = (rows as unknown as Array<{
    total_matches: number;
    played_matches: number;
    total_goals: number;
    clean_sheets: number;
    draw_count: number;
  }>)[0];
  const played = Number(r.played_matches);
  const goals = Number(r.total_goals);
  return {
    totalMatches: Number(r.total_matches),
    playedMatches: played,
    totalGoals: goals,
    avgGoalsPerMatch: played > 0 ? Math.round((goals / played) * 100) / 100 : 0,
    cleanSheets: Number(r.clean_sheets),
    drawCount: Number(r.draw_count),
  };
}
