import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
try {
  for (const code of ["BRA","POR","ESP"]) {
    const r = await sql`select api_football_id, name_en from public.players where team_code = ${code} order by name_en`;
    console.log(`\n--- ${code} (${r.length}) ---`);
    for (const p of r) console.log(`  ${String(p.api_football_id).padEnd(7)} ${p.name_en}`);
  }
} finally { await sql.end(); }
