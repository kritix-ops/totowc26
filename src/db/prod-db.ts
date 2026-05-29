import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { isSandbox } from "@/lib/env";

// A second Drizzle client pointing at PROD_DATABASE_URL. Only callable
// from the sandbox deployment - we never want production reading or
// writing to itself via this path. Two defenses:
//   1. isSandbox() must be true (driven by NEXT_PUBLIC_TOTO_ENV).
//   2. PROD_DATABASE_URL must be set; it lives only on the sandbox
//      Vercel project's env vars by deliberate ops policy.
// Used by the three /admin/sandbox actions to read / write the prod DB.

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;
let cachedClient: ReturnType<typeof postgres> | null = null;

export function prodDb() {
  if (!isSandbox()) {
    throw new Error(
      "prodDb() is only available in the sandbox environment (NEXT_PUBLIC_TOTO_ENV=sandbox).",
    );
  }
  const connectionString = process.env.PROD_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "PROD_DATABASE_URL is not set. Add the production Supabase pooler URL (port 6543) to the sandbox project's env vars.",
    );
  }
  if (cached) return cached;
  cachedClient = postgres(connectionString, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
  });
  cached = drizzle(cachedClient, { schema, casing: "snake_case" });
  return cached;
}

// Direct (port 5432) connection to prod. Used by refreshSandboxFromProd
// for bulk SELECTs where a fresh connection per call is preferable to
// keeping a pooled one warm. Caller is responsible for `.end()`.
export function prodDirectClient() {
  if (!isSandbox()) {
    throw new Error(
      "prodDirectClient() is only available in the sandbox environment.",
    );
  }
  const connectionString = process.env.PROD_DIRECT_URL;
  if (!connectionString) {
    throw new Error(
      "PROD_DIRECT_URL is not set. Add the production Supabase direct URL (port 5432) to the sandbox project's env vars.",
    );
  }
  return postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
  });
}
