#!/usr/bin/env node
// Diagnostic-only: prints, for every match, whether api_football_fixture_id
// is set. Useful right after running api-football-map-fixtures.mjs to
// confirm the mapping landed.
//
// Usage:
//   pnpm api-football:check

import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL is not set in .env.local");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

try {
  const rows = await sql`
    select
      to_char((m.kickoff_at at time zone 'Asia/Jerusalem'), 'YYYY-MM-DD HH24:MI') as kickoff_ji,
      m.home_team || ' vs ' || m.away_team as match,
      m.api_football_fixture_id as fixture_id
    from public.matches m
    order by m.kickoff_at asc
  `;

  const mapped = rows.filter((r) => r.fixture_id !== null);
  const unmapped = rows.filter((r) => r.fixture_id === null);

  console.log(`Total matches: ${rows.length}`);
  console.log(`Mapped:        ${mapped.length}`);
  console.log(`Unmapped:      ${unmapped.length}`);
  console.log("");

  if (unmapped.length > 0) {
    console.log("Unmapped matches:");
    for (const r of unmapped) {
      console.log(`  ${r.kickoff_ji}  ${r.match}`);
    }
  } else {
    console.log("All matches mapped. Good to go.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
