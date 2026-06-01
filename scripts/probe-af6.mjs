const apiKey = process.env.API_FOOTBALL_KEY;
function norm(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[‘’']/g, "").replace(/[^a-z0-9 -]+/g, " ").replace(/\s+/g, " ").trim();
}
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
const j = await get(`/players/profiles?search=watkins&page=1`);
const officialName = "Ollie Watkins";
const fam = "watkins";
const officialFirst = "ollie";

for (const row of j.response ?? []) {
  const p = row.player;
  const firstTokens = norm(p.firstname ?? "").split(" ").filter((t) => t.length >= 2);
  const lastTokens  = norm(p.lastname  ?? "").split(" ").filter((t) => t.length >= 2);
  const lastnameMatch = lastTokens.some((t) => t.includes(fam) || fam.includes(t));
  const apiFirst = firstTokens[0] ?? "";
  const firstnameMatch =
    firstTokens.includes(officialFirst) ||
    apiFirst.startsWith(officialFirst) ||
    officialFirst.startsWith(apiFirst) ||
    (apiFirst.length >= 3 && officialFirst.length >= 3 && apiFirst.slice(0,3) === officialFirst.slice(0,3));
  console.log(`  id=${String(p.id).padEnd(7)} first=${(p.firstname??"").padEnd(22)} last=${(p.lastname??"").padEnd(15)} lastMatch=${lastnameMatch} firstMatch=${firstnameMatch}`);
}
