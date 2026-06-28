// One-off: prod outage 2026-06-12 — enable role-level transaction_timeout (PG17)
// so backends leaked by killed Vercel functions (active/ClientRead, open xact)
// self-terminate instead of pinning Supavisor pool slots forever.
//
// 120s matches the server's statement_timeout, so no legit app work is affected.
// Caveat (documented in the incident plan): a future manual migration whose single
// transaction exceeds 120s must run `SET transaction_timeout = 0` first.
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
  await sql.unsafe(`alter role postgres set transaction_timeout = '120s'`);
  console.log("[txn timeout] role-level transaction_timeout set to 120s");

  const check = await sql`
    select r.rolname, s.setconfig
    from pg_db_role_setting s
    join pg_roles r on r.oid = s.setrole
    where r.rolname = 'postgres'`;
  console.log("[txn timeout] verify:", JSON.stringify(check));

  // Recycle idle pooled backends so new server connections pick up the
  // setting now instead of after server_lifetime (1h). Active ones are
  // serving traffic — leave them; they recycle on their own.
  const recycled = await sql`
    select pid, pg_terminate_backend(pid) as killed
    from pg_stat_activity
    where datname = current_database()
      and usename = 'postgres'
      and state = 'idle'
      and pid <> pg_backend_pid()`;
  console.log(`[txn timeout] recycled ${recycled.length} idle backends`);
} finally {
  await sql.end();
}
