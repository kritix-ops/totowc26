import postgres from "postgres";
const sql = postgres(process.env.DIRECT_URL, { max: 1, prepare: false });
try {
  const rows = await sql`
    select surface, option_id, display_name, decimal_odds, fetched_at
    from public.outright_odds_snapshot
    where option_id in (631, 152982)
    order by surface, option_id
  `;
  for (const r of rows) {
    console.log(`  ${r.surface}  id=${r.option_id}  ${r.display_name}  odds=${r.decimal_odds}  fetched=${r.fetched_at.toISOString()}`);
  }
  console.log(rows.length === 0 ? "(none)" : "");
} finally { await sql.end(); }
