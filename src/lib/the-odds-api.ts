import "server-only";

import type { MarketOdds } from "./odds";

// Server-only wrapper around the-odds-api.com v4. Replaces API-Football
// as the WC 2026 odds source — verified on 2026-05-30 that API-Football
// has `coverage.odds = false` for the WC (league=1) so the previous
// pipeline could only ever return empty. The Odds API covers 21+
// bookmakers per WC fixture (Pinnacle, Betfair, William Hill, 888sport,
// 1xBet, Marathon, …) and surfaces the entire WC board in a single
// /odds call, regardless of fixture count — one call ≈ one credit per
// requested market.
//
// Credit budget: 500 credits/month on the free tier. h2h+totals fetch
// burns 2 credits per refresh. 1 refresh per day × 38 tournament days
// = 76 credits / month. Comfortable inside the free tier even with a
// few extra admin sessions on top.
//
// Cache: module-level memory keyed by the markets list. The whole board
// fits in a single fetch (~75 events, ~50KB JSON); subsequent
// fetchWcMatchOdds() calls from the suggestions page share the same
// cached board for `BOARD_TTL_MS` so a matchday with 10 fixtures pays
// for exactly one network round-trip rather than ten.
//
// Region: defaults to EU (richest WC bookmaker pool — Pinnacle, Betfair,
// William Hill, 1xBet, sky-bet, Marathon, Betsson, …). US/UK/AU are
// available via THE_ODDS_API_REGION env override but each region adds
// to the credit cost linearly. Stick to one unless we explicitly need
// a US-only book.

const BASE = "https://api.the-odds-api.com/v4";
const SPORT_KEY = "soccer_fifa_world_cup";
const REGION = process.env.THE_ODDS_API_REGION ?? "eu";
const BOARD_TTL_MS = 5 * 60 * 1000;
// Wider window than the deadline tolerance — kickoffs in our DB and
// the bookmaker's `commence_time` should match to the minute, but
// schedule revisions before the tournament can drift by an hour
// (FIFA shifts a kickoff to optimise TV slots; we resync the next
// cron). 60 minutes is generous enough to absorb the drift without
// risking a spurious match against a different fixture.
const KICKOFF_TOLERANCE_MS = 60 * 60 * 1000;

// Synthesised market ids that mirror API-Football's stable numbering
// so downstream consumers (the SKIPPED_MARKET_IDS set on the
// suggestions page, the published-bet rows tagged by market id) keep
// working with no if-elses.
const MARKET_ID_H2H = 1; // API-Football "Match Winner"
const MARKET_ID_TOTALS = 5; // API-Football "Goals Over/Under"

// ---------- API response types ----------

type Outcome = { name: string; price: number; point?: number };
type ApiMarket = {
  key: string;
  last_update: string;
  outcomes: Outcome[];
};
type Bookmaker = {
  key: string;
  title: string;
  last_update: string;
  markets: ApiMarket[];
};
export type OddsApiEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
};

// ---------- cache ----------

const boardCache = new Map<
  string,
  { fetchedAt: number; events: OddsApiEvent[] }
>();

// ---------- name matching (mirrors the matching probe) ----------

const ALIASES: Array<[string, string]> = [
  ["usa", "united states"],
  ["usa", "united states of america"],
  ["korea republic", "south korea"],
  ["czech republic", "czechia"],
  ["bosnia and herzegovina", "bosnia herzegovina"],
  ["turkey", "turkiye"],
  ["ivory coast", "cote d ivoire"],
  ["cape verde", "cape verde islands"],
  ["dr congo", "democratic republic of the congo"],
];

function normaliseName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’'`´]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function nameVariants(raw: string): Set<string> {
  const n = normaliseName(raw);
  const out = new Set([n]);
  for (const [a, b] of ALIASES) {
    if (n === a) out.add(b);
    if (n === b) out.add(a);
  }
  return out;
}

function teamsMatch(a: string, b: string): boolean {
  const va = nameVariants(a);
  for (const v of nameVariants(b)) if (va.has(v)) return true;
  return false;
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// ---------- core fetch ----------

async function fetchBoard(
  markets: string[],
): Promise<OddsApiEvent[] | null> {
  const key = process.env.THE_ODDS_API_KEY;
  if (!key) {
    console.warn("[the-odds-api stubbed]", {
      reason: "THE_ODDS_API_KEY not set",
    });
    return null;
  }
  const cacheKey = [...markets].sort().join(",");
  const cached = boardCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < BOARD_TTL_MS) {
    return cached.events;
  }
  const url =
    `${BASE}/sports/${SPORT_KEY}/odds` +
    `?regions=${REGION}` +
    `&markets=${markets.join(",")}` +
    `&oddsFormat=decimal` +
    `&apiKey=${key}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    const ms = Date.now() - t0;
    if (!res.ok) {
      console.warn("[the-odds-api error]", { status: res.status, ms });
      return null;
    }
    const events = (await res.json()) as OddsApiEvent[];
    boardCache.set(cacheKey, { fetchedAt: Date.now(), events });
    console.info("[the-odds-api fetch]", {
      ms,
      events: events.length,
      region: REGION,
      markets,
      remaining: res.headers.get("x-requests-remaining"),
      lastCredits: res.headers.get("x-requests-last"),
    });
    return events;
  } catch (err) {
    console.error("[the-odds-api fetch failed]", err);
    return null;
  }
}

// ---------- public API ----------

// Fetch the median bookmaker odds for one WC fixture, returning the
// same MarketOdds[] shape the API-Football wrapper used to produce.
// Caller flow:
//   - null   → THE_ODDS_API_KEY missing, HTTP error, or fetch threw.
//              Suggestions page renders "couldn't pull odds, try
//              refresh".
//   - []     → board fetched but our fixture didn't match any of the
//              listed events (team-name mismatch, OR fixture too far
//              in the future for the bookmaker to have priced yet).
//              Suggestions page renders "no markets yet".
//   - rows   → priced markets ready to display.
export async function fetchWcMatchOdds(args: {
  homeTeamEn: string;
  awayTeamEn: string;
  kickoffAt: Date;
}): Promise<MarketOdds[] | null> {
  const events = await fetchBoard(["h2h", "totals"]);
  if (events == null) return null;

  const koMs = args.kickoffAt.getTime();
  const event = events.find((e) => {
    if (!teamsMatch(e.home_team, args.homeTeamEn)) return false;
    if (!teamsMatch(e.away_team, args.awayTeamEn)) return false;
    const eko = new Date(e.commence_time).getTime();
    return Math.abs(eko - koMs) <= KICKOFF_TOLERANCE_MS;
  });

  if (!event) {
    console.info("[the-odds-api no event]", {
      home: args.homeTeamEn,
      away: args.awayTeamEn,
      kickoff: args.kickoffAt.toISOString(),
    });
    return [];
  }

  const out: MarketOdds[] = [];
  const h2h = aggregateH2H(event);
  if (h2h.length > 0) {
    out.push({ marketId: MARKET_ID_H2H, name: "Match Winner", selections: h2h });
  }
  const totals = aggregateTotals(event);
  if (totals.length > 0) {
    out.push({
      marketId: MARKET_ID_TOTALS,
      name: "Goals Over/Under",
      selections: totals,
    });
  }
  return out;
}

// ---------- aggregators ----------

function aggregateH2H(event: OddsApiEvent): MarketOdds["selections"] {
  const prices = new Map<string, number[]>();
  for (const bm of event.bookmakers) {
    const market = bm.markets.find((m) => m.key === "h2h");
    if (!market) continue;
    for (const o of market.outcomes) {
      const p = Number(o.price);
      if (!Number.isFinite(p) || p <= 1) continue;
      // Normalise the bookmaker's outcome label to canonical
      // Home/Draw/Away. Each bookmaker spells the team name
      // differently ("USA" vs "United States" vs "U.S.A."), so we
      // pin via teamsMatch against the event's own team strings.
      let label: string | null = null;
      if (teamsMatch(o.name, event.home_team)) label = "Home";
      else if (teamsMatch(o.name, event.away_team)) label = "Away";
      else if (normaliseName(o.name) === "draw") label = "Draw";
      if (!label) continue;
      const arr = prices.get(label) ?? [];
      arr.push(p);
      prices.set(label, arr);
    }
  }
  const out: MarketOdds["selections"] = [];
  for (const label of ["Home", "Draw", "Away"] as const) {
    const m = median(prices.get(label) ?? []);
    if (m != null) out.push({ label, decimalOdds: m });
  }
  return out;
}

function aggregateTotals(event: OddsApiEvent): MarketOdds["selections"] {
  // totals outcomes carry an additional `point` (e.g. 2.5). Group by
  // name + point so different lines don't blend; the suggestions page
  // surfaces each line separately.
  const prices = new Map<string, number[]>();
  const pointBy = new Map<string, number>();
  for (const bm of event.bookmakers) {
    const market = bm.markets.find((m) => m.key === "totals");
    if (!market) continue;
    for (const o of market.outcomes) {
      const p = Number(o.price);
      if (!Number.isFinite(p) || p <= 1) continue;
      const point = typeof o.point === "number" ? o.point : null;
      if (point == null) continue;
      const key = `${o.name}:${point}`;
      const arr = prices.get(key) ?? [];
      arr.push(p);
      prices.set(key, arr);
      pointBy.set(key, point);
    }
  }
  const out: MarketOdds["selections"] = [];
  for (const [key, arr] of prices) {
    const m = median(arr);
    if (m == null) continue;
    const point = pointBy.get(key) ?? 0;
    const [name] = key.split(":");
    out.push({ label: `${name} ${point.toFixed(1)}`, decimalOdds: m });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
