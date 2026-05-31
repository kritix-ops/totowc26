import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
try {
  console.log("=== ENG stars ===");
  const eng = await sql`
    select api_football_id, name_en, name_he, name_he_source, name_he_review_verdict
    from public.players where team_code='ENG' and api_football_id in (184,1460,2937,19586,158698,19974,19366,19545,67971,158694,136723)
    order by name_en
  `;
  for (const r of eng) console.log(`  ${String(r.api_football_id).padEnd(7)}  ${r.name_en.padEnd(20)}  ${r.name_he}  (${r.name_he_source}, ${r.name_he_review_verdict ?? "-"})`);

  console.log("\n=== Other stars (Ronaldo, Vitinha, Gavi, Pedri, Nico Williams) ===");
  const stars = await sql`
    select api_football_id, name_en, name_he, name_he_source, name_he_review_verdict
    from public.players where api_football_id in (874, 128384, 296667, 133609, 183799, 1323, 567, 636)
    order by name_en
  `;
  for (const r of stars) console.log(`  ${String(r.api_football_id).padEnd(7)}  ${r.name_en.padEnd(20)}  ${r.name_he}  (${r.name_he_source}, ${r.name_he_review_verdict ?? "-"})`);

  console.log("\n=== Review verdicts breakdown ===");
  const verdicts = await sql`
    select coalesce(name_he_review_verdict, 'pending') as verdict, count(*)::int as n
    from public.players
    group by name_he_review_verdict
    order by n desc
  `;
  for (const v of verdicts) console.log(`  ${v.verdict.padEnd(10)}  ${v.n}`);
} finally { await sql.end(); }
