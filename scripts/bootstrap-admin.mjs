#!/usr/bin/env node
// One-time bootstrap: create or update an admin user with a password.
// Usage: pnpm db:bootstrap-admin <email> <password> [display_name] [phone]
// e.g.   pnpm db:bootstrap-admin yoavm7@gmail.com Hunter2! "יואב" "050-1234567"

import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const [, , emailArg, passwordArg, nameArg, phoneArg] = process.argv;

if (!emailArg || !passwordArg) {
  console.error("Usage: pnpm db:bootstrap-admin <email> <password> [name] [phone]");
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const password = passwordArg;
const displayName = (nameArg ?? email.split("@")[0]).trim();
const phone = (phoneArg ?? "").trim();

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
  // Supabase admin SDK has listUsers; we paginate until we find ours.
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
    console.log(`Found existing user ${existing.id}. Updating password and metadata...`);
    const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        display_name: displayName,
        ...(phone ? { phone } : {}),
      },
    });
    if (updErr) throw updErr;
    userId = existing.id;
  } else {
    console.log("User not found, creating...");
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        ...(phone ? { phone } : {}),
      },
    });
    if (error) throw error;
    userId = data.user?.id;
    if (!userId) throw new Error("createUser returned no id");
  }

  console.log("Ensuring profile row and admin role...");
  await sql`
    insert into public.profiles (id, display_name, phone, role)
    values (${userId}, ${displayName}, ${phone}, 'admin')
    on conflict (id) do update set
      display_name = excluded.display_name,
      phone = case when excluded.phone <> '' then excluded.phone else profiles.phone end,
      role = 'admin'
  `;

  console.log("");
  console.log("✅ Bootstrap complete.");
  console.log(`   Email:    ${email}`);
  console.log(`   Password: ${password.replace(/./g, "•")} (use what you typed)`);
  console.log(`   Role:     admin`);
  console.log("");
  console.log("Sign in at http://localhost:3001/he/login");
} catch (e) {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 3 });
}
