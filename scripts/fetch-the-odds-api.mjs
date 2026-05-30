#!/usr/bin/env node
// Dry-run matcher between The Odds API and our local matches table.
// No DB writes — prints a table so we can see whether team-name +
// commence-time matching is accurate before we wire this into the
// suggestions page.
//
// What it does:
//   1. Calls /v4/sports/soccer_fifa_world_cup/odds?markets=h2h once
//      — burns 1 credit total, regardless of fixture count.
//   2. Loads every match from our DB with its home/away team names
//      (English) and kickoff time.
//   3. For each DB match, tries to find the matching Odds API event
//      via normalised home + away + commence-time (±60 min tolerance).
//   4. For matched events, computes the median decimal odds across
//      every bookmaker that priced this market, then translates each
//      outcome (Home / Away / Draw) into a payout via the same
//      normalizeOdds formula the rest of the app uses (settings
//      knobs: baseStake=3, maxPayout=25, houseEdgePct=5 by default).
//   5. Prints a compact summary: matched count, unmatched count, and
//      for the first few matches the median odds + computed payouts.
//
// Why dry-run: we want to validate the team-name matching against the
// real bookmaker data before changing src/lib/odds.ts. Names like
// "USA" vs "United States" vs "United States of America" will break
// without aliasing, and we want to know that before users see broken
// pricing in production.
//
// Usage:
//   node --env-file=.env.local scripts/fetch-the-odds-api.mjs
//
// Required env:
//   THE_ODDS_API_KEY  - the-odds-api.com key
//   DIRECT_URL        - Supabase direct connection string
//
// Optional env:
//   THE_ODDS_API_REGION  - default 'eu'. 'us' / 'uk' / 'au' / 'eu'.
//                          Each region adds its own bookmakers but
//                          credits scale linearly.

import postgres from "postgres";

const apiKey = process.env.THE_ODDS_API_KEY;
const dbUrl = process.env.DIRECT_URL;
const REGION = process.env.THE_ODDS_API_REGION ?? "eu";

if (!apiKey) {
  console.error("THE_ODDS_API_KEY is not set. Add it to .env.local.");
  process.exit(1);
}
if (!dbUrl) {
  console.error("DIRECT_URL is not set. Pass --env-file=.env.local.");
  process.exit(1);
}

const BASE = "https://api.the-odds-api.com/v4";

// Mirrors src/lib/odds-normalize.ts. Inlined here because the script
// can't import from src/* (path aliases). Keep this in sync — change
// one, change both.
const ODDS_CONFIG = { baseStake: 3, maxPayout: 25, houseEdgePct: 5 };

function normalizeOdds(decimalOdds, cfg) {
  const stake = Math.max(1, Math.floor(cfg.baseStake));
  const safeOdds = decimalOdds > 1 ? decimalOdds : 1.01;
  const houseFactor = (100 - Math.max(0, Math.min(50, cfg.houseEdgePct))) / 100;
  const rawPayout = stake * safeOdds * houseFactor;
  let payout = Math.floor(rawPayout + 0.5);
  const cap = Math.max(stake + 1, Math.floor(cfg.maxPayout));
  if (payout > cap) payout = cap;
  if (payout < stake + 1) payout = stake + 1;
  return { stake, payout };
}

function normaliseName(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[‘’'`´]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Known team-name aliases. Add rows here when matching fails. Bidirectional —
// either side may appear as input. Each pair maps both directions.
const ALIASES = [
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

function nameVariants(raw) {
  const n = normaliseName(raw);
  const variants = new Set([n]);
  for (const [a, b] of ALIASES) {
    if (n === a) variants.add(b);
    if (n === b) variants.add(a);
  }
  return variants;
}

function teamsMatch(rawA, rawB) {
  const a = nameVariants(rawA);
  for (const v of nameVariants(rawB)) {
    if (a.has(v)) return true;
  }
  return false;
}

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ---------- 1. Fetch the WC h2h board ----------

console.info("=== Fetching WC h2h board from The Odds API ===");
const t0 = Date.now();
const url = `${BASE}/sports/soccer_fifa_world_cup/odds?regions=${REGION}&markets=h2h&oddsFormat=decimal&apiKey=${apiKey}`;
const res = await fetch(url);
if (!res.ok) {
  console.error(
    `[the-odds-api HTTP ${res.status}]`,
    await res.text(),
  );
  process.exit(1);
}
const events = await res.json();
const fetchMs = Date.now() - t0;

console.info("[the-odds-api fetch]", {
  ms: fetchMs,
  events: events.length,
  requests_remaining: res.headers.get("x-requests-remaining"),
  requests_used: res.headers.get("x-requests-used"),
  last_call_credits: res.headers.get("x-requests-last"),
});

// ---------- 2. Load DB fixtures ----------

const sql = postgres(dbUrl, { prepare: false });
const dbFixtures = await sql`
  select
    m.id              as id,
    m.home_team       as home_code,
    m.away_team       as away_code,
    th.name_en        as home_name,
    ta.name_en        as away_name,
    m.kickoff_at      as kickoff_at,
    m.api_football_fixture_id as api_football_fixture_id,
    m.stage           as stage
  from matches m
  join teams th on th.code = m.home_team
  join teams ta on ta.code = m.away_team
  order by m.kickoff_at asc
`;

console.info("");
console.info("=== DB fixtures ===");
console.info(`  total: ${dbFixtures.length}`);

// ---------- 3. Match + compute median odds ----------

const matched = [];
const unmatchedDb = [];

for (const fx of dbFixtures) {
  const ko = new Date(fx.kickoff_at).getTime();
  const candidate = events.find((e) => {
    if (!teamsMatch(e.home_team, fx.home_name)) return false;
    if (!teamsMatch(e.away_team, fx.away_name)) return false;
    const eko = new Date(e.commence_time).getTime();
    return Math.abs(eko - ko) <= 60 * 60 * 1000;
  });
  if (!candidate) {
    unmatchedDb.push(fx);
    continue;
  }
  matched.push({ fx, event: candidate });
}

// Events the API returned that we couldn't link to any DB fixture.
const matchedEventIds = new Set(matched.map((m) => m.event.id));
const unmatchedEvents = events.filter((e) => !matchedEventIds.has(e.id));

console.info("");
console.info("=== Matching summary ===");
console.info(`  matched:           ${matched.length}`);
console.info(`  db without odds:   ${unmatchedDb.length}`);
console.info(`  odds without db:   ${unmatchedEvents.length}`);

if (unmatchedDb.length > 0) {
  console.info("");
  console.info("  --- DB fixtures with NO odds match (first 10) ---");
  for (const fx of unmatchedDb.slice(0, 10)) {
    console.info(
      `    ${fx.stage.padEnd(12)} ${fx.home_name.padEnd(24)} vs ${fx.away_name.padEnd(24)}  ${new Date(fx.kickoff_at).toISOString()}`,
    );
  }
}

if (unmatchedEvents.length > 0) {
  console.info("");
  console.info("  --- API events with NO DB fixture (first 10) ---");
  for (const e of unmatchedEvents.slice(0, 10)) {
    console.info(
      `    ${e.home_team.padEnd(24)} vs ${e.away_team.padEnd(24)}  ${e.commence_time}`,
    );
  }
}

// ---------- 4. Median + payout per matched fixture ----------

console.info("");
console.info("=== Median odds + payouts (first 8 matched fixtures) ===");

const homeColW = 22;
const awayColW = 22;
console.info(
  `  ${"home".padEnd(homeColW)} ${"away".padEnd(awayColW)}  H_odds  D_odds  A_odds  | H_pay D_pay A_pay  books`,
);

for (const m of matched.slice(0, 8)) {
  const { fx, event } = m;
  const homePrices = [];
  const drawPrices = [];
  const awayPrices = [];
  let bookmakerCount = 0;

  for (const bm of event.bookmakers) {
    const market = bm.markets.find((mk) => mk.key === "h2h");
    if (!market) continue;
    let countedThisBm = false;
    for (const outcome of market.outcomes) {
      const p = Number(outcome.price);
      if (!Number.isFinite(p) || p <= 1) continue;
      if (teamsMatch(outcome.name, event.home_team)) {
        homePrices.push(p);
        countedThisBm = true;
      } else if (teamsMatch(outcome.name, event.away_team)) {
        awayPrices.push(p);
        countedThisBm = true;
      } else if (normaliseName(outcome.name) === "draw") {
        drawPrices.push(p);
        countedThisBm = true;
      }
    }
    if (countedThisBm) bookmakerCount += 1;
  }

  const hMed = median(homePrices);
  const dMed = median(drawPrices);
  const aMed = median(awayPrices);
  const hPay = hMed != null ? normalizeOdds(hMed, ODDS_CONFIG).payout : "—";
  const dPay = dMed != null ? normalizeOdds(dMed, ODDS_CONFIG).payout : "—";
  const aPay = aMed != null ? normalizeOdds(aMed, ODDS_CONFIG).payout : "—";

  console.info(
    `  ${fx.home_name.padEnd(homeColW)} ${fx.away_name.padEnd(awayColW)}  ` +
      `${(hMed?.toFixed(2) ?? "—").padStart(6)}  ` +
      `${(dMed?.toFixed(2) ?? "—").padStart(6)}  ` +
      `${(aMed?.toFixed(2) ?? "—").padStart(6)}  | ` +
      `${String(hPay).padStart(5)} ${String(dPay).padStart(5)} ${String(aPay).padStart(5)}  ${bookmakerCount}`,
  );
}

// ---------- 5. Done ----------

console.info("");
console.info(
  `=== Done. Credit count after this run: used ${res.headers.get("x-requests-used")}, remaining ${res.headers.get("x-requests-remaining")} ===`,
);
console.info(
  "    If matching looks right, paste the output back to claude — we'll wire it into src/lib/odds.ts next.",
);

await sql.end({ timeout: 5 });
