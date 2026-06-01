const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
const all = [];
for (let page=1; page<=10; page++) {
  const j = await get(`/players?team=10&season=2026&page=${page}`);
  for (const r of j.response ?? []) all.push(r.player);
  if (page >= (j.paging?.total ?? 1)) break;
  await new Promise(r=>setTimeout(r,200));
}
console.log(`total ${all.length} players, sorted by lastname`);
all.sort((a,b)=>(a.lastname||"").localeCompare(b.lastname||""));
for (const p of all) {
  console.log(`  id=${String(p.id).padEnd(7)}  ${[p.firstname,p.lastname].filter(Boolean).join(" ").padEnd(40)}  api_name=${p.name}`);
}
