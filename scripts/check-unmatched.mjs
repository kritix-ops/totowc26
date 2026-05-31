import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
try {
  const names = ["Richarlison","Neymar","Dani Olmo","Casemiro","Lee Kangin","Pedri","Kaoru Mitoma"];
  for (const name of names) {
    const rows = await sql`select api_football_id, team_code, name_en from public.players where name_en ilike ${"%" + name + "%"} or name_en ilike ${"%" + name.split(" ").slice(-1)[0] + "%"} limit 5`;
    console.log(`\n${name}:`);
    for (const r of rows) console.log(`  ${r.api_football_id} ${r.team_code} ${r.name_en}`);
  }
} finally { await sql.end(); }
