import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
try {
  await sql`update public.players set name_en = 'Lee Kangin', updated_at = now() where api_football_id = 927`;
  console.log("Updated 927 → Lee Kangin");
} finally { await sql.end(); }
