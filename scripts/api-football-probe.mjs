#!/usr/bin/env node
// Diagnostic probe: hits API-Football directly and reports what comes
// back. Use this when api-football-map-fixtures.mjs reports 0 mapped
// matches and we need to figure out why.
//
// Usage:
//   pnpm api-football:probe
//
// Prints:
//   1. Which leagues match "World Cup" in API-Football's catalog.
//   2. How many fixtures are returned for league=15 + season=2026.
//   3. How many fixtures are returned for league=1  + season=2026.

const apiKey = process.env.API_FOOTBALL_KEY;
if (!apiKey) {
  console.error("API_FOOTBALL_KEY is not set in .env.local");
  process.exit(1);
}

const BASE = "https://v3.football.api-sports.io";
const headers = {
  "x-rapidapi-key": apiKey,
  "x-rapidapi-host": "v3.football.api-sports.io",
};

async function call(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) {
    return { ok: false, status: res.status, body: await res.text() };
  }
  return { ok: true, json: await res.json() };
}

console.log("=== 1) Leagues matching 'world cup' ===\n");
const leagues = await call(`/leagues?search=world%20cup`);
if (!leagues.ok) {
  console.error(`leagues request failed: ${leagues.status}`);
  console.error(leagues.body.slice(0, 500));
  process.exit(1);
}
const rows = leagues.json.response ?? [];
for (const row of rows) {
  const l = row.league;
  const seasons = (row.seasons ?? []).map((s) => s.year);
  console.log(`  id=${String(l.id).padStart(4)}  type=${(l.type ?? "?").padEnd(10)}  name="${l.name}"  country="${row.country?.name ?? "?"}"  seasons=[${seasons.slice(-5).join(",")}]`);
}

console.log("\n=== 2) Fixtures for league=15 season=2026 (what our code currently asks) ===\n");
const fx15 = await call(`/fixtures?league=15&season=2026`);
if (!fx15.ok) {
  console.error(`  request failed: ${fx15.status}`);
  console.error(`  body: ${fx15.body.slice(0, 300)}`);
} else {
  const list = fx15.json.response ?? [];
  console.log(`  results: ${list.length}`);
  if (list.length > 0) {
    const f = list[0];
    console.log(`  sample: ${f.teams.home.name} (${f.teams.home.code ?? "?"}) vs ${f.teams.away.name} (${f.teams.away.code ?? "?"})  @ ${f.fixture.date}`);
  }
}

console.log("\n=== 3) Fixtures for league=1 season=2026 (FIFA World Cup) ===\n");
const fx1 = await call(`/fixtures?league=1&season=2026`);
if (!fx1.ok) {
  console.error(`  request failed: ${fx1.status}`);
  console.error(`  body: ${fx1.body.slice(0, 300)}`);
} else {
  const list = fx1.json.response ?? [];
  console.log(`  results: ${list.length}`);
  if (list.length > 0) {
    const f = list[0];
    console.log(`  sample: ${f.teams.home.name} (${f.teams.home.code ?? "?"}) vs ${f.teams.away.name} (${f.teams.away.code ?? "?"})  @ ${f.fixture.date}`);
    const dates = list.map((r) => r.fixture.date.slice(0, 10));
    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    console.log(`  date range: ${min} to ${max}`);
  }
}

console.log("\n=== 4) Try a few alternate seasons for league=1 ===\n");
for (const season of [2025, 2024, 2022]) {
  const r = await call(`/fixtures?league=1&season=${season}`);
  const count = r.ok ? (r.json.response?.length ?? 0) : `ERR ${r.status}`;
  console.log(`  league=1 season=${season} → ${count} fixtures`);
}

console.log("\nDone.");
