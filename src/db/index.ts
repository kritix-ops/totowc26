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
  // Per-instance pool size. The dashboard (/[lang]) fans out ~20 queries
  // concurrently across its Suspense sections plus the SmartHub
  // generators, and on a cold Data Cache they all hit the DB at once.
  // postgres-js has NO pool-acquisition timeout (verified against the
  // installed v3.4.9 README: max / idle_timeout / connect_timeout /
  // max_lifetime exist, no acquire-queue timeout). So if a render needs
  // more connections than `max` provides, the surplus queries wait with no
  // bound and the function is killed at the Vercel ceiling — the recurring
  // "loading forever" fall. `max: 3` proved this on 2026-06-17 and took the
  // homepage down (_plans/2026-06-17-performance-root-cause-and-fix.md).
  // 10 held but left zero headroom: a single render's ~20-query fan-out
  // still queued against itself the moment two sections raced. Raised to 20
  // so one full render fits without self-queuing
  // (_plans/2026-06-23-prod-falls-reliability-fix.md, T2.1). The shared
  // Supavisor pooler caps total CLIENT connections at 400 — with ~30 users
  // and a handful of warm Fluid instances, 20 per instance stays far under
  // that, so this never oversubscribes the pooler. Co-location keeps each
  // query ~1-2ms, so the pool drains the burst fast. The per-section
  // withTimeout fallbacks (T2.2) bound the residual wait when several
  // renders share one instance, so even then nothing reaches maxDuration.
  max: 20,
  idle_timeout: 20,
  ...(isBuildPhase
    ? {}
    : { connect_timeout: 10, connection: { statement_timeout: 15000 } }),
});

export const db = drizzle(client, { schema, casing: "snake_case" });

export type DB = typeof db;
export * from "./schema";
