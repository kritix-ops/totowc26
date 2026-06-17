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
// connect_timeout + statement_timeout are a RUNTIME guard, not cosmetic.
// Under a traffic burst the transaction pooler's backends saturate; without
// these a query would block and the request would hang forever (the save
// never lands and the button sits on "שומר..."). With them a stuck query is
// cancelled, freeing its backend, and a stuck connect fails fast, so the app
// degrades into a retryable error instead of an app-wide freeze. App queries
// run in milliseconds, so 15s never trips legitimate runtime traffic.
//
// They are deliberately NOT applied during `next build`. Prerendering runs
// real DB queries, and when the database is under load those queries are slow
// but valid; a build-time cancel turns a slow build into a FAILED deploy. On
// 2026-06-10 statement_timeout aborted the prod build while prerendering
// /he/bets/groups. NEXT_PHASE is "phase-production-build" only during the
// build, so we gate on it. The standalone cron / sync scripts open their own
// clients and are unaffected either way. See
// _plans/2026-06-10-db-pool-saturation-fix.md.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

const client = postgres(connectionString, {
  prepare: false,
  // Small per-instance pool. On Vercel each warm function instance keeps
  // its own pool, so many instances times a large `max` can oversubscribe
  // the shared Supavisor pooler (max client conns 400 on Small compute).
  // With Vercel and Supabase co-located in eu-west-1 (vercel.json region
  // dub1) every query is ~1-2ms, so a handful of connections per instance
  // is ample and leaves the pooler headroom under burst.
  max: 3,
  idle_timeout: 20,
  ...(isBuildPhase
    ? {}
    : { connect_timeout: 10, connection: { statement_timeout: 15000 } }),
});

export const db = drizzle(client, { schema, casing: "snake_case" });

export type DB = typeof db;
export * from "./schema";
