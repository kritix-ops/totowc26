#!/usr/bin/env node
// One-time bootstrap: create (or update) the "monkey" bot player.
// Usage: pnpm db:bootstrap-monkey [email] [displayName]
// e.g.   pnpm db:bootstrap-monkey monkey@toto.local "הקוף"
//
// The monkey is a real Supabase auth user (profiles.id is a hard FK to
// auth.users) flagged profiles.is_bot = true, role 'player'. A cron
// (/api/cron/monkey) fills its picks; it never logs in, so the password is
// random and discarded. Idempotent: re-running just re-asserts the flag.
//
// profiles.id is a FK to auth.users, so we create the auth user first and let
// the on_auth_user_created trigger (or our upsert) materialise the profile.

import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const [, , emailArg, nameArg] = process.argv;

const email = (emailArg ?? process.env.MONKEY_EMAIL ?? "monkey@toto.local")
  .trim()
  .toLowerCase();
const displayName = (nameArg ?? "הקוף").trim();
// Random throwaway password — the monkey never signs in.
const password = `Monkey-${randomBytes(18).toString("base64url")}`;

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const dbUrl = process.env.DIRECT_URL;

if (!supaUrl || !serviceKey || !dbUrl) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY), and DIRECT_URL in .env.local",
  );
  process.exit(1);
}

const admin = createClient(supaUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const sql = postgres(dbUrl, { max: 1, prepare: false });

async function findUserByEmail(emailLc) {
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === emailLc);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

try {
  console.log(`Looking up ${email}...`);
  const existing = await findUserByEmail(email);

  let userId;
  if (existing) {
    console.log(`Found existing user ${existing.id}. Re-asserting metadata...`);
    const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        display_name: displayName,
      },
    });
    if (updErr) throw updErr;
    userId = existing.id;
  } else {
    console.log("Monkey not found, creating auth user...");
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error) throw error;
    userId = data.user?.id;
    if (!userId) throw new Error("createUser returned no id");
  }

  console.log("Ensuring profile row + is_bot flag...");
  await sql`
    insert into public.profiles (id, display_name, phone, role, is_bot)
    values (${userId}, ${displayName}, '', 'player', true)
    on conflict (id) do update set
      display_name = excluded.display_name,
      role = 'player',
      is_bot = true
  `;

  console.log("");
  console.log("✅ Monkey bootstrap complete.");
  console.log(`   User id:  ${userId}`);
  console.log(`   Email:    ${email}`);
  console.log(`   Name:     ${displayName}`);
  console.log("");
  console.log("The hourly GitHub Actions 'Monkey cron' will start filling its picks.");
  console.log("To fill immediately: Actions tab → 'Monkey cron' → 'Run workflow'.");
} catch (e) {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 3 });
}
