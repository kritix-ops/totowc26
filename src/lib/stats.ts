import "server-only";

import { sql } from "drizzle-orm";
import { execFirstRow, execRows } from "@/db/helpers";
import { fetchTopScorers, type FDScorer } from "./football-data";
import {
  fetchTopScorers as fetchTopScorersApiFootball,
  fetchTopAssists,
  fetchTopYellowCards,
  fetchInjuries,
  fetchStandings,
  fetchTeams,
  fetchSquad,
  fetchTeamStatistics,
  fetchTeamFixtures,
  fetchHeadCoach,
  fetchMatchDetails,
  fetchPrediction,
  type ApiStandingRow,
  type ApiPlayer,
  type ApiTeamStatistics,
  type ApiTeamFixture,
  type ApiCoach,
  type ApiMatchDetails,
  type ApiPrediction,
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
// football-data.org fallback. Same provider model as `_runSync` in
// src/lib/sync.ts: API-Football wins when its key is set and the call
// succeeds; football-data carries the page when API-Football is
// unavailable. Logs use the `[scorers provider]` namespace so they
// line up with the `[sync provider]` lines from the cron — search
// either one in Vercel and you see the full picture.
export async function getLiveTopScorers(limit = 20): Promise<LiveScorer[]> {
  const apiFootball = await fetchTopScorersApiFootball();
  if (apiFootball && apiFootball.length > 0) {
    console.info("[scorers provider]", {
      used: "api-football",
      count: apiFootball.length,
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
    const reason = err instanceof Error ? err.message : String(err);
    console.warn("[scorers provider fallback failed]", {
      from: "api-football",
      to: "football-data",
      reason,
    });
    return [];
  }
  console.info("[scorers provider]", {
    used: "football-data",
    count: raw.length,
    reason: apiFootball === null ? "api-football returned null" : "api-football empty",
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
  return execRows<RecentResult>(sql`
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
  const rows = await execRows<GoalsPerDay>(sql`
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
  return rows.map((r) => ({
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
  const rows = await execRows<TeamCardRow>(sql`
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
  return rows.map((r) => ({
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
  const localTeams = await execRows<{ code: string; name_en: string }>(sql`
    select code, name_en from public.teams
  `);
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

// Known API-Football name variants for teams whose API name doesn't
// match our local nameEn after normalization. Keyed by our local TLA so
// every consumer (apiNameToLocalTla, getApiTeamIdByCode, getTeamInjuries)
// shares the same source — adding a new divergence here picks it up in
// all three callers without a copy-paste hunt.
//
// Per project memory: API-Football team codes are unreliable; we
// reconcile by normalized name with this alias fallback. Values are
// stored pre-normalization (lower-case, no diacritics) so the lookup is
// a single normalizeName() of the incoming string.
const API_TEAM_NAME_ALIASES: Record<string, readonly string[]> = {
  CZE: ["czech republic"],
  BIH: ["bosnia and herzegovina"],
  TUR: ["turkey"],
  CPV: ["cape verde islands", "cabo verde"],
  COD: ["congo dr", "democratic republic of congo"],
  KOR: ["korea republic"],
  CIV: ["cote d ivoire"],
};

// Reverse index of API_TEAM_NAME_ALIASES, built once at module load so
// apiNameToLocalTla isn't rebuilding the map on every call. Normalised
// `apiName → TLA`; an API name that matches via the team's own nameEn
// goes through the direct lookup in apiNameToLocalTla instead.
const API_NAME_TO_TLA: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [tla, variants] of Object.entries(API_TEAM_NAME_ALIASES)) {
    for (const v of variants) out[normalizeName(v)] = tla;
  }
  return out;
})();

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
  return API_NAME_TO_TLA[target] ?? null;
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
  const r = await execFirstRow<{
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
  const played = Number(r?.played_matches ?? 0);
  const goals = Number(r?.total_goals ?? 0);
  return {
    totalMatches: Number(r?.total_matches ?? 0),
    playedMatches: played,
    totalGoals: goals,
    avgGoalsPerMatch: played > 0 ? Math.round((goals / played) * 100) / 100 : 0,
    cleanSheets: Number(r?.clean_sheets ?? 0),
    drawCount: Number(r?.draw_count ?? 0),
  };
}

// ---------- API-Football team-ID lookup (TLA → apiId) ----------
//
// All per-team API-Football endpoints (squad, statistics, fixtures) key
// by the vendor's numeric team id. We never store that id; instead we
// resolve it at request time by hitting /teams once (cached 24h by the
// wrapper) and matching by normalized name.
//
// Returns null when API_FOOTBALL_KEY is unset OR our TLA has no match
// in the API team list. Callers must short-circuit to a graceful empty
// state when null - never throw.

export async function getApiTeamIdByCode(code: string): Promise<number | null> {
  const teams = await fetchTeams();
  if (!teams) return null;

  const local = await execFirstRow<{ code: string; name_en: string }>(sql`
    select code, name_en from public.teams where code = ${code} limit 1
  `);
  const ourName = local?.name_en;
  if (!ourName) return null;

  // Normalize both sides identically. apiNameToLocalTla goes the other
  // direction; here we go API name → match-by-name → apiId.
  const normalizedOurs = normalizeName(ourName);
  for (const t of teams) {
    if (normalizeName(t.name) === normalizedOurs) return t.apiId;
  }
  // Fallback: walk the same shared alias table apiNameToLocalTla uses,
  // but consume it in the TLA → variants direction.
  const apiVariants = API_TEAM_NAME_ALIASES[code] ?? [];
  for (const variant of apiVariants) {
    const norm = normalizeName(variant);
    for (const t of teams) {
      if (normalizeName(t.name) === norm) return t.apiId;
    }
  }
  return null;
}

// ---------- Per-team enrichment ----------
//
// Each helper returns null when the data isn't ready (API stubbed, team
// not found, upstream error), so the UI can branch to an empty state
// instead of crashing.

export async function getTeamSquad(code: string): Promise<ApiPlayer[] | null> {
  const apiId = await getApiTeamIdByCode(code);
  if (apiId === null) return null;
  const squad = await fetchSquad(apiId);
  if (squad) {
    console.info("[wc-zone team] squad fetched", { code, apiId, players: squad.length });
  }
  return squad;
}

// ---------- Match enrichment (lineups + events + ratings) ----------
//
// Resolves our internal match UUID → api_football_fixture_id, then pulls
// the rich /fixtures payload from API-Football. Returns null cleanly
// when:
//   - the match isn't mapped yet
//   - API_FOOTBALL_KEY is unset
//   - the API returns a 4xx/5xx
// The caller can render an empty state without branching on cause.

export async function getMatchEnrichment(
  matchId: string,
  // Live mode shortens the revalidate window to 30s so the events stream
  // stays fresh. Default is the 12h "finished match" cache.
  liveMode = false,
): Promise<ApiMatchDetails | null> {
  const row = await execFirstRow<{ api_football_fixture_id: number | null; status: string }>(sql`
    select api_football_fixture_id, status::text from public.matches where id = ${matchId}::uuid limit 1
  `);
  if (!row || row.api_football_fixture_id == null) return null;

  // Auto-pick live mode for matches in `live` status when caller didn't
  // override. Final matches always use the long cache.
  const live = liveMode || row.status === "live";
  const details = await fetchMatchDetails(row.api_football_fixture_id, live);
  if (details) {
    console.info("[wc-zone match] enrichment fetched", {
      matchId,
      fixtureId: row.api_football_fixture_id,
      status: details.status,
      events: details.events.length,
      lineups: details.lineups.length,
      ratings: details.playerRatings.length,
    });
  }
  return details;
}

// Pre-match prediction for our internal match UUID. Returns null when
// the match isn't mapped to an API-Football fixture (yet) or the API
// key is unset. UI surfaces this as an "AI suggestion" only - we never
// use it for grading.
export async function getMatchPrediction(
  matchId: string,
): Promise<ApiPrediction | null> {
  const row = await execFirstRow<{ api_football_fixture_id: number | null }>(sql`
    select api_football_fixture_id from public.matches where id = ${matchId}::uuid limit 1
  `);
  const fid = row?.api_football_fixture_id;
  if (fid == null) return null;
  const pred = await fetchPrediction(fid);
  if (pred) {
    console.info("[wc-zone match] prediction fetched", {
      matchId,
      fixtureId: fid,
      probHome: pred.probHome,
      probDraw: pred.probDraw,
      probAway: pred.probAway,
    });
  }
  return pred;
}

export async function getTeamCoach(code: string): Promise<ApiCoach | null> {
  const apiId = await getApiTeamIdByCode(code);
  if (apiId === null) return null;
  const coach = await fetchHeadCoach(apiId);
  if (coach) {
    console.info("[wc-zone team] coach fetched", { code, apiId, name: coach.name });
  }
  return coach;
}

export async function getTeamStats(code: string): Promise<ApiTeamStatistics | null> {
  const apiId = await getApiTeamIdByCode(code);
  if (apiId === null) return null;
  const stats = await fetchTeamStatistics(apiId);
  if (stats) {
    console.info("[wc-zone team] stats fetched", { code, apiId, played: stats.played });
  }
  return stats;
}

export async function getTeamRecentFixtures(
  code: string,
  limit = 5,
): Promise<ApiTeamFixture[] | null> {
  const apiId = await getApiTeamIdByCode(code);
  if (apiId === null) return null;
  const all = await fetchTeamFixtures(apiId);
  if (!all) return null;
  // Already finished, newest first.
  const past = all
    .filter((f) => f.status === "FT" || f.status === "AET" || f.status === "PEN")
    .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt))
    .slice(0, limit);
  console.info("[wc-zone team] recent fixtures", { code, apiId, count: past.length });
  return past;
}

// Per-team injuries are a subset of the tournament-wide /injuries feed
// filtered by team name. Avoids a second API call.
export async function getTeamInjuries(code: string): Promise<Array<{
  playerName: string;
  type: string;
  reason: string;
  photoUrl: string | null;
}> | null> {
  const injuries = await fetchInjuries();
  if (!injuries) return null;
  const local = await execFirstRow<{ name_en: string }>(sql`
    select name_en from public.teams where code = ${code} limit 1
  `);
  const ourName = local?.name_en;
  if (!ourName) return [];
  const norm = normalizeName(ourName);
  const acceptedNorm = new Set<string>([
    norm,
    ...(API_TEAM_NAME_ALIASES[code] ?? []).map(normalizeName),
  ]);
  return injuries
    .filter((inj) => acceptedNorm.has(normalizeName(inj.teamName)))
    .map((inj) => ({
      playerName: inj.playerName,
      type: inj.type,
      reason: inj.reason,
      photoUrl: inj.playerPhotoUrl,
    }));
}
