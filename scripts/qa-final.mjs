import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
try {
  console.log("=== Squad sanity (key teams after patch) ===");
  for (const code of ["ENG","BRA","ARG","FRA","ESP","GER","POR"]) {
    const rows = await sql`select count(*)::int as n from public.players where team_code=${code}`;
    console.log(`  ${code}  ${rows[0].n} players`);
  }
  console.log("\n=== Phil Foden / Cole Palmer in DB? ===");
  const fp = await sql`select api_football_id, team_code, name_en from public.players where api_football_id in (631, 152982, 2935)`;
  for (const r of fp) console.log(`  ${r.api_football_id}  ${r.team_code}  ${r.name_en}`);
  console.log(fp.length ? "" : "  (none — correctly removed)");

  console.log("\n=== Harry Kane / Saka / Rice / Eze in ENG DB? ===");
  const stars = await sql`
    select api_football_id, name_en from public.players
    where team_code='ENG' and api_football_id in (184, 1460, 2937, 19586, 158698, 19974, 19366, 19545)
    order by name_en
  `;
  for (const r of stars) console.log(`  ${r.api_football_id}  ${r.name_en}`);

  console.log("\n=== Top-scorer payout overrides count ===");
  const cb = await sql`
    select id, question_he, jsonb_object_keys(coalesce(answer_config -> 'payoutOverridesByValue', '{}'::jsonb)) as k
    from public.custom_bets
    where answer_config ->> 'dynamicSource' = 'players'
  `;
  const grouped = new Map();
  for (const r of cb) {
    const key = `${r.question_he}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  for (const [q, n] of grouped) console.log(`  ${q}  →  ${n} payout overrides`);
} finally { await sql.end(); }
