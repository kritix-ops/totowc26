const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
const queries = [
  ["ronaldo", "Cristiano Ronaldo"],
  ["gavi", "Gavi"],
  ["williams", "Nico Williams"],
  ["bombito", "Moise Bombito"],
  ["dias", "Josimar Dias"],
  ["tavares", "Ianique Tavares"],
  ["ziko", "Mostafa Ziko"],
  ["gross", "Pascal Gross"],
  ["pavlovic", "Alexander Pavlovic"],
  ["kajoui", "Munir El Kajoui"],
  ["til", "Guus Til"],
  ["mjallby", "Elliot Mjallby"],
  ["hessen", "Sabri Ben Hessen"],
];
for (const [q, label] of queries) {
  const j = await get(`/players/profiles?search=${q}`);
  console.log(`\n--- ${label} (search=${q}) ---`);
  const list = (j.response ?? []).slice(0, 6);
  for (const row of list) {
    console.log(`  id=${String(row.player?.id).padEnd(7)}  ${row.player?.firstname ?? "-"}  ${row.player?.lastname ?? "-"}  nat=${row.player?.nationality ?? "-"}`);
  }
  await new Promise(r => setTimeout(r, 300));
}
