import "server-only";

import type { AutoApiFootballStat } from "@/lib/bets/types";

// API-Football (v3.football.api-sports.io) wrapper.
//
// The Pro tier ($19/mo) covers every national-team competition we care
// about (friendlies, qualifiers, World Cup, Nations League, Copa America,
// Euros) plus full match statistics. We use it only for the auto-grading
// pipeline - scores and lineups still come from football-data.org via
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

// Exported so the sibling modules (`api-football-data.ts`, `odds.ts`)
// hit the same host without re-typing the URL.
export const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const BASE = API_FOOTBALL_BASE;

// Shared fetch wrapper. Every caller in this module follows the same
// three rules: short-circuit to null when the API key is unset, send
// the rapidapi headers, and degrade gracefully on 4xx/5xx/network
// errors instead of throwing. Extracted here so adding (or tightening)
// the rate-limit logic is a one-place edit.
//
// `path` is everything after BASE (must start with "/"). `cache`
// controls Next.js' fetch cache: `{ revalidateSeconds: N }` for a TTL,
// or `"no-store"` for cron paths that must always see live data.
// `logContext` is the per-call namespace for the stubbed / error logs
// so they remain greppable.
async function apiFootballFetch(
  path: string,
  options: {
    cache: "no-store" | { revalidateSeconds: number };
    logContext: string;
    logExtra?: Record<string, unknown>;
  },
): Promise<unknown | null> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    console.warn(`[api-football ${options.logContext} stubbed]`, {
      reason: "API_FOOTBALL_KEY not set",
      ...options.logExtra,
    });
    return null;
  }

  // Hard 5s ceiling. Without this, a hung api-sports.io connection blocks
  // every caller indefinitely — the admin dashboard awaits this inside a
  // Promise.all and sits on loading.tsx until the OS-level socket timeout
  // (minutes). Five seconds is well past the typical 200-400ms response
  // and short enough that an outage degrades the page instead of freezing.
  const init: RequestInit & { next?: { revalidate: number } } = {
    headers: {
      "x-rapidapi-key": key,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
    signal: AbortSignal.timeout(5000),
  };
  if (options.cache === "no-store") {
    init.cache = "no-store";
  } else {
    init.next = { revalidate: options.cache.revalidateSeconds };
  }

  try {
    const res = await fetch(`${BASE}${path}`, init);
    if (!res.ok) {
      console.warn(`[api-football ${options.logContext} error]`, {
        status: res.status,
        ...options.logExtra,
      });
      return null;
    }
    return await res.json();
  } catch (err) {
    const isTimeout =
      err instanceof DOMException && err.name === "TimeoutError";
    console.error(
      `[api-football ${options.logContext} ${isTimeout ? "timeout" : "fetch failed"}]`,
      {
        err,
        ...options.logExtra,
      },
    );
    return null;
  }
}

// FIFA World Cup (national teams) competition ID on API-Football.
// Verified by hitting /leagues?search=world%20cup: id 1 returns the
// national-team tournament, id 15 is the FIFA *Club* World Cup. Their
// numbering is stable across seasons; only the `season` query param
// changes.
export const API_FOOTBALL_WC_LEAGUE_ID = 1;

// Match-status helpers. API-Football encodes status as short strings
// in `fixture.status.short`. We collapse to our three internal states
// + a sentinel for statuses that should NOT overwrite the existing
// row (cancellations etc. — see comments in `mapApiFootballStatus`).
export type ApiFootballStatusMapped =
  | "scheduled"
  | "live"
  | "final"
  | "no_change";

// Round → internal stage mapping. `groupId` is filled only for
// group-stage matches and only when the standings group-map has the
// home team's group letter.
export type ApiFootballStageMapped = {
  stage: "group" | "r32" | "r16" | "qf" | "sf" | "third_place" | "final";
  groupId: string | null;
};

export type ApiFootballStats = Partial<Record<AutoApiFootballStat, number>>;

export type TeamStats = {
  homeTeamCode: string;
  awayTeamCode: string;
  homeStats: ApiFootballStats;
  awayStats: ApiFootballStats;
  combined: ApiFootballStats;
};

// Fetch team-level statistics for a single fixture. Returns null when:
//   1. API_FOOTBALL_KEY is not set (stub mode - current production state).
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
  const json = await apiFootballFetch(
    `/fixtures/statistics?fixture=${apiFootballFixtureId}`,
    {
      cache: { revalidateSeconds: 60 },
      logContext: "fixture-stats",
      logExtra: { apiFootballFixtureId },
    },
  );
  if (!json) return null;
  return parseStatsResponse(json as ApiFootballStatsResponse);
}

// ─── /fixtures/events (timeline: cards, goals, VAR) ───────────────
//
// Powers event-window auto-grading (red card in the first half, goal in
// the opening 15 minutes, etc.) — the timeline `/fixtures/statistics`
// can't express because it only carries per-team totals. Same graceful
// contract as fetchFixtureStats: null when the key is unset, the fixture
// is unmapped, or the upstream errors, so the grader leaves the bet in
// the manual queue and retries next sync.
//
// VAR caveat: API-Football emits `type:"Var"` events only when the feed
// provider records one, and they frequently miss silent checks (the WC
// opener returned zero Var events despite on-field checks). The event
// grader therefore never infers "no VAR" from their absence — VAR bets
// stay manual. See _plans/2026-06-12-live-bets-llm-overhaul.md Phase 3.

export type ApiFootballEvent = {
  // Clock minute (API `time.elapsed`): 1..90 in regulation, 90+ in extra
  // time. Stoppage stays in `extra`, NOT folded into `minute`, so a 45+2
  // first-half card keeps minute=45 and buckets into the first half
  // correctly. See bucketing in events-grade.ts.
  minute: number;
  // Stoppage-time addition (API `time.extra`), e.g. 2 for 45+2. null when
  // the event is at a clean clock minute.
  extra: number | null;
  teamId: number;
  // Raw API strings: "Goal" | "Card" | "subst" | "Var".
  type: string;
  // "Yellow Card" | "Red Card" | "Normal Goal" | "Penalty" |
  // "Goal cancelled" | "Penalty confirmed" | ...
  detail: string;
};

export async function fetchFixtureEvents(
  apiFootballFixtureId: number,
): Promise<ApiFootballEvent[] | null> {
  const json = await apiFootballFetch(
    `/fixtures/events?fixture=${apiFootballFixtureId}`,
    {
      cache: { revalidateSeconds: 60 },
      logContext: "fixture-events",
      logExtra: { apiFootballFixtureId },
    },
  );
  if (!json) return null;
  return parseEventsResponse(json as ApiFootballEventsResponse);
}

type ApiFootballEventsResponse = {
  response?: Array<{
    time?: { elapsed?: number | null; extra?: number | null };
    team?: { id?: number | null };
    type?: string | null;
    detail?: string | null;
  }>;
};

function parseEventsResponse(
  json: ApiFootballEventsResponse,
): ApiFootballEvent[] {
  const rows = json.response ?? [];
  const out: ApiFootballEvent[] = [];
  for (const r of rows) {
    const elapsed = r.time?.elapsed;
    const teamId = r.team?.id;
    if (typeof elapsed !== "number" || typeof teamId !== "number") continue;
    const extra = typeof r.time?.extra === "number" ? r.time.extra : null;
    out.push({
      minute: elapsed,
      extra,
      teamId,
      type: typeof r.type === "string" ? r.type : "",
      detail: typeof r.detail === "string" ? r.detail : "",
    });
  }
  return out;
}

// ─── /status (quota card in admin) ────────────────────────────────
//
// One-shot lookup for "how many of the Pro daily 7,500 calls have we
// burned today". Returns null when API_FOOTBALL_KEY is unset or the
// upstream is unreachable so the admin Quota card can degrade to an
// empty-state pill without taking down the rest of the sync panel.
//
// The /status endpoint counts against the daily quota itself (1 call
// per render). We cache the result for 30s via Next.js fetch
// revalidate — opening the admin page twice within 30s reuses the
// same response. The "Refresh" action explicitly revalidates the
// admin path, busting the cache.

export type ApiFootballQuota = {
  plan: string;             // e.g. "Pro", "Ultra"
  used: number;             // requests made today
  limitDay: number;         // daily cap from the active plan
  remaining: number;        // computed: limitDay - used (clamped to >= 0)
  subscriptionActive: boolean;
};

export async function fetchApiFootballStatus(): Promise<ApiFootballQuota | null> {
  const json = await apiFootballFetch("/status", {
    cache: { revalidateSeconds: 30 },
    logContext: "quota",
  });
  if (!json) return null;
  const r = (json as ApiFootballStatusResponse).response;
  if (!r) return null;
  const used = Number(r.requests?.current ?? 0);
  const limitDay = Number(r.requests?.limit_day ?? 0);
  const quota: ApiFootballQuota = {
    plan: r.subscription?.plan ?? "unknown",
    used,
    limitDay,
    remaining: Math.max(0, limitDay - used),
    subscriptionActive: Boolean(r.subscription?.active ?? false),
  };
  console.info("[api-football quota]", quota);
  return quota;
}

type ApiFootballStatusResponse = {
  response?: {
    account?: { firstname?: string; lastname?: string; email?: string };
    subscription?: { plan?: string; end?: string; active?: boolean };
    requests?: { current?: number; limit_day?: number };
  };
};

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
// null occasionally - collapse both to null so callers can branch on it.
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
    // Possession + pass accuracy are percentages - summing them is not
    // meaningful, so we leave the combined slot empty for those.
    if (k === "possession" || k === "pass_accuracy") continue;
    out[k] = av + bv;
  }
  return out;
}

// ============================================================================
// Cron sync entry points
// ----------------------------------------------------------------------------
// PR 2 of _plans/2026-05-27-migrate-fixture-sync-to-api-football.md.
// These functions back the daily fixture sync. Throw on transport
// failure (4xx/5xx/network) so the caller can fall back to
// football-data.org — silently returning [] would erase the existing
// matches table.

// Per-match payload consumed by _runSync. `round` is the raw label
// from API-Football (e.g. "Group Stage - 2", "Round of 16"); the
// caller passes it through `mapApiFootballRound` together with the
// home team's group letter from `fetchWorldCupGroupMap`.
export type ApiFootballMatch = {
  fixtureId: number;
  kickoffAt: string;            // ISO 8601 UTC
  statusShort: string;          // NS / 1H / HT / 2H / ET / BT / P / FT / AET / PEN / PST / CANC / ABD / SUSP / INT / AWD / WO / LIVE
  elapsed: number | null;
  homeTeamApiId: number;
  homeTeamName: string;
  awayTeamApiId: number;
  awayTeamName: string;
  homeScoreFt: number | null;
  awayScoreFt: number | null;
  homeScoreHt: number | null;
  awayScoreHt: number | null;
  homeScorePen: number | null;
  awayScorePen: number | null;
  venue: string | null;
  round: string;
};

// Pulls every WC fixture in one round-trip. Throws on transport
// failure so the caller can fall back to football-data.org.
export async function fetchWorldCupFixtures(
  season: number,
): Promise<ApiFootballMatch[]> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    throw new Error("API_FOOTBALL_KEY is not set");
  }
  const res = await fetch(
    `${BASE}/fixtures?league=${API_FOOTBALL_WC_LEAGUE_ID}&season=${season}`,
    {
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": "v3.football.api-sports.io",
      },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `api-football fixtures ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as ApiFootballFullFixturesResponse;
  return (json.response ?? []).map(parseFullFixtureRow);
}

// API-Football's /fixtures payload doesn't carry the group letter
// for group-stage matches — the round string is just "Group Stage - 1".
// We pull /standings separately and build a Map<teamApiId, "A".."L">
// so the caller can tag each fixture with its group.
export async function fetchWorldCupGroupMap(
  season: number,
): Promise<Map<number, string>> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    throw new Error("API_FOOTBALL_KEY is not set");
  }
  const res = await fetch(
    `${BASE}/standings?league=${API_FOOTBALL_WC_LEAGUE_ID}&season=${season}`,
    {
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": "v3.football.api-sports.io",
      },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `api-football standings ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as ApiFootballStandingsResponse;
  const block = json.response?.[0];
  const map = new Map<number, string>();
  if (!block) return map;
  for (const groupArr of block.league.standings) {
    for (const row of groupArr) {
      const letter = extractGroupLetter(row.group);
      if (letter) map.set(row.team.id, letter);
    }
  }
  return map;
}

// "Group A" → "A". Returns null if the label doesn't match the
// expected shape — keep group_id null in that case rather than
// guessing.
function extractGroupLetter(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /Group\s+([A-L])/i.exec(raw);
  return m ? m[1].toUpperCase() : null;
}

export function mapApiFootballStatus(short: string): ApiFootballStatusMapped {
  switch (short.toUpperCase()) {
    // Pre-kickoff.
    case "NS":   // Not Started
    case "TBD":  // To Be Defined
    case "PST":  // Postponed
      return "scheduled";

    // In progress.
    case "1H":   // First half
    case "HT":   // Half time
    case "2H":   // Second half
    case "ET":   // Extra time
    case "BT":   // Break time (between ET halves)
    case "P":    // Penalties shootout
    case "LIVE": // Generic live
      return "live";

    // Final results.
    case "FT":   // Full time
    case "AET":  // After extra time
    case "PEN":  // Decided on penalties
    case "AWD":  // Awarded (forfeit)
    case "WO":   // Walkover
      return "final";

    // Cancellations / abandonments. We don't want to overwrite a row
    // that's already marked final, and we don't have a 'cancelled'
    // internal status to flip to. Caller logs a [sync status anomaly]
    // and skips the status write.
    case "CANC": // Cancelled
    case "ABD":  // Abandoned
    case "SUSP": // Suspended
    case "INT":  // Interrupted
      return "no_change";

    default:
      // Unknown short codes are conservative: keep the current row.
      // The caller logs an anomaly so the vendor-side addition is
      // visible in logs.
      return "no_change";
  }
}

// Translate API-Football's `round` label + a group letter (from
// fetchWorldCupGroupMap) into our internal stage enum + group id.
// Returns null when the round string isn't recognised — caller logs
// a `[sync round unknown]` warning and skips the row.
export function mapApiFootballRound(
  round: string,
  groupLetter: string | null,
): ApiFootballStageMapped | null {
  const norm = round.trim().toLowerCase();
  if (norm.startsWith("group stage")) {
    return { stage: "group", groupId: groupLetter };
  }
  if (norm.startsWith("round of 32")) {
    return { stage: "r32", groupId: null };
  }
  if (norm.startsWith("round of 16")) {
    return { stage: "r16", groupId: null };
  }
  if (norm.startsWith("quarter-final") || norm.startsWith("quarter finals")) {
    return { stage: "qf", groupId: null };
  }
  if (norm.startsWith("semi-final") || norm.startsWith("semi finals")) {
    return { stage: "sf", groupId: null };
  }
  if (
    norm.startsWith("3rd place") ||
    norm.includes("third place") ||
    norm.includes("third-place")
  ) {
    return { stage: "third_place", groupId: null };
  }
  if (norm === "final") {
    return { stage: "final", groupId: null };
  }
  return null;
}

// ─── response shapes for the cron path ────────────────────────────

type ApiFootballFullFixturesResponse = {
  response?: Array<{
    fixture: {
      id: number;
      date: string;
      status: { short: string; elapsed: number | null };
      venue?: { name: string | null } | null;
    };
    league: { round: string };
    teams: {
      home: { id: number; name: string };
      away: { id: number; name: string };
    };
    goals: { home: number | null; away: number | null };
    score: {
      halftime: { home: number | null; away: number | null };
      fulltime: { home: number | null; away: number | null };
      extratime: { home: number | null; away: number | null };
      penalty: { home: number | null; away: number | null };
    };
  }>;
};

function parseFullFixtureRow(
  row: NonNullable<ApiFootballFullFixturesResponse["response"]>[number],
): ApiFootballMatch {
  // Use `score.fulltime` when present (it carries the final scoreline
  // for finished matches), otherwise fall back to `goals` which is the
  // live counter API-Football updates during play.
  const ftHome = row.score?.fulltime?.home ?? row.goals?.home ?? null;
  const ftAway = row.score?.fulltime?.away ?? row.goals?.away ?? null;
  return {
    fixtureId: row.fixture.id,
    kickoffAt: row.fixture.date,
    statusShort: row.fixture.status.short,
    elapsed: row.fixture.status.elapsed ?? null,
    homeTeamApiId: row.teams.home.id,
    homeTeamName: row.teams.home.name,
    awayTeamApiId: row.teams.away.id,
    awayTeamName: row.teams.away.name,
    homeScoreFt: ftHome,
    awayScoreFt: ftAway,
    homeScoreHt: row.score?.halftime?.home ?? null,
    awayScoreHt: row.score?.halftime?.away ?? null,
    homeScorePen: row.score?.penalty?.home ?? null,
    awayScorePen: row.score?.penalty?.away ?? null,
    venue: row.fixture.venue?.name ?? null,
    round: row.league.round,
  };
}

type ApiFootballStandingsResponse = {
  response?: Array<{
    league: {
      standings: Array<
        Array<{
          team: { id: number; name: string };
          group?: string | null;
        }>
      >;
    };
  }>;
};
