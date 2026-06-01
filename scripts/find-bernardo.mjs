const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
// Manchester City squad
const t = await get(`/teams?search=manchester city`);
console.log("Manchester City teams:");
for (const r of (t.response??[]).slice(0,3)) console.log(`  ${r.team.id} ${r.team.name}`);

// Try team 50 (Man City)
const sq = await get(`/players/squads?team=50`);
const players = sq.response?.[0]?.players ?? [];
console.log(`\nMan City squad (${players.length}):`);
for (const p of players) {
  if (p.name?.match(/Silva|Diogo Costa|Dias/i)) {
    console.log(`  id=${p.id} #${p.number} ${p.name} (${p.position})`);
  }
}
// Diogo Costa direct - he's at FC Porto
const fcPorto = await get(`/teams?search=porto`);
for (const r of (fcPorto.response??[]).slice(0,3)) console.log(`  FC: ${r.team.id} ${r.team.name}`);
const psq = await get(`/players/squads?team=212`);
console.log("\nFC Porto squad (212):");
for (const p of psq.response?.[0]?.players ?? []) {
  if (p.name?.match(/Costa|Diogo/i)) console.log(`  id=${p.id} #${p.number} ${p.name} (${p.position})`);
}
