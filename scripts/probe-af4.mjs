const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : await r.text() };
}
const tries = [
  "/players/profiles?search=saka",
  "/players/profiles?search=toney",
  "/players/profiles?search=watkins",
  "/players/profiles?lastname=saka",
];
for (const p of tries) {
  const r = await get(p);
  console.log(p);
  if (!r.ok) { console.log("  ERR", r.status, String(r.json).slice(0,200)); continue; }
  const res = r.json.response ?? [];
  console.log(`  results=${r.json.results} paging=${JSON.stringify(r.json.paging)}`);
  for (const row of res.slice(0,8)) {
    console.log(`  id=${row.player?.id} ${[row.player?.firstname,row.player?.lastname].filter(Boolean).join(" ")}`);
  }
  await new Promise(x=>setTimeout(x,300));
}
