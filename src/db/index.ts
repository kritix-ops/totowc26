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
const client = postgres(connectionString, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
});

export const db = drizzle(client, { schema, casing: "snake_case" });

export type DB = typeof db;
export * from "./schema";
