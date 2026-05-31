const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
// Brighton team id
const t = await get(`/teams?search=brighton`);
for (const r of (t.response??[]).slice(0,3)) console.log(`team ${r.team.id} ${r.team.name}`);
// Then dump squad
for (const tid of [51, 211, 41, 167]) {
  const j = await get(`/players/squads?team=${tid}`);
  const sq = j.response?.[0]?.players ?? [];
  console.log(`\n--- team ${tid} ${j.response?.[0]?.team?.name ?? "?"} ---`);
  for (const p of sq) {
    if (p.name?.match(/Groß|Gross/i)) console.log(`  id=${p.id} #${p.number} ${p.name} (${p.position})`);
  }
}
