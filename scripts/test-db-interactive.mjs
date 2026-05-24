#!/usr/bin/env node
// Prompts for the password interactively so we can rule out .env.local issues.
import postgres from "postgres";
import { createInterface } from "node:readline";

const PROJECT_REF = "wyceqbiatbcmnhhnjfpk";
const HOST = "aws-0-eu-west-1.pooler.supabase.com";
const PORT = 5432;

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a)));

console.log(`Connecting as: postgres.${PROJECT_REF}@${HOST}:${PORT}`);
console.log("Type the database password EXACTLY as it appears in Supabase, then Enter.");
console.log("(Tip: copy from Supabase using Reveal, paste with right-click)\n");
const pw = (await ask("password: ")).trim();
rl.close();

console.log(`\nReceived ${pw.length} characters. Attempting connection...`);

const sql = postgres({
  host: HOST,
  port: PORT,
  user: `postgres.${PROJECT_REF}`,
  password: pw,
  database: "postgres",
  max: 1,
  prepare: false,
  idle_timeout: 5,
});

try {
  const rows = await sql`SELECT current_user, now()`;
  console.log("\n✅ CONNECTED. Password is correct.");
  console.log(rows[0]);
  console.log("\nNow paste THIS password into .env.local for both DATABASE_URL and DIRECT_URL.");
  console.log("If it has special characters, URL-encode them or wrap the URL in double quotes.");
} catch (e) {
  console.error("\n❌ FAILED:", e.code || "", e.message || e);
  if (e.code === "28P01") {
    console.error(
      "\n→ Even with direct input the password is rejected. Reset it again in Supabase (Settings → Database → Reset database password), copy the new password to clipboard BEFORE closing the modal, then run this script and paste it directly.",
    );
  }
} finally {
  await sql.end({ timeout: 3 });
}
