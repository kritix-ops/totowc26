#!/usr/bin/env node
// Removes any match rows that were inserted from the seed script (no
// api_fixture_id) so the DB holds only real fixtures from football-data.org.
// Bets attached to those mock matches are deleted via FK cascade.
// Usage: pnpm db:clean-mock

import postgres from "postgres";

const dbUrl = process.env.DIRECT_URL;
if (!dbUrl) {
  console.error("DIRECT_URL is not set.");
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 1, prepare: false });

try {
  const rows = await sql`
    delete from public.matches
    where api_fixture_id is null
    returning id
  `;
  console.log(`Removed ${rows.length} seeded mock matches.`);
} catch (e) {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 3 });
}
