// One-off DB forensic probe. READ-ONLY. Connects via DIRECT_URL (session
// pooler, port 5432). Run: node --env-file=.env.local scripts/diag-db.mjs
import postgres from "postgres";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) { console.error("No DIRECT_URL / DATABASE_URL"); process.exit(1); }

const sql = postgres(url, {
  max: 1, prepare: false, idle_timeout: 5, connect_timeout: 12,
  connection: { statement_timeout: 9000 },
});

const out = (label, rows) => { console.log(`\n=== ${label} ===`); console.dir(rows, { depth: null }); };
const tryq = async (label, fn) => { try { out(label, await fn()); } catch (e) { console.log(`\n=== ${label} ===\n  (skipped: ${e?.message || e})`); } };

try {
  await tryq("identity + scale (is this the real pool?)", () => sql`
    select current_database() as db,
      (select count(*) from public.profiles) as profiles,
      (select count(*) from public.profiles where is_bot) as bots,
      (select count(*) from public.payments where status='approved') as approved_payments,
      (select count(*) from public.match_bets) as match_bets,
      (select count(*) from public.user_custom_bet_picks) as custom_picks
  `);

  await tryq("pg_stat_database (cumulative health)", () => sql`
    select numbackends, xact_commit, xact_rollback, deadlocks,
           conflicts, temp_files, temp_bytes,
           blk_read_time::bigint as blk_read_ms, blk_write_time::bigint as blk_write_ms,
           stats_reset
    from pg_stat_database where datname = current_database()
  `);

  await tryq("pg_cron jobs (scheduled DB jobs)", () => sql`
    select jobid, schedule, active, left(command, 120) as command, jobname
    from cron.job order by jobid
  `);

  await tryq("pg_cron recent runs (last 25, look for long/failed)", () => sql`
    select jobid, status,
           start_time, (end_time - start_time) as duration,
           left(coalesce(return_message,''), 80) as msg
    from cron.job_run_details
    order by start_time desc limit 25
  `);

  await tryq("slowest queries by TOTAL time (pg_stat_statements)", () => sql`
    select calls,
           total_exec_time::bigint as total_ms,
           mean_exec_time::numeric(10,1) as mean_ms,
           max_exec_time::numeric(10,1) as max_ms,
           rows,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 140) as query
    from pg_stat_statements
    order by total_exec_time desc limit 15
  `);

  await tryq("slowest queries by MEAN time (pg_stat_statements)", () => sql`
    select calls,
           mean_exec_time::numeric(10,1) as mean_ms,
           max_exec_time::numeric(10,1) as max_ms,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 140) as query
    from pg_stat_statements
    where calls > 1
    order by mean_exec_time desc limit 15
  `);

  await tryq("current activity (state + waits)", () => sql`
    select state, wait_event_type, wait_event, count(*) as n
    from pg_stat_activity
    where datname = current_database()
    group by 1,2,3 order by n desc
  `);

  console.log("\nDONE");
} catch (err) {
  console.error("\nDIAG ERROR:", err?.message || err);
} finally {
  await sql.end({ timeout: 5 });
  process.exit(0);
}
