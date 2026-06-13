// One-off remediation for the auto-grade flat-payout bug.
//
// The auto grader (sync.ts) paid every correct picker the flat bet-level
// payout_snapshot, ignoring each pick's own payout_snapshot (which is
// stake- and side-priced). This corrects points_earned to the per-pick
// snapshot for every mispaid WINNING pick on already-graded bets.
//
// Scope: status='graded', was_correct=true, payout_snapshot is not null,
// points_earned is distinct from payout_snapshot. Manual-graded bets are
// already correct (points == snapshot) so they are not touched. Losing
// picks (was_correct=false, points 0) are not touched.
//
// Writes a JSON backup BEFORE mutating, runs inside one transaction, and
// inserts a bet_grading_audit row per affected bet.
//
// Run: node --env-file=.env.local scripts/one-off/fix-autograde-payouts.mjs
import postgres from "postgres";
import { writeFileSync } from "node:fs";

const ADMIN_ID = "7b6ff987-73de-4604-9390-1cb35fc9812b"; // יואב מזרחי (role=admin)
const REASON =
  "Auto-grade flat-payout bug: corrected points_earned to per-pick payout_snapshot (stake/side priced). See sync.ts gradedPickPoints fix.";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 12, connection: { statement_timeout: 20000 } });
const out = (l, r) => { console.log(`\n=== ${l} ===`); console.dir(r, { depth: null }); };

try {
  out("identity", await sql`select current_database() as db, (select count(*) from public.profiles) as profiles`);

  // The exact set we will change.
  const mispaid = await sql`
    select pk.id as pick_id, pk.custom_bet_id, p.display_name,
      pk.stake_paid, pk.payout_snapshot, pk.points_earned as old_points,
      cb.grading_source::text as src, cb.question_he
    from public.user_custom_bet_picks pk
    join public.custom_bets cb on cb.id = pk.custom_bet_id
    join public.profiles p on p.id = pk.user_id
    where cb.status = 'graded' and pk.was_correct = true
      and pk.payout_snapshot is not null
      and pk.points_earned is distinct from pk.payout_snapshot
    order by pk.custom_bet_id, p.display_name`;

  out(`picks to correct (${mispaid.length})`, mispaid);
  if (mispaid.length === 0) { console.log("\nNothing to fix. DONE."); await sql.end(); process.exit(0); }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `scripts/one-off/fix-autograde-payouts-backup-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify(mispaid, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  const affectedBetIds = [...new Set(mispaid.map((r) => r.custom_bet_id))];

  const applied = await sql.begin(async (tx) => {
    const updated = await tx`
      update public.user_custom_bet_picks pk
        set points_earned = pk.payout_snapshot, updated_at = now()
      from public.custom_bets cb
      where cb.id = pk.custom_bet_id
        and cb.status = 'graded' and pk.was_correct = true
        and pk.payout_snapshot is not null
        and pk.points_earned is distinct from pk.payout_snapshot
      returning pk.id`;

    for (const betId of affectedBetIds) {
      await tx`
        insert into public.bet_grading_audit
          (custom_bet_id, action, previous_status, new_status, reason, performed_by)
        values (${betId}, 'grade', 'graded', 'graded', ${REASON}, ${ADMIN_ID})`;
    }
    return updated.length;
  });

  console.log(`\nUpdated ${applied} picks across ${affectedBetIds.length} bets. Inserted ${affectedBetIds.length} audit rows.`);

  // Re-verify: zero remaining mispaid winners.
  out("remaining mispaid winners (must be 0)", await sql`
    select count(*)::int as n
    from public.user_custom_bet_picks pk
    join public.custom_bets cb on cb.id = pk.custom_bet_id
    where cb.status = 'graded' and pk.was_correct = true
      and pk.payout_snapshot is not null
      and pk.points_earned is distinct from pk.payout_snapshot`);

  out("red-card bet after fix (per-pick)", await sql`
    select p.display_name, pk.stake_paid, pk.payout_snapshot, pk.points_earned, pk.was_correct
    from public.user_custom_bet_picks pk
    join public.profiles p on p.id = pk.user_id
    where pk.custom_bet_id = '3c3e7c91-f251-4d0c-927d-ce2591cd8fb1'
    order by pk.points_earned desc nulls last, p.display_name`);

  console.log("\nDONE");
} catch (e) {
  console.error("ERR:", e?.message || e);
} finally {
  await sql.end({ timeout: 5 });
  process.exit(0);
}
