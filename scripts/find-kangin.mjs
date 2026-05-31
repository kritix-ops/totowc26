import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
try {
  const rows = await sql`select api_football_id, name_en, name_he from public.players where team_code='KOR' and (name_en ilike '%kang%' or name_he ilike '%קנגין%')`;
  for (const r of rows) console.log(`  ${r.api_football_id}  ${r.name_en}  ${r.name_he}`);
} finally { await sql.end(); }
