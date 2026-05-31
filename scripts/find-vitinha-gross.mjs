const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
// PSG real id; try a few
for (const tid of [85, 583, 591]) {
  const j = await get(`/teams?id=${tid}`);
  console.log(`teamId=${tid}: ${j.response?.[0]?.team?.name}`);
}
// Find PSG
const t = await get(`/teams?search=paris saint-germain`);
for (const r of (t.response??[]).slice(0,5)) console.log(`  ${r.team.id} ${r.team.name}`);
// Find Dortmund
const t2 = await get(`/teams?search=borussia dortmund`);
for (const r of (t2.response??[]).slice(0,5)) console.log(`  ${r.team.id} ${r.team.name}`);
