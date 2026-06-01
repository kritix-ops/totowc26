import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
try {
  const total = (await sql`select count(*)::int as n from public.players`)[0].n;
  const missing = (await sql`select count(*)::int as n from public.players where name_he is null or name_he = ''`)[0].n;
  console.log(`Total players: ${total}, missing name_he: ${missing}`);
  console.log("\n=== Per team breakdown (missing only) ===");
  const perTeam = await sql`
    select team_code, count(*)::int as missing
    from public.players
    where name_he is null or name_he = ''
    group by team_code
    order by missing desc, team_code
  `;
  for (const r of perTeam) console.log(`  ${r.team_code}  ${String(r.missing).padStart(3)}`);
  console.log("\n=== Sample English squad missing name_he ===");
  const eng = await sql`
    select api_football_id, name_en from public.players
    where team_code='ENG' and (name_he is null or name_he='')
    order by name_en
  `;
  for (const r of eng) console.log(`  ${r.api_football_id}  ${r.name_en}`);
} finally { await sql.end(); }
