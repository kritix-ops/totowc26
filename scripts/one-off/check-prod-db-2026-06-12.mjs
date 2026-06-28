// One-off: prod outage diagnosis 2026-06-12 — test pooler connectivity + pool saturation.
import fs from "node:fs";
import postgres from "postgres";

const env = fs.readFileSync(".env.local", "utf8");
const get = (k) =>
  env
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${k}=`))
    ?.slice(k.length + 1)
    .trim();

const url = get("DATABASE_URL");
const sql = postgres(url, { connect_timeout: 10, max: 1, prepare: false });

const t0 = Date.now();
try {
  const ping = await sql`select 1 as ok, now() as ts`;
  console.log(`[db ping] OK in ${Date.now() - t0}ms`, ping[0]);

  const conns = await sql`
    select state, count(*)::int as n
    from pg_stat_activity
    where datname = current_database()
    group by state
    order by n desc`;
  console.log("[db conns]", conns);

  const limits = await sql`
    select current_setting('max_connections') as max_connections`;
  console.log("[db limits]", limits[0]);

  const longRunning = await sql`
    select pid, state, wait_event_type, wait_event,
           now() - query_start as runtime,
           now() - xact_start as xact_age,
           cardinality(pg_blocking_pids(pid)) as blockers,
           pg_blocking_pids(pid) as blocking_pids,
           left(query, 150) as query
    from pg_stat_activity
    where datname = current_database()
      and state <> 'idle'
      and query_start < now() - interval '30 seconds'
    order by query_start
    limit 10`;
  console.log("[db long-running]", JSON.stringify(longRunning, null, 1));

  const oldXact = await sql`
    select pid, state, wait_event_type, wait_event,
           now() - xact_start as xact_age,
           left(query, 150) as query
    from pg_stat_activity
    where datname = current_database()
      and xact_start < now() - interval '1 minute'
    order by xact_start
    limit 10`;
  console.log("[db old transactions]", JSON.stringify(oldXact, null, 1));
} catch (e) {
  console.log(`[db ping] FAIL in ${Date.now() - t0}ms:`, e.message);
} finally {
  await sql.end();
}
