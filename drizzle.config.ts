import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs as a standalone CLI and does not pick up .env.local on its
// own, so we load it explicitly here.
loadEnv({ path: ".env.local" });
loadEnv();

if (!process.env.DIRECT_URL) {
  throw new Error(
    "DIRECT_URL is not set. Add the Supabase direct connection (port 5432) to .env.local",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL,
  },
  verbose: true,
  strict: true,
});
