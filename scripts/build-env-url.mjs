#!/usr/bin/env node
// Builds correctly URL-encoded DATABASE_URL and DIRECT_URL strings ready to
// paste into .env.local. Prompts for the password so it never lands on disk.
import { createInterface } from "node:readline";

const PROJECT_REF = "wyceqbiatbcmnhhnjfpk";
const HOST = "aws-0-eu-west-1.pooler.supabase.com";

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a)));

console.log("Paste the EXACT database password (no quotes, no extra spaces):");
const pw = await ask("password: ");
rl.close();

// URL-encode every reserved character in the password.
const encodedPw = encodeURIComponent(pw.trim());

const pooled = `postgresql://postgres.${PROJECT_REF}:${encodedPw}@${HOST}:6543/postgres?pgbouncer=true`;
const direct = `postgresql://postgres.${PROJECT_REF}:${encodedPw}@${HOST}:5432/postgres`;

console.log("\nCopy these EXACTLY into .env.local (replace the existing lines):\n");
console.log("DATABASE_URL=" + pooled);
console.log("DIRECT_URL=" + direct);
console.log("\nThen run:  pnpm db:migrate");
