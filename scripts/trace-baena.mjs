import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
function norm(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[‘’']/g, "").replace(/[^a-z0-9 -]+/g, " ").replace(/\s+/g, " ").trim();
}
try {
  const rows = await sql`select api_football_id, name_en from public.players where team_code='ESP' and name_en ilike '%baena%'`;
  const off = "Álex Baena";
  const officialNorm = norm(off);
  const officialTokens = officialNorm.split(" ").filter(t=>t.length>=2);
  const officialFirst = officialTokens[0];
  console.log(`official='${off}'  norm='${officialNorm}'  first='${officialFirst}'`);
  for (const r of rows) {
    const dbNorm = norm(r.name_en);
    const dbTokens = dbNorm.split(" ").filter(t=>t.length>=2);
    console.log(`db: id=${r.api_football_id} '${r.name_en}'  norm='${dbNorm}'  tokens=${JSON.stringify(dbTokens)}`);
    console.log(`  first('alejandro').startsWith('alex') = ${"alejandro".startsWith("alex")}`);
  }
} finally { await sql.end(); }
