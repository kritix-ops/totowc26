// One-off: prod outage 2026-06-12 — verify transaction_timeout is live on fresh
// pooled connections and no stuck backends remain.
import fs from "node:fs";
import postgres from "postgres";

const env = fs.readFileSync(".env.local", "utf8");
const url = env
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice("DATABASE_URL=".length)
  .trim();

const sql = postgres(url, { connect_timeout: 10, max: 1, prepare: false });

try {
  const t = await sql`show transaction_timeout`;
  console.log("[verify] transaction_timeout on fresh pooled conn:", t[0].transaction_timeout);

  const stuck = await sql`
    select pid, state, wait_event, now() - query_start as runtime
    from pg_stat_activity
    where datname = current_database()
      and state = 'active'
      and wait_event = 'ClientRead'
      and query_start < now() - interval '60 seconds'`;
  console.log("[verify] stuck backends:", stuck.length, JSON.stringify(stuck));

  const conns = await sql`
    select state, count(*)::int as n
    from pg_stat_activity
    where datname = current_database()
    group by state`;
  console.log("[verify] connections:", JSON.stringify(conns));
} finally {
  await sql.end();
}
