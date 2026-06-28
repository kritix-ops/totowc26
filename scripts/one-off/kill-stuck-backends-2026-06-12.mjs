// One-off: prod outage 2026-06-12 — terminate backends stuck in ClientRead with an
// open transaction (leaked by killed Vercel functions; they pin pooler slots).
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
  const stuck = await sql`
    select pid, state, wait_event, now() - query_start as runtime, left(query, 80) as query
    from pg_stat_activity
    where datname = current_database()
      and state = 'active'
      and wait_event = 'ClientRead'
      and query_start < now() - interval '90 seconds'`;
  console.log("[kill stuck] candidates:", JSON.stringify(stuck, null, 1));

  for (const row of stuck) {
    const r = await sql`select pg_terminate_backend(${row.pid}) as killed`;
    console.log(`[kill stuck] pid ${row.pid} -> killed=${r[0].killed}`);
  }

  const after = await sql`
    select state, count(*)::int as n
    from pg_stat_activity
    where datname = current_database()
    group by state`;
  console.log("[kill stuck] connections after:", JSON.stringify(after));
} finally {
  await sql.end();
}
