// One-off: prod outage 2026-06-12 — check PG version + which session timeouts exist.
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
  const v = await sql`select version()`;
  console.log("[pg version]", v[0].version);

  const guc = await sql`
    select name, setting, source
    from pg_settings
    where name in (
      'statement_timeout',
      'idle_in_transaction_session_timeout',
      'idle_session_timeout',
      'transaction_timeout',
      'client_connection_check_interval'
    )
    order by name`;
  console.log("[pg timeouts]", JSON.stringify(guc, null, 1));

  const dbLevel = await sql`
    select coalesce(setconfig, '{}') as setconfig
    from pg_db_role_setting s
    join pg_database d on d.oid = s.setdatabase
    where d.datname = current_database()`;
  console.log("[db-level overrides]", JSON.stringify(dbLevel));
} finally {
  await sql.end();
}
