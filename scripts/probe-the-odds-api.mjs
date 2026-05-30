#!/usr/bin/env node
// Probe The Odds API for WC 2026. No DB writes, no commits — prints
// the raw JSON shape so we can decide how to parse + map fixtures.
//
// What it does:
//   1. Calls /v4/sports — confirms `soccer_fifa_world_cup` is enabled
//      on your tier.
//   2. Calls /v4/sports/soccer_fifa_world_cup/odds with markets=h2h —
//      shows the per-fixture odds for every event currently open.
//   3. Prints x-requests-* headers so we can see exactly how many
//      credits each call burned.
//
// Usage:
//   node --env-file=.env.local scripts/probe-the-odds-api.mjs
//
// Required env:
//   THE_ODDS_API_KEY  - the key from the-odds-api.com (free tier ok)
//
// Optional env:
//   THE_ODDS_API_REGION  - default 'eu'. 'us' / 'uk' / 'au' also valid.
//                          Each region adds its bookmakers to the response
//                          and multiplies the credit cost. Stick to one
//                          while probing.

const key = process.env.THE_ODDS_API_KEY;
if (!key) {
  console.error(
    "THE_ODDS_API_KEY is not set. Add it to .env.local and re-run.",
  );
  process.exit(1);
}

const REGION = process.env.THE_ODDS_API_REGION ?? "eu";
const BASE = "https://api.the-odds-api.com/v4";

function summariseRateHeaders(res) {
  return {
    remaining: res.headers.get("x-requests-remaining"),
    used: res.headers.get("x-requests-used"),
    last_credits: res.headers.get("x-requests-last"),
  };
}

async function call(path, label) {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${key}`;
  const t0 = Date.now();
  const res = await fetch(url);
  const ms = Date.now() - t0;
  const rate = summariseRateHeaders(res);
  if (!res.ok) {
    const body = await res.text();
    console.error(`[probe ${label} HTTP ${res.status}]`, { ms, rate, body });
    return null;
  }
  const json = await res.json();
  console.info(`[probe ${label} OK]`, { ms, rate });
  return json;
}

console.info("=== Step 1: /v4/sports — is the WC enabled? ===");
const sports = await call("/sports?all=true", "sports");
if (Array.isArray(sports)) {
  const wc = sports.find((s) => s.key === "soccer_fifa_world_cup");
  const wcWinner = sports.find(
    (s) => s.key === "soccer_fifa_world_cup_winner",
  );
  console.info("  soccer_fifa_world_cup row:", wc);
  console.info("  soccer_fifa_world_cup_winner row:", wcWinner);
}

console.info("");
console.info(`=== Step 2: WC 2026 events with h2h odds, region=${REGION} ===`);
const events = await call(
  `/sports/soccer_fifa_world_cup/odds?regions=${REGION}&markets=h2h&oddsFormat=decimal`,
  "wc h2h",
);

if (Array.isArray(events)) {
  console.info(`  events returned: ${events.length}`);
  if (events.length > 0) {
    const e = events[0];
    console.info("  first event headline:", {
      id: e.id,
      sport_key: e.sport_key,
      commence_time: e.commence_time,
      home_team: e.home_team,
      away_team: e.away_team,
      bookmakers_count: e.bookmakers?.length ?? 0,
    });
    console.info("  first bookmaker shape:", e.bookmakers?.[0]);
    console.info("  --- full first event JSON ---");
    console.info(JSON.stringify(e, null, 2));
  } else {
    console.info(
      "  (zero events — WC odds may not be open yet at this provider's chosen region.\n" +
        "   Try THE_ODDS_API_REGION=us to widen the bookmaker pool.)",
    );
  }
}

console.info("");
console.info("=== Step 3: WC champion outright (futures) ===");
const outright = await call(
  `/sports/soccer_fifa_world_cup_winner/odds?regions=${REGION}&markets=outrights&oddsFormat=decimal`,
  "wc winner outright",
);

if (Array.isArray(outright)) {
  console.info(`  outright events returned: ${outright.length}`);
  if (outright.length > 0) {
    const e = outright[0];
    console.info("  outright event:", {
      id: e.id,
      home_team: e.home_team,
      bookmakers_count: e.bookmakers?.length ?? 0,
    });
    const firstBook = e.bookmakers?.[0];
    if (firstBook) {
      const teams = (firstBook.markets?.[0]?.outcomes ?? []).slice(0, 10);
      console.info(`  ${firstBook.title} — top 10 outright lines:`);
      for (const o of teams) {
        console.info(`    ${o.name.padEnd(20)} ${o.price}`);
      }
    }
  }
}

console.info("");
console.info("=== Done. Save this output and paste back to claude. ===");
