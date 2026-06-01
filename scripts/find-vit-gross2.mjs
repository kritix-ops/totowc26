const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
async function dumpSquad(tid, label) {
  const j = await get(`/players/squads?team=${tid}`);
  const sq = j.response?.[0]?.players ?? [];
  console.log(`\n--- ${label} (${sq.length}) ---`);
  for (const p of sq) {
    if (p.name?.match(/(vit|gross|wirtz|pavlovic|sané)/i)) console.log(`  id=${p.id} #${p.number} ${p.name} (${p.position})`);
  }
}
await dumpSquad(85, "PSG");
await dumpSquad(165, "Dortmund");
await dumpSquad(157, "Bayern");
// Pascal Gross moved to Dortmund per memory; let me grep all of dortmund
const j = await get(`/players/squads?team=165`);
console.log("\n--- Full Dortmund ---");
for (const p of j.response?.[0]?.players??[]) console.log(`  id=${p.id} #${p.number} ${p.name}`);
