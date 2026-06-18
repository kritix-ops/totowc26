// One-off emergency fix (2026-06-19): an admin graded then reversed the
// MEX vs KOR live bet by mistake, leaving it status='reversed' — which makes
// it disappear from the player fill surfaces (those filter status='open').
// The match has not kicked off yet (lock_at > now), so we put it back to
// 'open' so the remaining players can still fill.
//
// Safe: guarded by status='reversed' (no-op if already changed), wrapped in a
// transaction, writes a 'reopen' audit row attributed to whoever performed the
// preceding reverse. The same status flip + audit is what the new
// reopenCustomBet server action does — this just unblocks prod before deploy.
//
// Run: node --env-file=.env.local scripts/one-off/reopen-mex-kor-bet-2026-06-19.mjs

import postgres from "postgres";

const BET_ID = "5be5cf9f-017d-4baa-9c1b-9a33af3d55ff"; // MEX vs KOR, btts yes/no

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
console.log("DB host:", new URL(url).host);

const sql = postgres(url, {
  prepare: false,
  max: 2,
  idle_timeout: 5,
  connect_timeout: 10,
});

try {
  // Make the audit CHECK accept 'reopen'. Idempotent (DROP IF EXISTS + ADD),
  // identical to migration 0062 so re-running the migrator on deploy is a no-op.
  await sql`
    ALTER TABLE "bet_grading_audit"
      DROP CONSTRAINT IF EXISTS "bet_grading_audit_action_valid"
  `;
  await sql`
    ALTER TABLE "bet_grading_audit"
      ADD CONSTRAINT "bet_grading_audit_action_valid"
        CHECK (action IN ('grade', 'reverse', 'cancel', 'reopen'))
  `;
  console.log("OK   audit CHECK now allows 'reopen'");

  const result = await sql.begin(async (tx) => {
    const [bet] = await tx`
      select status::text as status, question_he as question
      from public.custom_bets
      where id = ${BET_ID}
      for update
    `;
    if (!bet) return { ok: false, reason: "bet_not_found" };
    if (bet.status !== "reversed") {
      return { ok: false, reason: `status_is_${bet.status}` };
    }

    // Reuse the admin who reversed it as the audit principal.
    const [last] = await tx`
      select performed_by
      from public.bet_grading_audit
      where custom_bet_id = ${BET_ID}
      order by performed_at desc
      limit 1
    `;
    const performedBy = last?.performed_by;
    if (!performedBy) return { ok: false, reason: "no_audit_principal" };

    await tx`
      insert into public.bet_grading_audit
        (custom_bet_id, action, previous_status, new_status,
         previous_resolved_value, new_resolved_value, reason, performed_by)
      values
        (${BET_ID}, 'reopen', 'reversed', 'open',
         null, null,
         'Reopened after accidental grade+reverse — match has not started, restoring fill window (manual prod fix 2026-06-19)',
         ${performedBy})
    `;

    await tx`
      update public.custom_bets
      set status = 'open', updated_at = now()
      where id = ${BET_ID} and status = 'reversed'
    `;

    return { ok: true, question: bet.question };
  });

  if (!result.ok) {
    console.error(`SKIP reopen not applied: ${result.reason}`);
    process.exitCode = 1;
  } else {
    const [after] = await sql`
      select status::text as status, (lock_at > now()) as time_left
      from public.custom_bets where id = ${BET_ID}
    `;
    console.log(
      `OK   reopened "${result.question}" → status=${after.status} timeLeft=${after.time_left}`,
    );
  }
} catch (e) {
  console.error("reopen failed:", e?.message ?? e);
  if (e?.code) console.error("  code:", e.code);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
