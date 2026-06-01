import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
try {
  const ids = [19586, 19366, 19545, 158694];
  const rows = await sql`
    select api_football_id, name_en, name_he, name_he_source, name_he_review_verdict, name_he_admin_locked
    from public.players where api_football_id = any(${ids})
    order by name_en
  `;
  for (const r of rows) {
    const lock = r.name_he_admin_locked ? "🔒" : "  ";
    console.log(`  ${lock} ${String(r.api_football_id).padEnd(7)}  ${r.name_en.padEnd(20)}  ${r.name_he.padEnd(22)}  source=${r.name_he_source}  verdict=${r.name_he_review_verdict}`);
  }
} finally { await sql.end(); }
