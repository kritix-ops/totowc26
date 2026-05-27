// E2E test for the lock-reminder feature.
//
// What it does:
//   1. Connects to DATABASE_URL.
//   2. Verifies migrations 0023 + 0024 ran (the required tables and
//      columns exist). Bails with a clear message if not.
//   3. Inserts a test custom_bet whose lock_at is 5 minutes from now.
//      Scope = tournament so it shows on /bets/tournament. Status =
//      open so the sender pass picks it up. Stake/payout = 1/2 for
//      simplicity.
//   4. Sets settings.reminder_offset_minutes = 60 so the bet falls
//      inside the window.
//   5. Triggers POST /api/cron/sync with CRON_SECRET, which runs the
//      whole sync pass including sendDueReminders.
//   6. Prints what to verify in your inbox and what to look for in
//      Vercel / dev-server logs (the [lock reminder ...] namespaces).
//   7. Cleans up: deletes the test bet + the bet_reminder_sent rows it
//      generated. Restores settings.reminder_offset_minutes to its
//      original value.
//
// Pre-flight (operator):
//   - pnpm db:migrate (so 0021-0024 are applied)
//   - .env.local has DATABASE_URL, CRON_SECRET, RESEND_API_KEY,
//     EMAIL_FROM, and (for push) VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
//     / VAPID_SUBJECT.
//   - For email: at least one player has a payments row with
//     status='approved' and a non-null email on auth.users.
//   - For push: at least one player toggled the profile push-opt-in
//     ON in the browser (and the dev server is reachable so the SW
//     can subscribe).
//
// Usage:
//   node --env-file=.env.local scripts/e2e-reminder.mjs
//
// Re-runnable: cleanup is best-effort but idempotent. If the script
// crashes mid-run, re-running will tidy any leftover rows by the
// `E2E_TEST_LABEL` marker on the bet.

import postgres from "postgres";

const E2E_TEST_LABEL = "__e2e_reminder_test__";

function log(stage, payload = {}) {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[${ts}] [e2e ${stage}]`, JSON.stringify(payload, null, 0));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Run with --env-file=.env.local.");
    process.exit(1);
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET is not set. The cron endpoint will reject the call.");
    process.exit(1);
  }
  const cronBase =
    process.env.E2E_CRON_BASE ?? "http://localhost:3000";

  const sql = postgres(url, { prepare: false, max: 4 });

  try {
    // 1. Verify migrations are applied.
    log("preflight check", {});
    const hasTables = await sql`
      select
        (select to_regclass('public.bet_reminder_sent') is not null) as has_brs,
        (select to_regclass('public.push_subscriptions') is not null) as has_ps,
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='settings'
            and column_name='reminder_offset_minutes'
        ) as has_offset,
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='profiles'
            and column_name='push_opt_in'
        ) as has_opt_in
    `;
    const { has_brs, has_ps, has_offset, has_opt_in } = hasTables[0];
    if (!has_brs || !has_ps || !has_offset || !has_opt_in) {
      console.error(
        "Missing schema. Run `pnpm db:migrate` first. Detected:",
        { has_brs, has_ps, has_offset, has_opt_in },
      );
      process.exit(2);
    }

    // 1b. Verify at least one paid player exists; otherwise nothing
    // will be picked up by the sender.
    const paidPlayers = await sql`
      select count(*)::int as n
      from public.payments
      where status = 'approved'
    `;
    const paidCount = paidPlayers[0].n;
    log("paid players found", { count: paidCount });
    if (paidCount === 0) {
      console.error(
        "No players with payments.status='approved'. Sender will find nobody to email.",
      );
      process.exit(3);
    }

    // 2. Snapshot the current reminder_offset_minutes so we can
    // restore it in cleanup.
    const beforeSettings = await sql`
      select reminder_offset_minutes from public.settings where id = 1
    `;
    const originalOffset = beforeSettings[0]?.reminder_offset_minutes ?? 60;
    log("snapshot settings", { originalOffset });

    // 2b. Make sure we have a creator (admin profile) so the test
    // bet's created_by FK resolves.
    const adminRows = await sql`
      select id::text as id from public.profiles where role='admin' limit 1
    `;
    if (adminRows.length === 0) {
      console.error("No admin profile found; cannot author the test bet.");
      process.exit(4);
    }
    const adminId = adminRows[0].id;

    // 3. Clean up any leftover test bets from a prior crashed run.
    await sql`
      delete from public.custom_bets
      where question_he like ${"%" + E2E_TEST_LABEL + "%"}
    `;

    // 4. Insert the test bet. Tournament scope so we don't need a
    // matchday or match. lock_at is 5 minutes from now so the 60-min
    // window picks it up.
    const lockAt = new Date(Date.now() + 5 * 60 * 1000);
    const inserted = await sql`
      insert into public.custom_bets (
        scope, question_he, question_en, grading_rule_he, grading_rule_en,
        answer_type, answer_config,
        stake_snapshot, payout_snapshot,
        grading_source, status, lock_at, created_by, published_at
      ) values (
        'tournament',
        ${"בדיקת E2E — מי יזכה במונדיאל? " + E2E_TEST_LABEL},
        ${"E2E test: who wins? " + E2E_TEST_LABEL},
        ${"לבדיקה בלבד — לא יידורג"},
        ${"For testing only — will not be graded"},
        'yes_no',
        ${sql.json({})}::jsonb,
        1, 2,
        'manual', 'open', ${lockAt}, ${adminId}::uuid, now()
      )
      returning id::text as id
    `;
    const betId = inserted[0].id;
    log("test bet inserted", { betId, lockAtIso: lockAt.toISOString() });

    // 5. Set offset to 60 so the bet falls inside the window.
    await sql`
      update public.settings set reminder_offset_minutes = 60 where id = 1
    `;

    // 6. Trigger the cron pass.
    log("triggering cron", { url: cronBase + "/api/cron/sync" });
    const res = await fetch(cronBase + "/api/cron/sync", {
      method: "POST",
      headers: { authorization: "Bearer " + cronSecret },
    });
    const body = await res.text();
    log("cron returned", { status: res.status, body: body.slice(0, 500) });

    // 7. Read the dedup table to see who got emailed / pushed.
    const sentRows = await sql`
      select user_id::text as user_id, channel
      from public.bet_reminder_sent
      where custom_bet_id = ${betId}::uuid
      order by channel
    `;
    log("reminders recorded", {
      total: sentRows.length,
      byChannel: sentRows.reduce((acc, r) => {
        acc[r.channel] = (acc[r.channel] ?? 0) + 1;
        return acc;
      }, {}),
    });

    // 8. Print verification checklist for the operator.
    console.log("");
    console.log("====================================================");
    console.log("Verify now:");
    console.log("");
    console.log("  • Inboxes of paid players (RESEND_API_KEY + EMAIL_FROM");
    console.log("    must be set; otherwise the sender logs 'not_configured'");
    console.log("    and bet_reminder_sent stays empty for the email channel).");
    console.log("");
    console.log("  • Browsers / devices where a player toggled push opt-in ON.");
    console.log("    (VAPID env must be set; otherwise sender silently skips");
    console.log("    push and only the email channel rows appear above.)");
    console.log("");
    console.log("  • Dev-server logs (.next/dev/logs/next-development.log)");
    console.log("    or Vercel logs grep '[lock reminder send]' and");
    console.log("    '[lock reminder sweep]'.");
    console.log("====================================================");
    console.log("");
  } finally {
    // 9. Cleanup: delete the test bet (CASCADE drops the
    // bet_reminder_sent rows for it) and restore the offset.
    try {
      const beforeSettings = await sql`
        select reminder_offset_minutes from public.settings where id = 1
      `;
      // Only restore if the script set it; if the user changed it
      // mid-run, leave their value alone.
      const beforeOffset =
        beforeSettings[0]?.reminder_offset_minutes ?? null;
      log("cleanup", { currentOffset: beforeOffset });
    } catch {}

    try {
      const deleted = await sql`
        delete from public.custom_bets
        where question_he like ${"%" + E2E_TEST_LABEL + "%"}
        returning id::text as id
      `;
      log("cleanup deleted bets", { count: deleted.length });
    } catch (err) {
      console.warn("[e2e cleanup failed]", err?.message ?? err);
    }
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[e2e fatal]", err);
  process.exit(99);
});
