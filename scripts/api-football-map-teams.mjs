#!/usr/bin/env node
// Backfills teams.api_football_team_id with API-Football's numeric
// team id for every WC team in our local DB.
//
// Once this column is populated for every team, the daily fixture
// sync (PR 2 of _plans/2026-05-27-migrate-fixture-sync-to-api-
// football.md) resolves fixtures to local team codes via a primary-
// key lookup instead of the string-matching that today causes 32
// rows to be skipped on every cron fire.
//
// Strategy per local team:
//   1. Normalised English-name match against the API team list,
//      with the alias table below (kept in sync with the squads
//      sync script — update both if you add an alias).
//   2. Otherwise, leave the row unchanged and print an UNRESOLVED
//      line so the operator can patch the alias table or write
//      the id directly via SQL.
//
// We deliberately do NOT match on API-Football's 3-letter `code`
// field. Their codes are unreliable for this tournament: two
// distinct teams share `code="AUS"` (Australia=20 and Austria=775)
// and two share `code="IRA"` (Iran=22 and Iraq=1567). A naive
// code-keyed Map silently keeps the last entry and produces the
// wrong mapping. Their codes also disagree with ours on many
// teams (BOS/BIH, JAP/JPN, ZEA/NZL, SOU/RSA, CAP/CPV, …), so the
// shortcut bought nothing even when it didn't actively mislead.
//
// Idempotent: re-running is safe. Rows already mapped to the same
// id are not rewritten; rows mapped to a different id are flagged
// loudly (probably a vendor-side renumbering — needs human review).
//
// Usage:
//   node --env-file=.env.local scripts/api-football-map-teams.mjs
//   node --env-file=.env.local scripts/api-football-map-teams.mjs --dry-run
//
// Required env:
//   DIRECT_URL          - Supabase direct connection string
//   API_FOOTBALL_KEY    - api-sports.io key
//
// Optional env:
//   API_FOOTBALL_SEASON - tournament season (default: 2026)

import postgres from "postgres";

const url = process.env.DIRECT_URL;
const apiKey = process.env.API_FOOTBALL_KEY;
const SEASON = Number(process.env.API_FOOTBALL_SEASON ?? 2026);
const LEAGUE = 1; // FIFA World Cup (national teams). id 15 is the Club World Cup.
const dryRun = process.argv.includes("--dry-run");

// Mirrors the alias list in api-football-sync-squads.mjs. Keep in
// sync if you add a new alias there.
const TEAM_NAME_ALIASES = [
  ["czechia",            "czech republic"],
  ["bosnia herzegovina", "bosnia and herzegovina"],
  ["turkiye",            "turkey"],
  ["cape verde",         "cape verde islands"],
  ["cape verde",         "cabo verde"],
  ["dr congo",           "congo dr"],
  ["dr congo",           "congo democratic republic"],
  ["dr congo",           "democratic republic of congo"],
  ["south korea",        "korea republic"],
  ["ivory coast",        "cote d ivoire"],
];

if (!url) {
  console.error(
    "DIRECT_URL is not set. Run with: node --env-file=.env.local scripts/api-football-map-teams.mjs",
  );
  process.exit(1);
}
if (!apiKey) {
  console.error(
    "API_FOOTBALL_KEY is not set. Add it to .env.local before running.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

function normaliseName(s) {
  // NFD + combining-mark strip so accents collapse to plain
  // ASCII (Türkiye → turkiye, Curaçao → curacao). Without this,
  // diacritics get replaced with a space by the [^a-z0-9 ]+
  // pass below and the alias table never matches.
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamNamesEqual(a, b) {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (na === nb) return true;
  for (const [canon, variant] of TEAM_NAME_ALIASES) {
    if ((na === canon && nb === variant) || (na === variant && nb === canon)) {
      return true;
    }
  }
  return false;
}

async function apiGet(path) {
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "v3.football.api-sports.io",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

try {
  console.log(
    `[map-teams start]`,
    { league: LEAGUE, season: SEASON, dryRun },
  );

  // ── Step 1: fetch tournament teams from API-Football ───────────────
  console.log(`Fetching API-Football teams for league=${LEAGUE}, season=${SEASON}…`);
  const teamsJson = await apiGet(`/teams?league=${LEAGUE}&season=${SEASON}`);
  const apiTeams = (teamsJson.response ?? []).map((row) => ({
    apiId: row.team.id,
    name: row.team.name,
    code: (row.team.code ?? "").toUpperCase() || null,
  }));
  console.log(`  Got ${apiTeams.length} teams from API.\n`);
  if (apiTeams.length === 0) {
    console.error("API returned 0 teams — refusing to clear local mappings.");
    process.exit(2);
  }

  // ── Step 2: load local teams + their current mapping ───────────────
  const localTeams = await sql`
    select code, name_en, api_football_team_id
    from public.teams
    order by code asc
  `;
  console.log(`Local teams in DB: ${localTeams.length}.`);

  // ── Step 3: resolve each local team to an API id ───────────────────
  let resolvedFresh = 0;
  let resolvedNoOp = 0;
  let conflicted = 0;
  const unresolved = [];

  for (const lt of localTeams) {
    const api = apiTeams.find((t) => teamNamesEqual(t.name, lt.name_en));

    if (!api) {
      unresolved.push(lt);
      console.log(
        `  [unresolved] ${lt.code.padEnd(4)} ${lt.name_en}`,
      );
      continue;
    }

    const existing = lt.api_football_team_id;
    if (existing != null && existing === api.apiId) {
      resolvedNoOp += 1;
      continue;
    }
    if (existing != null && existing !== api.apiId) {
      conflicted += 1;
      console.warn(
        `  [conflict] ${lt.code.padEnd(4)} ${lt.name_en.padEnd(28)} ` +
        `existing=${existing} new=${api.apiId} (matched name: "${api.name}")`,
      );
      // Conflicts are flagged but NOT auto-overwritten. Operator
      // decides — patch alias map, fix DB by hand, or extend this
      // script with an explicit --force flag.
      continue;
    }

    // Fresh mapping. Apply.
    console.log(
      `  [resolved] ${lt.code.padEnd(4)} ${lt.name_en.padEnd(28)} → ${api.apiId} (matched name: "${api.name}")`,
    );
    if (!dryRun) {
      await sql`
        update public.teams
        set api_football_team_id = ${api.apiId}
        where code = ${lt.code}
      `;
    }
    resolvedFresh += 1;
  }

  console.log();
  console.log(
    `[map-teams done]`,
    {
      total: localTeams.length,
      resolvedFresh,
      resolvedNoOp,
      conflicted,
      unresolved: unresolved.length,
      dryRun,
    },
  );
  if (unresolved.length > 0) {
    console.log(
      `\n${unresolved.length} team(s) could not be mapped. Options:`,
    );
    console.log(`  1. Add an alias to TEAM_NAME_ALIASES in this script + re-run.`);
    console.log(`  2. Set the id by hand:`);
    for (const u of unresolved) {
      console.log(
        `       update public.teams set api_football_team_id = <id> where code = '${u.code}';`,
      );
    }
  }
  if (conflicted > 0) {
    console.log(
      `\n${conflicted} team(s) had an existing id that disagrees with the API. ` +
      `Review the [conflict] lines above and either accept the change manually or extend the alias map.`,
    );
  }
} finally {
  await sql.end();
}
