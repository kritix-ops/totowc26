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
// Separate sport key used for the tournament-winner outright market.
// The Odds API exposes outrights under a sibling key rather than as a
// market on the per-match key. Only a small subset of bookmakers price
// it (Betfair Exchange is the most reliable source).
const SPORT_KEY_CHAMPION = "soccer_fifa_world_cup_winner";
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
const MARKET_ID_SPREADS = 4; // API-Football "Asian Handicap"
const MARKET_ID_TOTALS = 5; // API-Football "Goals Over/Under"
const MARKET_ID_BTTS = 8; // API-Football "Both Teams Score"

// HONEST CAVEAT: The Odds API's soccer feed does NOT expose corners,
// cards (yellow/red), shots, fouls, possession, or any other per-team
// statistical market. Those markets exist at real bookmakers (Bet365,
// Betfair) but are part of "additional markets" that wholesale data
// providers like The Odds API don't carry for soccer. To support them
// we would need a different provider (paid, typically $200+/mo) or
// manual admin entry. Per the project's "friends pool, not a
// business" constraint we keep the suggestions UI to the markets we
// can actually pull, and admins create custom_bets manually for
// corners/cards (the standard /admin/bets flow already supports them
// via the AutoApiFootballStat enum once API-Football grading runs).

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
  // Markets fetched: h2h (1X2), totals (goals over/under), btts (both
  // teams to score yes/no), spreads (Asian handicap on goals). Each
  // costs 1 credit per cron pass against the full WC board — 4 credits
  // total. Per the budget calc above the cron schedule keeps us
  // comfortably inside the free 500-credits/month tier.
  const events = await fetchBoard(["h2h", "totals", "btts", "spreads"]);
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

  // The emit shape is "one MarketOdds = one bet a friend will pick from".
  // For h2h that's 1 entry with 3 options (Home/Draw/Away). For totals
  // and spreads, the bookmaker offers MANY lines (2.5 / 3.5 / 4.5 / …)
  // and EACH line is its own bet with 2 paired options — the user
  // picks Over OR Under at that line. Emitting per-line keeps the
  // suggestions UI showing "Over/Under 2.5 goals" as a single 2-option
  // bet rather than 4 disconnected yes/no rows.
  const out: MarketOdds[] = [];
  const h2h = aggregateH2H(event);
  if (h2h.length > 0) {
    out.push({ marketId: MARKET_ID_H2H, name: "Match Winner", selections: h2h });
  }
  for (const group of aggregateTotals(event)) {
    out.push({
      marketId: MARKET_ID_TOTALS,
      name: `Goals Over/Under ${group.point.toFixed(1)}`,
      selections: group.selections,
    });
  }
  const btts = aggregateBTTS(event);
  if (btts.length > 0) {
    out.push({
      marketId: MARKET_ID_BTTS,
      name: "Both Teams to Score",
      selections: btts,
    });
  }
  for (const group of aggregateSpreads(event)) {
    out.push({
      marketId: MARKET_ID_SPREADS,
      name: `Asian Handicap ${group.point.toFixed(1)}`,
      selections: group.selections,
    });
  }
  return out;
}

// ---------- champion outright ----------

export type ChampionOutrightRow = {
  teamName: string;
  decimalOdds: number;
  bookmakerCount: number;
};

// Fetch the median per-team odds for the WC tournament-winner outright
// market. Returns an empty array if no bookmakers have priced it yet
// (rare — the market is open ~1 year out) or null on transport error.
//
// One credit per call. Cron triggers this once on each /api/cron/odds-
// sync run; the suggestions/tournament-odds editor reads from the
// outright_odds_snapshot table the cron writes into.
export async function fetchWcChampionOutright(): Promise<
  ChampionOutrightRow[] | null
> {
  const key = process.env.THE_ODDS_API_KEY;
  if (!key) {
    console.warn("[the-odds-api stubbed]", {
      reason: "THE_ODDS_API_KEY not set",
      surface: "champion",
    });
    return null;
  }
  const url =
    `${BASE}/sports/${SPORT_KEY_CHAMPION}/odds` +
    `?regions=${REGION}` +
    `&markets=outrights` +
    `&oddsFormat=decimal` +
    `&apiKey=${key}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    const ms = Date.now() - t0;
    if (!res.ok) {
      console.warn("[the-odds-api champion error]", {
        status: res.status,
        ms,
      });
      return null;
    }
    const events = (await res.json()) as OddsApiEvent[];
    console.info("[the-odds-api champion fetch]", {
      ms,
      events: events.length,
      region: REGION,
      remaining: res.headers.get("x-requests-remaining"),
      lastCredits: res.headers.get("x-requests-last"),
    });
    return aggregateOutright(events);
  } catch (err) {
    console.error("[the-odds-api champion failed]", err);
    return null;
  }
}

function aggregateOutright(events: OddsApiEvent[]): ChampionOutrightRow[] {
  // The outright market wraps every team in a single event with
  // one outcome per team; bookmakers each carry their own outcome list.
  // Group by team name (normalised) and take the median across books.
  const prices = new Map<string, { display: string; quotes: number[] }>();
  for (const event of events) {
    for (const bm of event.bookmakers) {
      const market = bm.markets.find((m) => m.key === "outrights");
      if (!market) continue;
      for (const o of market.outcomes) {
        const p = Number(o.price);
        if (!Number.isFinite(p) || p <= 1) continue;
        const k = normaliseName(o.name);
        if (!k) continue;
        const cur = prices.get(k);
        if (cur) {
          cur.quotes.push(p);
        } else {
          prices.set(k, { display: o.name, quotes: [p] });
        }
      }
    }
  }
  const out: ChampionOutrightRow[] = [];
  for (const { display, quotes } of prices.values()) {
    const m = median(quotes);
    if (m == null) continue;
    out.push({
      teamName: display,
      decimalOdds: m,
      bookmakerCount: quotes.length,
    });
  }
  // Favourite first, then in decimal-odds order.
  out.sort((a, b) => a.decimalOdds - b.decimalOdds);
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

type Group = { point: number; selections: MarketOdds["selections"] };

function aggregateTotals(event: OddsApiEvent): Group[] {
  // totals outcomes carry a `point` (e.g. 2.5). One bookmaker prices
  // Over 2.5 AND Under 2.5 as a PAIR — they share one line. Group by
  // point so each line becomes a self-contained 2-option bet (Over /
  // Under). Caller flattens to MarketOdds[] with the point baked into
  // the market name.
  const byPoint = new Map<
    number,
    { over: number[]; under: number[] }
  >();
  for (const bm of event.bookmakers) {
    const market = bm.markets.find((m) => m.key === "totals");
    if (!market) continue;
    for (const o of market.outcomes) {
      const p = Number(o.price);
      if (!Number.isFinite(p) || p <= 1) continue;
      const point = typeof o.point === "number" ? o.point : null;
      if (point == null) continue;
      const bucket = byPoint.get(point) ?? { over: [], under: [] };
      const side = normaliseName(o.name);
      if (side === "over") bucket.over.push(p);
      else if (side === "under") bucket.under.push(p);
      byPoint.set(point, bucket);
    }
  }
  const out: Group[] = [];
  for (const [point, { over, under }] of byPoint) {
    const overMed = median(over);
    const underMed = median(under);
    // Skip half-lines where only one side priced — the user can't pick
    // an Over without an Under to pair against.
    if (overMed == null || underMed == null) continue;
    out.push({
      point,
      selections: [
        { label: `Over ${point.toFixed(1)}`, decimalOdds: overMed },
        { label: `Under ${point.toFixed(1)}`, decimalOdds: underMed },
      ],
    });
  }
  out.sort((a, b) => a.point - b.point);
  return out;
}

function aggregateBTTS(event: OddsApiEvent): MarketOdds["selections"] {
  // btts (both teams to score) outcomes are simple "Yes" / "No"
  // labels. No `point`, no team-name normalisation needed.
  const prices = new Map<string, number[]>();
  for (const bm of event.bookmakers) {
    const market = bm.markets.find((m) => m.key === "btts");
    if (!market) continue;
    for (const o of market.outcomes) {
      const p = Number(o.price);
      if (!Number.isFinite(p) || p <= 1) continue;
      const k = normaliseName(o.name);
      let label: string | null = null;
      if (k === "yes") label = "Yes";
      else if (k === "no") label = "No";
      if (!label) continue;
      const arr = prices.get(label) ?? [];
      arr.push(p);
      prices.set(label, arr);
    }
  }
  const out: MarketOdds["selections"] = [];
  for (const label of ["Yes", "No"] as const) {
    const m = median(prices.get(label) ?? []);
    if (m != null) out.push({ label, decimalOdds: m });
  }
  return out;
}

function aggregateSpreads(event: OddsApiEvent): Group[] {
  // spreads (handicap on goals) outcomes carry a `point` (the
  // handicap) AND the team name. A line pairs Home -X with Away +X
  // (or Home +X with Away -X). We canonicalise on the Home side's
  // signed handicap: positive = Home gets a head start, negative =
  // Home gives up goals.
  const byPoint = new Map<
    number,
    { home: number[]; away: number[] }
  >();
  for (const bm of event.bookmakers) {
    const market = bm.markets.find((m) => m.key === "spreads");
    if (!market) continue;
    for (const o of market.outcomes) {
      const p = Number(o.price);
      if (!Number.isFinite(p) || p <= 1) continue;
      const point = typeof o.point === "number" ? o.point : null;
      if (point == null) continue;
      // Canonical line = signed handicap from the HOME side's
      // perspective. If this outcome is on the away side, mirror.
      let homeSignedLine: number | null = null;
      let side: "home" | "away" | null = null;
      if (teamsMatch(o.name, event.home_team)) {
        side = "home";
        homeSignedLine = point;
      } else if (teamsMatch(o.name, event.away_team)) {
        side = "away";
        homeSignedLine = -point;
      }
      if (side == null || homeSignedLine == null) continue;
      const bucket = byPoint.get(homeSignedLine) ?? { home: [], away: [] };
      if (side === "home") bucket.home.push(p);
      else bucket.away.push(p);
      byPoint.set(homeSignedLine, bucket);
    }
  }
  const out: Group[] = [];
  for (const [homeLine, { home, away }] of byPoint) {
    const homeMed = median(home);
    const awayMed = median(away);
    if (homeMed == null || awayMed == null) continue;
    const homeSign = homeLine > 0 ? "+" : "";
    const awaySign = -homeLine > 0 ? "+" : "";
    out.push({
      point: homeLine,
      selections: [
        { label: `Home ${homeSign}${homeLine.toFixed(1)}`, decimalOdds: homeMed },
        { label: `Away ${awaySign}${(-homeLine).toFixed(1)}`, decimalOdds: awayMed },
      ],
    });
  }
  out.sort((a, b) => a.point - b.point);
  return out;
}
