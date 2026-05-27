#!/usr/bin/env node
// One-shot verification script that compares our local teams table
// against API-Football's team list for World Cup 2026. Helps catch
// every mismatched TLA / name BEFORE the World Cup zone page goes
// live, so the rest of the app doesn't render "TBD" rows or fall
// silently back to manual grading.
//
// Read-only - does NOT mutate the DB. Just prints a report.
//
// Usage:
//   node --env-file=.env.local scripts/api-football-verify-teams.mjs

import postgres from "postgres";

const url = process.env.DIRECT_URL;
const apiKey = process.env.API_FOOTBALL_KEY;
const SEASON = Number(process.env.API_FOOTBALL_SEASON ?? 2026);
const LEAGUE = 1; // FIFA World Cup (national teams). id 15 is the Club World Cup.

if (!url) {
  console.error(
    "DIRECT_URL is not set. Run with: node --env-file=.env.local scripts/api-football-verify-teams.mjs",
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

try {
  console.log(`Fetching API-Football teams for league=${LEAGUE}, season=${SEASON}…`);
  const res = await fetch(
    `https://v3.football.api-sports.io/teams?league=${LEAGUE}&season=${SEASON}`,
    {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "v3.football.api-sports.io",
      },
    },
  );
  if (!res.ok) {
    console.error(`API-Football returned ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const json = await res.json();
  const apiTeams = (json.response ?? []).map((row) => ({
    apiId: row.team.id,
    name: row.team.name,
    code: (row.team.code ?? "").toUpperCase() || null,
    country: row.team.country,
    logo: row.team.logo,
  }));
  console.log(`Received ${apiTeams.length} teams from API-Football.`);

  const localTeams = await sql`
    select code, name_he, name_en, flag, group_id
    from public.teams
    order by code asc
  `;
  console.log(`Local teams in DB: ${localTeams.length}.\n`);

  // Match by 3-letter code first, fall back to case-insensitive name match.
  const apiByCode = new Map(apiTeams.filter((t) => t.code).map((t) => [t.code, t]));
  const apiByLowerName = new Map(apiTeams.map((t) => [t.name.toLowerCase(), t]));

  const matched = [];
  const codeMismatches = []; // local has team, API has team, but the code differs
  const nameOnlyMatches = []; // matched by name, but their `code` field differs from ours
  const unmatched = []; // local team has no API counterpart at all

  for (const lt of localTeams) {
    const byCode = apiByCode.get(lt.code);
    if (byCode) {
      const apiNameLower = byCode.name.toLowerCase();
      const localNameLower = lt.name_en.toLowerCase();
      if (apiNameLower !== localNameLower) {
        codeMismatches.push({ local: lt, api: byCode });
      } else {
        matched.push({ local: lt, api: byCode });
      }
      continue;
    }
    const byName = apiByLowerName.get(lt.name_en.toLowerCase());
    if (byName) {
      nameOnlyMatches.push({ local: lt, api: byName });
      continue;
    }
    unmatched.push(lt);
  }

  // API teams that have no local row at all (might mean we're missing a team).
  const localCodes = new Set(localTeams.map((t) => t.code));
  const localNamesLower = new Set(localTeams.map((t) => t.name_en.toLowerCase()));
  const apiOnly = apiTeams.filter(
    (t) =>
      (!t.code || !localCodes.has(t.code)) &&
      !localNamesLower.has(t.name.toLowerCase()),
  );

  console.log("=== ✅ Clean matches (TLA + name_en agree) ===");
  console.log(`  ${matched.length} teams.`);

  if (codeMismatches.length > 0) {
    console.log("\n=== ⚠️  Code matches but name_en differs ===");
    for (const m of codeMismatches) {
      console.log(
        `  ${m.local.code}  local="${m.local.name_en}"  api="${m.api.name}"`,
      );
    }
    console.log(
      "  Suggestion: update teams.name_en to match the API, or keep ours and ignore the cosmetic diff.",
    );
  }

  if (nameOnlyMatches.length > 0) {
    console.log("\n=== ⚠️  Name matches but TLA differs ===");
    for (const m of nameOnlyMatches) {
      console.log(
        `  "${m.local.name_en}"  local code=${m.local.code}  api code=${m.api.code ?? "(null)"}`,
      );
    }
    console.log(
      "  Suggestion: keep our 3-letter codes; the API's `code` field is metadata only. The fixture map script falls back to name + date if codes don't line up.",
    );
  }

  if (unmatched.length > 0) {
    console.log("\n=== ❌ Local teams with NO API counterpart ===");
    for (const t of unmatched) {
      console.log(`  ${t.code}  ${t.name_en}  (group ${t.group_id ?? "?"})`);
    }
    console.log(
      "  These will fall back to manual grading for any auto_api_football bet that touches them.",
    );
  }

  if (apiOnly.length > 0) {
    console.log("\n=== ℹ️  API teams not in our DB ===");
    for (const t of apiOnly) {
      console.log(
        `  ${t.code ?? "(no code)"}  ${t.name}  (country=${t.country ?? "?"}, api_id=${t.apiId})`,
      );
    }
    console.log(
      "  Either we're missing a fixture-pulled team (run `pnpm api:fixtures`) or API-Football has an extra team for the tournament.",
    );
  }

  console.log("");
  console.log("Done.");
} finally {
  await sql.end({ timeout: 5 });
}
