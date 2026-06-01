const apiKey = process.env.API_FOOTBALL_KEY;
async function get(p) {
  const r = await fetch(`https://v3.football.api-sports.io${p}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" },
  });
  return r.json();
}
// Search strategies for the unresolved stars.
async function searchLast(lastname, wantNat) {
  let page = 1;
  while (page <= 5) {
    const j = await get(`/players/profiles?search=${lastname}&page=${page}`);
    for (const row of j.response ?? []) {
      const p = row.player;
      if (!p) continue;
      if (wantNat && p.nationality !== wantNat) continue;
      console.log(`  page${page} id=${String(p.id).padEnd(7)}  ${p.firstname} ${p.lastname}  nat=${p.nationality} age=${p.age}`);
    }
    if (page >= (j.paging?.total ?? 1)) break;
    page += 1;
    await new Promise(r=>setTimeout(r,300));
  }
}
console.log("Vitinha (POR, last=Ferreira) — too generic, try gavira/machado");
console.log("\n=== gavira (Gavi=Pablo Páez Gavira) ===");
await searchLast("gavira", "Spain");
console.log("\n=== williams nat=Spain ===");
await searchLast("williams", "Spain");
console.log("\n=== bombito ===");
await searchLast("bombito", null);
console.log("\n=== el kajoui ===");
await searchLast("kajoui", null);
console.log("\n=== el-kajoui (alt) ===");
await searchLast("el-kajoui", null);
console.log("\n=== nico williams via firstname not lastname — try el-kajoui spelling ===");
console.log("\n=== Munir ===");
await searchLast("munir", "Morocco");
console.log("\n=== Pavlovic nat=Germany ===");
await searchLast("pavlovic", "Germany");
console.log("\n=== Pavlović (raw with č) ===");
await searchLast("pavlović", "Germany");
console.log("\n=== Til nat=Netherlands ===");
await searchLast("til", "Netherlands");
console.log("\n=== Gross nat=Germany ===");
await searchLast("gross", "Germany");
console.log("\n=== Hessen nat=Tunisia ===");
await searchLast("hessen", "Tunisia");
console.log("\n=== ben-hessen ===");
await searchLast("ben-hessen", "Tunisia");
console.log("\n=== Mjallby nat=Sweden ===");
await searchLast("mjällby", "Sweden");
await searchLast("mjallby", "Sweden");
console.log("\n=== Ziko nat=Egypt ===");
await searchLast("ziko", "Egypt");
