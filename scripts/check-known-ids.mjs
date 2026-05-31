const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
const ids = [874, 1485, 19318, 297811, 162856, 273, 2924, 6126, 41581, 19366];
for (const id of ids) {
  const j = await get(`/players/profiles?player=${id}`);
  const p = j.response?.[0]?.player;
  if (p) console.log(`  ${String(id).padEnd(7)}  ${p.firstname} ${p.lastname}  (nat=${p.nationality})`);
  else   console.log(`  ${String(id).padEnd(7)}  NOT FOUND`);
  await new Promise(r=>setTimeout(r,200));
}
