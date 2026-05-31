const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
// Squad endpoint gives the actual team roster.
async function dumpSquad(teamId, label) {
  const j = await get(`/players/squads?team=${teamId}`);
  const squad = j.response?.[0]?.players ?? [];
  console.log(`\n--- ${label} (${squad.length}) ---`);
  for (const p of squad) {
    console.log(`  id=${String(p.id).padEnd(7)}  #${String(p.number??"-").padEnd(2)}  ${p.name}  (${p.position})`);
  }
}
await dumpSquad(529,   "Barcelona (for Gavi/Pedri/Cubarsi)");
await dumpSquad(531,   "Athletic Bilbao (for Nico Williams)");
await dumpSquad(212,   "PSG (for Vitinha)");
await dumpSquad(157,   "Bayern Munich (for Pavlović/Gross/Stiller)");
await dumpSquad(167,   "Brighton (for Pascal Gross — if still there)");
