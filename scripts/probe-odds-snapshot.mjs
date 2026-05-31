#!/usr/bin/env node
// Dump current outright odds snapshot rows for review.
import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL missing");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });
const surfaceFilter = process.argv[2] ?? null;

try {
  const where = surfaceFilter
    ? sql`where surface = ${surfaceFilter}`
    : sql``;
  const rows = await sql`
    select surface, option_kind, option_id, display_name, decimal_odds::float as decimal_odds, admin_override, source
    from public.outright_odds_snapshot
    ${where}
    order by surface, decimal_odds asc
  `;
  let lastSurface = "";
  for (const r of rows) {
    if (r.surface !== lastSurface) {
      console.log(`\n--- ${r.surface} (${r.option_kind}, source=${r.source}) ---`);
      lastSurface = r.surface;
    }
    const odd = r.decimal_odds.toFixed(2).padStart(6);
    console.log(`  ${odd}  ${String(r.option_id).padEnd(7)}  ${r.display_name}${r.admin_override?" *override*":""}`);
  }
} finally {
  await sql.end();
}
