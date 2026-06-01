#!/usr/bin/env node
// Quick probe: report the current per-team squad sizes and surface
// specific players the user is asking about.
//
// Usage:
//   node --env-file=.env.local scripts/probe-squads.mjs
//   node --env-file=.env.local scripts/probe-squads.mjs ENG
import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL missing.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
const filterCode = process.argv[2]?.toUpperCase();

try {
  if (filterCode) {
    const rows = await sql`
      select p.api_football_id, p.name_en, p.name_he, p.position, p.jersey_number
      from public.players p
      where p.team_code = ${filterCode}
      order by p.jersey_number nulls last, p.name_en
    `;
    console.log(`Team ${filterCode}: ${rows.length} players`);
    for (const r of rows) {
      const jersey = r.jersey_number ? `#${String(r.jersey_number).padStart(2," ")}` : "  -";
      console.log(
        `  ${jersey}  ${String(r.api_football_id).padEnd(7)}  ${r.position?.padEnd(11) ?? "-          "}  ${r.name_en.padEnd(34)}  ${r.name_he ?? ""}`
      );
    }
  } else {
    const rows = await sql`
      select p.team_code, t.name_en as team_name, count(*)::int as n
      from public.players p
      join public.teams t on t.code = p.team_code
      group by p.team_code, t.name_en
      order by p.team_code
    `;
    const total = rows.reduce((a, r) => a + r.n, 0);
    console.log(`Per-team squad counts (total ${total}):`);
    for (const r of rows) {
      const flag = r.n < 22 ? "  ! UNDER 22" : r.n > 30 ? "  ! OVER 30" : "";
      console.log(`  ${r.team_code}  ${r.team_name.padEnd(28)}  ${String(r.n).padStart(3)}${flag}`);
    }
  }
} finally {
  await sql.end();
}
