// One-time bootstrap for the QA agent. Creates qa-bot@kritix.io in
// the SANDBOX Supabase project and inserts a pending signup_requests
// row so the admin can approve it in /he/admin/users?tab=requests.
//
// Why both? The admin-approval action (src/app/[lang]/admin/
// signup-requests/actions.ts) adopts an existing auth user with the
// same email instead of failing - so pre-creating with our chosen
// password means the bot can log in the moment the admin clicks
// approve. If we only inserted the signup_request, approval would
// create the user with a recovery link and the bot would not know
// any password.
//
// Re-running is safe: existing auth users get their password +
// metadata refreshed, existing pending requests are left alone.

import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import {
  readSeedEnv,
  QA_BOT_DISPLAY_NAME,
} from "./config.mts";

const env = readSeedEnv();

const admin = createClient(env.sandboxSupabaseUrl, env.sandboxServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const sql = postgres(env.sandboxDirectUrl, { max: 1, prepare: false });

const PHONE = "000-0000000"; // Placeholder. The bot does not use it.

async function findUserByEmail(emailLc: string) {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === emailLc);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

try {
  const emailLc = env.qaBotEmail.toLowerCase();
  console.info("[qa.seed.boot]", {
    supabase: env.sandboxSupabaseUrl,
    email: emailLc,
  });

  console.info("[qa.seed.auth] looking up existing user");
  const existing = await findUserByEmail(emailLc);

  let userId: string;
  if (existing) {
    console.info("[qa.seed.auth] found existing user, refreshing password", {
      userId: existing.id,
    });
    const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
      password: env.qaBotPassword,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        display_name: QA_BOT_DISPLAY_NAME,
        phone: PHONE,
      },
    });
    if (updErr) throw updErr;
    userId = existing.id;
  } else {
    console.info("[qa.seed.auth] creating auth user");
    const { data, error } = await admin.auth.admin.createUser({
      email: emailLc,
      password: env.qaBotPassword,
      email_confirm: true,
      user_metadata: {
        display_name: QA_BOT_DISPLAY_NAME,
        phone: PHONE,
      },
    });
    if (error) throw error;
    const newId = data.user?.id;
    if (!newId) throw new Error("createUser returned no id");
    userId = newId;
  }

  console.info("[qa.seed.request] checking for existing pending row");
  const pending = await sql<
    { id: string }[]
  >`select id from signup_requests where lower(email) = ${emailLc} and status = 'pending' limit 1`;

  if (pending.length > 0) {
    console.info("[qa.seed.request] pending row already exists, skipping insert", {
      requestId: pending[0].id,
    });
  } else {
    const inserted = await sql<{ id: string }[]>`
      insert into signup_requests (display_name, phone, email, status, note)
      values (${QA_BOT_DISPLAY_NAME}, ${PHONE}, ${emailLc}, 'pending',
              'QA agent bot - seeded by scripts/qa-agent/seed-user.mts')
      returning id
    `;
    console.info("[qa.seed.request] inserted pending row", {
      requestId: inserted[0]?.id,
    });
  }

  console.info("");
  console.info(`✅ QA bot seeded. authUserId=${userId}`);
  console.info("");
  console.info("Next steps:");
  console.info(`   1. Open your sandbox URL → /he/admin/signup-requests`);
  console.info(`   2. Approve "${QA_BOT_DISPLAY_NAME}" (${emailLc})`);
  console.info(`   3. Mark the user as paid in /he/admin/users`);
  console.info(`   4. Run: pnpm qa-agent <scenario>`);
  console.info("");
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[qa.seed.fatal]", msg);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 3 });
}
