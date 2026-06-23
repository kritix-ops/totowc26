// One-off: 2026-06-23 — what is actually slow / hot on prod right now.
// Reads pg_stat_statements (cumulative since last reset) to find the
// queries that dominate total time and the ones with the worst max time.
// Read-only. Run: node --env-file=.env.local scripts/one-off/diag-slow-queries-2026-06-23.mjs
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });

try {
  const reset = await sql`select stats_reset from pg_stat_statements_info`;
  console.log("[stats since]", reset[0]?.stats_reset);

  const byTotal = await sql`
    select calls,
           round(total_exec_time)::int   as total_ms,
           round(mean_exec_time)::int     as mean_ms,
           round(max_exec_time)::int      as max_ms,
           round(stddev_exec_time)::int   as stddev_ms,
           left(query, 90) as query
    from pg_stat_statements
    order by total_exec_time desc
    limit 15`;
  console.log("\n[top by TOTAL time]");
  for (const r of byTotal)
    console.log(
      `calls=${String(r.calls).padStart(7)} total=${String(r.total_ms).padStart(8)}ms mean=${String(r.mean_ms).padStart(6)}ms max=${String(r.max_ms).padStart(7)}ms  ${r.query.replace(/\s+/g, " ")}`,
    );

  const byMax = await sql`
    select calls,
           round(mean_exec_time)::int as mean_ms,
           round(max_exec_time)::int  as max_ms,
           left(query, 90) as query
    from pg_stat_statements
    where calls > 1
    order by max_exec_time desc
    limit 12`;
  console.log("\n[worst MAX time (calls>1)]");
  for (const r of byMax)
    console.log(
      `calls=${String(r.calls).padStart(7)} mean=${String(r.mean_ms).padStart(6)}ms max=${String(r.max_ms).padStart(7)}ms  ${r.query.replace(/\s+/g, " ")}`,
    );

  // deadlocks / rollbacks / temp spill on this DB
  const dbstats = await sql`
    select numbackends, xact_commit, xact_rollback, deadlocks,
           round(temp_bytes/1024.0/1024.0)::int as temp_mb, blks_read, blks_hit
    from pg_stat_database where datname = current_database()`;
  console.log("\n[db stats]", dbstats[0]);
} catch (e) {
  console.error("FAIL:", e.message);
} finally {
  await sql.end();
}
