#!/usr/bin/env node
import postgres from "postgres";

const url = process.env.DIRECT_URL;
const sql = postgres(url, { max: 1, prepare: false });

try {
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`;
  console.log("Tables in public:");
  tables.forEach((r) => console.log("  •", r.table_name));

  const rls = await sql`
    SELECT tablename, rowsecurity
    FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  console.log("\nRLS enabled:");
  rls.forEach((r) => console.log(`  • ${r.tablename}: ${r.rowsecurity}`));

  const settingsCount = await sql`SELECT count(*)::int as n FROM settings`;
  console.log("\nSettings rows:", settingsCount[0].n);

  const trig = await sql`
    SELECT trigger_name FROM information_schema.triggers
    WHERE event_object_schema='auth' AND event_object_table='users'`;
  console.log("\nAuth triggers:", trig.map((t) => t.trigger_name).join(", ") || "(none)");
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 3 });
}
