import "server-only";

import type { AutoApiFootballStat } from "@/lib/bets/types";

// API-Football (v3.football.api-sports.io) wrapper.
//
// The Pro tier ($19/mo) covers every national-team competition we care
// about (friendlies, qualifiers, World Cup, Nations League, Copa America,
// Euros) plus full match statistics. We use it only for the auto-grading
// pipeline — scores and lineups still come from football-data.org via
// the existing match sync. This file is the single integration point;
// nothing else in the codebase should hit api-sports.io directly.
//
// Activation: set `API_FOOTBALL_KEY` in env. Until then, every call here
// returns `null` and emits a [api-football stubbed] warn so the
// auto-grader can fall back to manual queueing without throwing.
//
// Rate budget: Pro tier = 7,500 requests/day. The sync cron runs every
// few minutes and at most pulls stats for matches that just went final,
// so a single match-day's run hits 5–10 fixtures × 1 endpoint = well
// inside the budget. No quota tracking here for v1.

const BASE = "https://v3.football.api-sports.io";

export type ApiFootballStats = Partial<Record<AutoApiFootballStat, number>>;

export type TeamStats = {
  homeTeamCode: string;
  awayTeamCode: string;
  homeStats: ApiFootballStats;
  awayStats: ApiFootballStats;
  combined: ApiFootballStats;
};

// Fetch team-level statistics for a single fixture. Returns null when:
//   1. API_FOOTBALL_KEY is not set (stub mode — current production state).
//   2. The fixture has not been mapped to an API-Football fixture ID yet.
//   3. The API returned 4xx/5xx (the caller should leave the bet in the
//      manual queue and try again on the next sync).
//
// On a successful 200, returns a normalised object with home / away
// counts plus a `combined` map of sum-over-both-teams for bets that
// don't distinguish sides (e.g. "total corners in the match").
export async function fetchFixtureStats(
  apiFootballFixtureId: number,
): Promise<TeamStats | null> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    console.warn("[api-football stubbed]", {
      reason: "API_FOOTBALL_KEY not set",
      apiFootballFixtureId,
    });
    return null;
  }

  try {
    const res = await fetch(
      `${BASE}/fixtures/statistics?fixture=${apiFootballFixtureId}`,
      {
        headers: {
          "x-rapidapi-key": key,
          "x-rapidapi-host": "v3.football.api-sports.io",
        },
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) {
      console.warn("[api-football error]", {
        apiFootballFixtureId,
        status: res.status,
      });
      return null;
    }
    const json = (await res.json()) as ApiFootballStatsResponse;
    return parseStatsResponse(json);
  } catch (err) {
    console.error("[api-football fetch failed]", { apiFootballFixtureId, err });
    return null;
  }
}

// ---------- response shape + parser ----------

type ApiFootballStatItem = {
  type: string;
  value: string | number | null;
};

type ApiFootballStatsResponse = {
  response?: Array<{
    team: { id: number; name: string; logo: string };
    statistics: ApiFootballStatItem[];
  }>;
};

// Map from API-Football's stat label to our internal AutoApiFootballStat
// keys. Done as a lookup table so a vendor-side rename is one edit.
const STAT_LABEL_MAP: Record<string, AutoApiFootballStat> = {
  "Corner Kicks":     "corners",
  "Yellow Cards":     "yellow_cards",
  "Red Cards":        "red_cards",
  "Total Shots":      "shots",
  "Shots on Goal":    "shots_on_goal",
  "Shots insidebox":  "shots_inside_box",
  "Shots outsidebox": "shots_outside_box",
  "Ball Possession":  "possession",
  "Fouls":            "fouls",
  "Offsides":         "offsides",
  "Goalkeeper Saves": "saves",
  "Total passes":     "total_passes",
  "Passes %":         "pass_accuracy",
};

function parseStatsResponse(json: ApiFootballStatsResponse): TeamStats | null {
  const teams = json.response;
  if (!teams || teams.length !== 2) return null;
  const [first, second] = teams;
  const homeStats = normaliseTeamStats(first.statistics);
  const awayStats = normaliseTeamStats(second.statistics);
  const combined = combineStats(homeStats, awayStats);
  return {
    homeTeamCode: String(first.team.id),
    awayTeamCode: String(second.team.id),
    homeStats,
    awayStats,
    combined,
  };
}

function normaliseTeamStats(items: ApiFootballStatItem[]): ApiFootballStats {
  const out: ApiFootballStats = {};
  for (const item of items) {
    const key = STAT_LABEL_MAP[item.type];
    if (!key) continue;
    const value = parseStatValue(item.value);
    if (value === null) continue;
    out[key] = value;
  }
  return out;
}

// API-Football encodes possession + pass accuracy as percentage strings
// ("53%"). Other counters arrive as raw numbers, but the API also returns
// null occasionally — collapse both to null so callers can branch on it.
function parseStatValue(raw: string | number | null): number | null {
  if (raw === null) return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/%$/, "");
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function combineStats(
  a: ApiFootballStats,
  b: ApiFootballStats,
): ApiFootballStats {
  const out: ApiFootballStats = {};
  const keys = new Set<AutoApiFootballStat>([
    ...(Object.keys(a) as AutoApiFootballStat[]),
    ...(Object.keys(b) as AutoApiFootballStat[]),
  ]);
  for (const k of keys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    // Possession + pass accuracy are percentages — summing them is not
    // meaningful, so we leave the combined slot empty for those.
    if (k === "possession" || k === "pass_accuracy") continue;
    out[k] = av + bv;
  }
  return out;
}
