import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Add the Supabase Transaction pooler URL (port 6543) to .env.local",
  );
}

// Pooled connection for the app runtime. `prepare: false` is required when
// using Supabase's PgBouncer in transaction mode.
//
// `connect_timeout` + `statement_timeout` are load-bearing, not cosmetic:
// under a traffic burst the transaction pooler's backends saturate, and
// without these a query would queue (or a connect would block) FOREVER —
// the request hangs, the save never lands, and the button sits on "שומר…".
// With them, a stuck query is cancelled (freeing its backend for the next
// caller) and a stuck connect fails fast, so the system degrades into a
// retryable error instead of an app-wide freeze. App queries run in
// milliseconds, so 15s never trips legitimate traffic; the standalone cron
// /sync scripts open their own clients and are unaffected. See
// _plans/2026-06-10-db-pool-saturation-fix.md.
const client = postgres(connectionString, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  connection: { statement_timeout: 15000 },
});

export const db = drizzle(client, { schema, casing: "snake_case" });

export type DB = typeof db;
export * from "./schema";
