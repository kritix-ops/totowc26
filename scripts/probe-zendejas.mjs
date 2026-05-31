const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
const j = await get(`/players/profiles?search=zendejas`);
console.log(`results=${j.results}`);
for (const row of j.response ?? []) {
  console.log(`  id=${row.player?.id} first=${row.player?.firstname} last=${row.player?.lastname}`);
}
