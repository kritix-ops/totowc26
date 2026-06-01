const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : await r.text() };
}
// Try several seasons + the page-based listing (which we know works in sync-squads).
const res1 = await get("/players?team=10&season=2025&page=1");
console.log("ENG team-2025 p1:", res1.ok ? `results=${res1.json.results}` : res1.json);
const res2 = await get("/players?team=10&season=2026&page=1");
console.log("ENG team-2026 p1:", res2.ok ? `results=${res2.json.results}` : res2.json);
const res3 = await get("/players?id=2937&season=2026");
console.log("Rice by id, season 2026:", res3.ok ? `results=${res3.json.results}` : res3.json);
const res4 = await get("/players?id=2937");
console.log("Rice by id, no season:", res4.ok ? `results=${res4.json.results}` : res4.json);
const res5 = await get("/status");
console.log("status:", res5.ok ? JSON.stringify(res5.json.response?.subscription) : res5.json);
