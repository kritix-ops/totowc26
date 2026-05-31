const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
const j = await get(`/players/profiles?player=133185`);
console.log(JSON.stringify(j.response, null, 2).slice(0, 800));
