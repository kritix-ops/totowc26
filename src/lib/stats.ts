import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fetchTopScorers, type FDScorer } from "./football-data";
import {
  fetchTopScorers as fetchTopScorersApiFootball,
  fetchTopAssists,
  fetchTopYellowCards,
  fetchInjuries,
  fetchStandings,
  type ApiStandingRow,
} from "./api-football-data";

// ---------- Live top scorers ----------

export type LiveScorer = {
  rank: number;
  name: string;
  teamCode: string | null;
  teamName: string;
  goals: number;
  assists: number;
  photoUrl: string | null;
};

// Source priority: API-Football (richer payload, includes photo + shots) →
// football-data.org fallback (no key needed). The API-Football wrapper
// itself returns null when API_FOOTBALL_KEY is unset, so the fallback kicks
// in cleanly during the pre-activation period.
export async function getLiveTopScorers(limit = 20): Promise<LiveScorer[]> {
  const apiFootball = await fetchTopScorersApiFootball();
  if (apiFootball && apiFootball.length > 0) {
    console.info("[wc-zone enrichment] top scorers fetched", {
      count: apiFootball.length,
      source: "api-football",
    });
    return apiFootball.slice(0, limit).map((s, i) => ({
      rank: i + 1,
      name: s.name,
      teamCode: s.teamCode,
      teamName: s.teamName,
      goals: s.goals,
      assists: s.assists,
      photoUrl: s.photoUrl,
    }));
  }

  let raw: FDScorer[] = [];
  try {
    raw = await fetchTopScorers(2026, limit);
  } catch (err) {
    console.warn("[stats] fetchTopScorers failed, returning empty list:", err);
    return [];
  }
  console.info("[wc-zone enrichment] top scorers fetched", {
    count: raw.length,
    source: "football-data",
  });
  return raw
    .filter((s) => !!s.player?.name)
    .map((s, i) => ({
      rank: i + 1,
      name: s.player.name,
      teamCode: s.team?.tla ?? null,
      teamName: s.team?.name ?? "",
      goals: s.goals ?? 0,
      assists: s.assists ?? 0,
      photoUrl: null,
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

// ---------- Live top assists ----------

export type LiveAssister = {
  rank: number;
  name: string;
  teamCode: string | null;
  teamName: string;
  assists: number;
  goals: number;
  photoUrl: string | null;
};

export async function getLiveTopAssists(limit = 10): Promise<LiveAssister[]> {
  const rows = await fetchTopAssists();
  if (!rows) return [];
  console.info("[wc-zone enrichment] top assists fetched", {
    count: rows.length,
  });
  return rows.slice(0, limit).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    teamCode: r.teamCode,
    teamName: r.teamName,
    assists: r.assists,
    goals: r.goals,
    photoUrl: r.photoUrl,
  }));
}

// ---------- Live top yellow cards ----------

export type LiveCardLeader = {
  rank: number;
  name: string;
  teamCode: string | null;
  teamName: string;
  yellow: number;
  red: number;
  photoUrl: string | null;
};

export async function getLiveTopYellowCards(limit = 10): Promise<LiveCardLeader[]> {
  const rows = await fetchTopYellowCards();
  if (!rows) return [];
  console.info("[wc-zone enrichment] top yellow cards fetched", {
    count: rows.length,
  });
  return rows.slice(0, limit).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    teamCode: r.teamCode,
    teamName: r.teamName,
    yellow: r.yellow,
    red: r.red,
    photoUrl: r.photoUrl,
  }));
}

// ---------- Live injuries ----------

export type LiveInjury = {
  playerName: string;
  teamName: string;
  type: string;
  reason: string;
  photoUrl: string | null;
};

export async function getLiveInjuries(limit = 12): Promise<LiveInjury[]> {
  const rows = await fetchInjuries();
  if (!rows) return [];
  console.info("[wc-zone enrichment] injuries fetched", { count: rows.length });
  return rows.slice(0, limit).map((r) => ({
    playerName: r.playerName,
    teamName: r.teamName,
    type: r.type,
    reason: r.reason,
    photoUrl: r.playerPhotoUrl,
  }));
}

// ---------- Live group standings (for 5-match form decoration) ----------

// Returns a lookup from our local TLA (e.g. "CZE") → 5-char form string
// ("WDLWW", newest on the right). API-Football uses different team names
// than we do for 5 nations (Czech Republic / Türkiye / etc.) so we
// translate via apiNameToLocalTla before keying.
export async function getFormByCode(): Promise<Map<string, string>> {
  const rows = await fetchStandings();
  if (!rows) return new Map();

  // Pull local teams once so the lookup loop is O(rows × teams) instead
  // of N queries.
  const localTeams = (await db.execute<{ code: string; name_en: string }>(sql`
    select code, name_en from public.teams
  `)) as unknown as Array<{ code: string; name_en: string }>;
  const local = localTeams.map((t) => ({ code: t.code, nameEn: t.name_en }));

  const map = new Map<string, string>();
  let withForm = 0;
  for (const r of rows) {
    if (!r.teamName || !r.form) continue;
    const code = apiNameToLocalTla(r.teamName, local);
    if (!code) continue;
    map.set(code, r.form);
    withForm += 1;
  }
  console.info("[wc-zone enrichment] standings form available", {
    rows: rows.length,
    rowsWithForm: withForm,
  });
  return map;
}

// Helper used by both standings + team-list correlations: maps API team
// names like "Czech Republic" to our local TLA via the alias table that
// the mapping script uses. Kept here so the UI never has to know.
export function apiNameToLocalTla(
  apiName: string,
  localTeams: Array<{ code: string; nameEn: string }>,
): string | null {
  const target = normalizeName(apiName);
  for (const t of localTeams) {
    if (normalizeName(t.nameEn) === target) return t.code;
  }
  // Alias fallbacks for the 5 known WC-2026 divergences.
  const aliases: Record<string, string> = {
    "czech republic": "CZE",
    "bosnia and herzegovina": "BIH",
    turkey: "TUR",
    "cape verde islands": "CPV",
    "cabo verde": "CPV",
    "congo dr": "COD",
    "democratic republic of congo": "COD",
    "korea republic": "KOR",
    "cote d ivoire": "CIV",
  };
  return aliases[target] ?? null;
}

function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(and|the|of|republic|islands)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Re-export so the UI can read the raw standing rows (e.g. for the
// "leader form" pill on the Summary tab).
export type { ApiStandingRow };

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
