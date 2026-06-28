// One-off: prod outage 2026-06-12 — kill stuck + idle backends so Supavisor
// re-logins with the new role-level transaction_timeout, then verify on a
// brand-new connection.
import fs from "node:fs";
import postgres from "postgres";

const env = fs.readFileSync(".env.local", "utf8");
const url = env
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice("DATABASE_URL=".length)
  .trim();

const a = postgres(url, { connect_timeout: 10, max: 1, prepare: false });

try {
  const killed = await a`
    select pid, state, pg_terminate_backend(pid) as killed
    from pg_stat_activity
    where datname = current_database()
      and usename = 'postgres'
      and pid <> pg_backend_pid()
      and (
        state = 'idle'
        or (state = 'active' and wait_event = 'ClientRead'
            and query_start < now() - interval '60 seconds')
      )`;
  console.log(`[recycle] killed ${killed.length} backends`);
} finally {
  await a.end();
}

// Brand-new client → brand-new pooled server connection (old ones just died).
const b = postgres(url, { connect_timeout: 10, max: 1, prepare: false });
try {
  const t = await b`show transaction_timeout`;
  console.log("[recycle] transaction_timeout on new conn:", t[0].transaction_timeout);
} finally {
  await b.end();
}
