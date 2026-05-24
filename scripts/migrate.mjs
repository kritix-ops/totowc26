#!/usr/bin/env node
// Apply Drizzle migrations using the direct (non-pooled) connection.
// Reads .env.local through Node's --env-file flag (see package.json script).

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error(
    "DIRECT_URL is not set. Run with: node --env-file=.env.local scripts/migrate.mjs",
  );
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);

console.log("Applying migrations from src/db/migrations...");
try {
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migrations applied successfully.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
