#!/usr/bin/env node
// Probe: hit API-Football /players/squads for a given team and dump the
// names it returns, to verify whether their "squad" is the final WC-26
// or a stale extended list.
//
// Usage:
//   node --env-file=.env.local scripts/probe-api-football-squad.mjs <api_team_id>
//   # e.g. England = 10 in API-Football
import postgres from "postgres";

const apiKey = process.env.API_FOOTBALL_KEY;
if (!apiKey) {
  console.error("API_FOOTBALL_KEY missing");
  process.exit(1);
}
const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL missing");
  process.exit(1);
}
const teamCode = (process.argv[2] ?? "ENG").toUpperCase();

const sql = postgres(url, { max: 1, prepare: false });

async function apiGet(path) {
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${(await res.text()).slice(0,300)}`);
  return res.json();
}

try {
  // 1. find the api-football team id by name.
  const localRow = (await sql`select code, name_en from public.teams where code = ${teamCode}`)[0];
  if (!localRow) {
    console.error(`Team ${teamCode} not in DB`);
    process.exit(1);
  }

  const teamsJson = await apiGet(`/teams?league=1&season=2026`);
  const apiTeams = (teamsJson.response ?? []).map((r) => ({ id: r.team.id, name: r.team.name }));
  const match = apiTeams.find(
    (t) => t.name.toLowerCase().replace(/[^a-z ]/g," ").replace(/\s+/g," ").trim()
      === localRow.name_en.toLowerCase().replace(/[^a-z ]/g," ").replace(/\s+/g," ").trim()
  );
  if (!match) {
    console.error(`Could not find ${localRow.name_en} in API teams`);
    console.error("Available:", apiTeams.map((t)=>t.name).slice(0,80).join(", "));
    process.exit(1);
  }
  console.log(`API-Football team: ${match.name} (id=${match.id})`);

  // 2. squads
  const squadJson = await apiGet(`/players/squads?team=${match.id}`);
  const squad = squadJson.response?.[0]?.players ?? [];
  console.log(`/players/squads returned ${squad.length} players:`);
  squad.sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  for (const p of squad) {
    console.log(
      `  ${(p.number != null ? `#${p.number}` : "  -").padEnd(4)} ${String(p.id).padEnd(7)} ${(p.position ?? "-").padEnd(11)} ${p.name}`
    );
  }
} finally {
  await sql.end();
}
