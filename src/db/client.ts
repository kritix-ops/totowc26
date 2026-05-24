import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

// Pooled connection for serverless. Disable prepare in pgbouncer transaction mode.
const queryClient = postgres(url, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
});

export const db = drizzle(queryClient, { schema });
export { schema };
