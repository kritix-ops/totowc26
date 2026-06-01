#!/usr/bin/env node
// Probe API-Football /players search behaviour for known-missing names.
const apiKey = process.env.API_FOOTBALL_KEY;
if (!apiKey) { console.error("API_FOOTBALL_KEY missing"); process.exit(1); }

async function apiGet(path) {
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, body: (await res.text()).slice(0, 300) };
  }
  return { ok: true, json: await res.json() };
}

const queries = [
  ["team=10&season=2026&search=eze",    "Eze, team-season"],
  ["team=10&season=2026&search=toney",  "Toney, team-season"],
  ["team=10&season=2026&search=saka",   "Saka, team-season"],
  ["team=10&search=eze",                "Eze, team only"],
  ["search=eberechi",                   "Eberechi global"],
  ["search=saka",                       "Saka global"],
  ["search=toney",                      "Toney global"],
  ["search=watkins",                    "Watkins global"],
  ["season=2026&search=saka",           "Saka, season only"],
];

for (const [q, label] of queries) {
  const res = await apiGet(`/players?${q}`);
  if (!res.ok) {
    console.log(`${label.padEnd(35)} HTTP ${res.status}`);
    continue;
  }
  const n = res.json.results ?? res.json.response?.length ?? 0;
  console.log(`${label.padEnd(35)} results=${n}  paging=${JSON.stringify(res.json.paging)}`);
  for (const row of (res.json.response ?? []).slice(0, 5)) {
    const p = row.player;
    const teams = (row.statistics ?? []).map((s) => s.team?.name).filter(Boolean).join(", ");
    console.log(`    id=${p.id}  ${[p.firstname, p.lastname].filter(Boolean).join(" ")}  age=${p.age}  teams=${teams.slice(0,80)}`);
  }
  await new Promise((r) => setTimeout(r, 250));
}
