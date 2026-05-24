import "server-only";

// Typed client for api.football-data.org. The free tier (10 req/min) supports
// the FIFA World Cup (competition code WC) including the 2026 edition. Each
// team object already includes a three-letter `tla` code that matches our
// internal ISO-3 codes, so no name mapping needed.

const BASE = "https://api.football-data.org/v4";

function authHeader(): Record<string, string> {
  const key = process.env.FOOTBALL_DATA_TOKEN;
  if (!key) {
    throw new Error("FOOTBALL_DATA_TOKEN is not set");
  }
  return { "X-Auth-Token": key };
}

export type FDMatch = {
  id: number;
  utcDate: string;
  status:
    | "SCHEDULED"
    | "TIMED"
    | "IN_PLAY"
    | "PAUSED"
    | "FINISHED"
    | "SUSPENDED"
    | "POSTPONED"
    | "CANCELLED"
    | "AWARDED";
  stage:
    | "GROUP_STAGE"
    | "LAST_32"
    | "ROUND_OF_32"
    | "LAST_16"
    | "ROUND_OF_16"
    | "QUARTER_FINALS"
    | "SEMI_FINALS"
    | "THIRD_PLACE_FINAL"
    | "FINAL";
  group: string | null;
  homeTeam: { id: number; name: string; tla: string | null };
  awayTeam: { id: number; name: string; tla: string | null };
  score: {
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
  };
  venue?: string | null;
};

export type FDScorer = {
  player: { id: number; name: string };
  team: { id: number; name: string; tla: string | null };
  goals: number;
  assists: number | null;
};

export async function fetchTopScorers(season: number, limit = 30): Promise<FDScorer[]> {
  const url = `${BASE}/competitions/WC/scorers?season=${season}&limit=${limit}`;
  const res = await fetch(url, {
    headers: authHeader(),
    next: { revalidate: 3600 },
  });
  if (res.status === 429) throw new Error("football-data rate limit hit");
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`football-data scorers ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { scorers: FDScorer[] };
  return json.scorers ?? [];
}

export async function fetchWorldCupMatches(season: number): Promise<FDMatch[]> {
  const url = `${BASE}/competitions/WC/matches?season=${season}`;
  const res = await fetch(url, {
    headers: authHeader(),
    cache: "no-store",
  });
  if (res.status === 429) {
    throw new Error("football-data rate limit hit (10/min). Wait a minute.");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`football-data ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { matches: FDMatch[] };
  return json.matches ?? [];
}

export function mapStage(stage: FDMatch["stage"], group: string | null): {
  stage: "group" | "r32" | "r16" | "qf" | "sf" | "third_place" | "final";
  groupId: string | null;
} {
  switch (stage) {
    case "GROUP_STAGE":
      // group is like "GROUP_A". Extract the letter.
      return { stage: "group", groupId: group ? group.replace("GROUP_", "") : null };
    case "LAST_32":
    case "ROUND_OF_32":
      return { stage: "r32", groupId: null };
    case "LAST_16":
    case "ROUND_OF_16":
      return { stage: "r16", groupId: null };
    case "QUARTER_FINALS":
      return { stage: "qf", groupId: null };
    case "SEMI_FINALS":
      return { stage: "sf", groupId: null };
    case "THIRD_PLACE_FINAL":
      return { stage: "third_place", groupId: null };
    case "FINAL":
      return { stage: "final", groupId: null };
    default:
      return { stage: "group", groupId: null };
  }
}

export function mapStatus(s: FDMatch["status"]): "scheduled" | "live" | "final" {
  switch (s) {
    case "FINISHED":
    case "AWARDED":
      return "final";
    case "IN_PLAY":
    case "PAUSED":
      return "live";
    default:
      return "scheduled";
  }
}
