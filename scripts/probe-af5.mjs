const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
const j = await get(`/players/profiles?search=watkins&page=1`);
console.log(`results=${j.results} total_pages=${j.paging?.total}`);
for (const row of j.response ?? []) {
  console.log(`  id=${String(row.player?.id).padEnd(7)} first=${(row.player?.firstname??"").padEnd(20)} last=${(row.player?.lastname??"").padEnd(20)} name=${row.player?.name}`);
}
