const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
async function pages(q, want, max=5) {
  let page=1; const hits=[];
  while (page<=max) {
    const j = await get(`/players/profiles?search=${q}&page=${page}`);
    for (const row of j.response ?? []) {
      const p = row.player; if (!p) continue;
      if (!want || want.test(`${p.firstname} ${p.lastname} ${p.nationality}`)) hits.push(p);
    }
    if (page>=(j.paging?.total??1)) break; page++;
    await new Promise(r=>setTimeout(r,250));
  }
  return hits;
}
console.log("=== Vitinha — search vitor + Portugal ===");
for (const p of await pages("vitor", /Portugal/)) console.log(`  id=${p.id} ${p.firstname} ${p.lastname} age=${p.age}`);
console.log("\n=== Gavi — Pablo Páez Gavira via 'paez' ===");
for (const p of await pages("paez", /Spain/)) console.log(`  id=${p.id} ${p.firstname} ${p.lastname} age=${p.age}`);
console.log("\n=== Pascal Gross — actual surname Groß; search groß ===");
for (const p of await pages("gro%C3%9F", /Germany/)) console.log(`  id=${p.id} ${p.firstname} ${p.lastname} age=${p.age}`);
console.log("\n=== Moise Bombito — search moise ===");
for (const p of await pages("moise", /Canada/)) console.log(`  id=${p.id} ${p.firstname} ${p.lastname} age=${p.age}`);
console.log("\n=== Cape Verde Josimar — search josimar ===");
for (const p of await pages("josimar", null, 3)) console.log(`  id=${p.id} ${p.firstname} ${p.lastname} nat=${p.nationality}`);
console.log("\n=== Cape Verde Ianique Tavares ===");
for (const p of await pages("ianique", null, 3)) console.log(`  id=${p.id} ${p.firstname} ${p.lastname} nat=${p.nationality}`);
console.log("\n=== Munir El Kajoui — search munir ===");
for (const p of await pages("munir", /Morocco/, 3)) console.log(`  id=${p.id} ${p.firstname} ${p.lastname} age=${p.age}`);
