#!/usr/bin/env node
// Smoke-test the DB connection. Reports clearly what fails.
import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL missing.");
  process.exit(1);
}

// Try to parse the URL to surface obvious formatting issues.
let parsed;
try {
  parsed = new URL(url);
} catch (e) {
  console.error("URL is malformed:", e.message);
  process.exit(1);
}

console.log("Attempting connection (parsed pieces):");
console.log("  user       :", parsed.username);
console.log("  user_decoded:", decodeURIComponent(parsed.username));
console.log("  host       :", parsed.hostname);
console.log("  port       :", parsed.port);
console.log("  db         :", parsed.pathname.slice(1));
console.log("  pw_raw_len :", parsed.password.length);
console.log("  pw_decoded_len:", decodeURIComponent(parsed.password).length);
console.log(
  "  pw_has_percent_encoding:",
  parsed.password !== decodeURIComponent(parsed.password),
);

// Connect via explicit options, decoding the password so postgres-js does not
// double-decode percent escapes.
const sql = postgres({
  host: parsed.hostname,
  port: Number(parsed.port),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.slice(1).split("?")[0],
  max: 1,
  prepare: false,
  idle_timeout: 5,
});

try {
  const rows = await sql`SELECT current_user as me, current_database() as db, now() as now`;
  console.log("CONNECTED:", rows[0]);
} catch (e) {
  console.error("FAILED:", e.code || "", e.message || e);
  if (e.code === "28P01") {
    console.error(
      "\n→ Postgres rejected the password. Either the password in .env.local is wrong, or the project on Supabase still has the previous password (a reset can take a few seconds to propagate; try waiting 30s and running this again).",
    );
  }
} finally {
  await sql.end({ timeout: 3 });
}
