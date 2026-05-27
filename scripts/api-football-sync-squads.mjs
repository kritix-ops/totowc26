#!/usr/bin/env node
// Syncs WC 2026 squads from API-Football into our local players table.
//
// What it does:
//   1. Fetches the tournament team list (league=1, season=API_FOOTBALL_SEASON)
//      to learn each team's API-Football numeric id.
//   2. Matches each API team to our local teams.code (3-letter code or
//      case-insensitive name). Teams that do not match are skipped with
//      a printed warning so the operator can patch the alias map.
//   3. For each matched team, fetches /players/squads?team=<api_id>.
//   4. Upserts each player into public.players keyed by api_football_id.
//      Existing rows have name_en, position, jersey_number, photo_url,
//      birth_date refreshed; name_he is preserved (filled later by the
//      translate-players script).
//
// Idempotent: re-running is safe and will pick up late call-ups /
// jersey-number changes. name_he is NEVER overwritten by this script.
//
// Usage:
//   node --env-file=.env.local scripts/api-football-sync-squads.mjs
//
// Required env:
//   DIRECT_URL          - Supabase direct connection string
//   API_FOOTBALL_KEY    - api-sports.io key
//
// Optional env:
//   API_FOOTBALL_SEASON - tournament season (default: 2026)
//   SLEEP_MS_BETWEEN    - throttle between squad fetches (default: 200)

import postgres from "postgres";

const url = process.env.DIRECT_URL;
const apiKey = process.env.API_FOOTBALL_KEY;
const SEASON = Number(process.env.API_FOOTBALL_SEASON ?? 2026);
const SLEEP_MS = Number(process.env.SLEEP_MS_BETWEEN ?? 200);
const LEAGUE = 1; // FIFA World Cup (national teams). id 15 is the Club World Cup.

// Mirrors the alias list in api-football-map-fixtures.mjs so the
// squad sync uses the same team-name normalisation rules. Keep in
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
    "DIRECT_URL is not set. Run with: node --env-file=.env.local scripts/api-football-sync-squads.mjs",
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
  return String(s ?? "")
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

try {
  // ── Step 1: fetch tournament teams from API-Football ───────────────
  console.log(`Fetching API-Football teams for league=${LEAGUE}, season=${SEASON}…`);
  const teamsJson = await apiGet(`/teams?league=${LEAGUE}&season=${SEASON}`);
  const apiTeams = (teamsJson.response ?? []).map((row) => ({
    apiId: row.team.id,
    name: row.team.name,
    code: (row.team.code ?? "").toUpperCase() || null,
  }));
  console.log(`  Got ${apiTeams.length} teams from API.\n`);

  // ── Step 2: match against our local teams table ────────────────────
  const localTeams = await sql`
    select code, name_en
    from public.teams
    order by code asc
  `;
  console.log(`Local teams in DB: ${localTeams.length}.`);

  const apiByCode = new Map(apiTeams.filter((t) => t.code).map((t) => [t.code, t]));
  const matched = []; // { localCode, localName, apiId, apiName }
  const unmatched = [];

  for (const lt of localTeams) {
    const byCode = apiByCode.get(lt.code);
    if (byCode) {
      matched.push({ localCode: lt.code, localName: lt.name_en, apiId: byCode.apiId, apiName: byCode.name });
      continue;
    }
    const byName = apiTeams.find((t) => teamNamesEqual(t.name, lt.name_en));
    if (byName) {
      matched.push({ localCode: lt.code, localName: lt.name_en, apiId: byName.apiId, apiName: byName.name });
      continue;
    }
    unmatched.push(lt);
  }

  console.log(`  Matched: ${matched.length}.`);
  if (unmatched.length > 0) {
    console.log(`  Unmatched (squads will not be fetched for these teams):`);
    for (const u of unmatched) {
      console.log(`    - ${u.code} ${u.name_en}`);
    }
  }
  console.log();

  // ── Step 3 & 4: fetch each squad and upsert ────────────────────────
  let totalUpserted = 0;
  let totalSeen = 0;
  for (const m of matched) {
    process.stdout.write(`  ${m.localCode.padEnd(4)} ${m.localName.padEnd(28)} → squad… `);
    try {
      const squadJson = await apiGet(`/players/squads?team=${m.apiId}`);
      const squad = (squadJson.response?.[0]?.players ?? []);
      totalSeen += squad.length;

      // Each row in squad: { id, name, age, number, position, photo }
      for (const p of squad) {
        if (!p.id || !p.name) continue;
        await sql`
          insert into public.players (
            api_football_id, team_code, name_en, position, jersey_number, photo_url
          ) values (
            ${p.id},
            ${m.localCode},
            ${p.name},
            ${p.position ?? null},
            ${p.number ?? null},
            ${p.photo ?? null}
          )
          on conflict (api_football_id) do update set
            team_code     = excluded.team_code,
            name_en       = excluded.name_en,
            position      = excluded.position,
            jersey_number = excluded.jersey_number,
            photo_url     = coalesce(excluded.photo_url, public.players.photo_url),
            updated_at    = now()
        `;
        totalUpserted += 1;
      }
      process.stdout.write(`${squad.length} players\n`);
    } catch (err) {
      process.stdout.write(`FAILED: ${err.message}\n`);
    }
    await sleep(SLEEP_MS);
  }

  console.log();
  console.log(`Done. Saw ${totalSeen} players across ${matched.length} teams; upserted ${totalUpserted} rows.`);
  console.log(`Translations (name_he) are NOT touched by this script.`);
  console.log(`Run the translation pipeline (PR-3) next to fill Hebrew names.`);
} finally {
  await sql.end();
}
