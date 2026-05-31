const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
// Gavi = Pablo Martín Páez Gavira, plays for Barcelona, Spain national team
async function pages(q, max=10) {
  const hits=[]; let page=1;
  while (page<=max) {
    const j = await get(`/players/profiles?search=${q}&page=${page}`);
    for (const row of j.response ?? []) {
      const p = row.player; if (!p) continue;
      hits.push(p);
    }
    if (page>=(j.paging?.total??1)) break; page++;
    await new Promise(r=>setTimeout(r,250));
  }
  return hits;
}
// His full lastname: Páez Gavira. Spanish football naming uses family names.
// Try searching "pablo" with nat=Spain age=22
console.log("=== pablo nat=Spain age~22 ===");
for (const p of (await pages("pablo")).filter(p=>p.nationality==="Spain" && (p.age===22 || p.age===21 || p.age===null))) console.log(`  id=${p.id} ${p.firstname} ${p.lastname} age=${p.age}`);

console.log("\n=== gavira (more pages) ===");
const gavira = await pages("gavira");
console.log(`  ${gavira.length} total`);
for (const p of gavira) console.log(`  id=${p.id} ${p.firstname} ${p.lastname} nat=${p.nationality} age=${p.age}`);

console.log("\n=== páez (with accent) ===");
const paez = await pages("páez");
console.log(`  ${paez.length} total`);
for (const p of paez) console.log(`  id=${p.id} ${p.firstname} ${p.lastname} nat=${p.nationality} age=${p.age}`);

// Try direct id 297811 was wrong. What about 280605?
for (const id of [311526, 305658, 312632, 281577, 312631, 297764]) {
  const j = await get(`/players/profiles?player=${id}`);
  const p = j.response?.[0]?.player;
  if (p && p.nationality === "Spain") console.log(`  id=${id} ${p.firstname} ${p.lastname} age=${p.age}`);
  await new Promise(r=>setTimeout(r,200));
}
