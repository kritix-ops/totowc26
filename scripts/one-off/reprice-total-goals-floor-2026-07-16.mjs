// One-off retroactive re-pricing: lift the "total goals" tournament bet's
// favourite bucket ("over 295", value gt_295) from the old floor 20 to the
// new floor 35, and re-score the winners who picked it.
//
// Scope: ONLY custom_bets.id = 3ba57e2b-dec8-47a9-b410-27b2a7403208
// (question "כמה שערים יובקעו בסך הכל במונדיאל 2026?"). Resolved value is
// gt_295, so every gt_295 pick is a winner. No other bet is touched.
//
// Effect: answer_config option gt_295 payoutOverride 20 → 35; each gt_295
// pick payout_snapshot 20 → 35 and (where was_correct) points_earned 20 → 35.
// This shifts the live leaderboard (each winner +15) — accepted by the user
// for this one bet. See _plans/2026-07-16-raise-tournament-bet-floor-to-35.md.
//
// SAFETY: dry-run by default (reads + prints only). Pass APPLY=1 to mutate.
// Writes a JSON backup before any write, runs inside one transaction, and
// inserts a bet_grading_audit row.
//
// Dry-run: node --env-file=.env.local scripts/one-off/reprice-total-goals-floor-2026-07-16.mjs
// Apply:   APPLY=1 node --env-file=.env.local scripts/one-off/reprice-total-goals-floor-2026-07-16.mjs
import postgres from "postgres";
import { writeFileSync } from "node:fs";

const BET_ID = "3ba57e2b-dec8-47a9-b410-27b2a7403208";
const WINNING_VALUE = "gt_295";
const OLD_FLOOR = 20;
const NEW_FLOOR = 35;
const ADMIN_ID = "7b6ff987-73de-4604-9390-1cb35fc9812b"; // יואב מזרחי (role=admin)
const REASON =
  "Raise tournament floor 20→35: re-priced 'total goals' favourite bucket (over 295) and re-scored its winners. See _plans/2026-07-16-raise-tournament-bet-floor-to-35.md.";

const APPLY = process.env.APPLY === "1";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) { console.error("No DIRECT_URL / DATABASE_URL"); process.exit(1); }
const sql = postgres(url, {
  max: 1, prepare: false, idle_timeout: 5, connect_timeout: 12,
  connection: { statement_timeout: 20000 },
});
const out = (l, r) => { console.log(`\n=== ${l} ===`); console.dir(r, { depth: null }); };

try {
  out("identity", await sql`select current_database() as db,
    (select count(*) from public.profiles where not coalesce(is_bot,false)) as humans`);
  console.log(`\nMODE: ${APPLY ? "APPLY (will mutate)" : "DRY-RUN (read-only)"}`);

  const [bet] = await sql`
    select id, status, question_he, answer_config, resolved_value
    from public.custom_bets where id = ${BET_ID}`;
  if (!bet) { console.error("Bet not found — aborting."); await sql.end(); process.exit(1); }
  if (bet.status !== "graded") {
    console.error(`Bet status is '${bet.status}', expected 'graded' — aborting.`);
    await sql.end(); process.exit(1);
  }
  if (bet.resolved_value?.value !== WINNING_VALUE) {
    console.error(`Resolved value is ${JSON.stringify(bet.resolved_value)}, expected ${WINNING_VALUE} — aborting.`);
    await sql.end(); process.exit(1);
  }
  console.log(`\nBet: ${bet.question_he}  [status=${bet.status}]`);

  // Current per-option payouts.
  const cfg = bet.answer_config;
  const opts = Array.isArray(cfg.options) ? cfg.options : [];
  out("current answer_config options", opts.map((o) => ({ value: o.value, labelHe: o.labelHe, payoutOverride: o.payoutOverride })));

  const target = opts.find((o) => o.value === WINNING_VALUE);
  if (!target) { console.error(`No ${WINNING_VALUE} option in answer_config — aborting.`); await sql.end(); process.exit(1); }
  if (target.payoutOverride !== OLD_FLOOR) {
    console.log(`\nNote: ${WINNING_VALUE} payoutOverride is ${target.payoutOverride}, not ${OLD_FLOOR}. Already re-priced? Aborting to stay idempotent.`);
    await sql.end(); process.exit(0);
  }

  // The winning picks we will re-score.
  const winners = await sql`
    select pk.id as pick_id, p.display_name,
      pk.stake_paid, pk.payout_snapshot, pk.points_earned, pk.was_correct,
      pk.answer->>'value' as pick_value
    from public.user_custom_bet_picks pk
    join public.profiles p on p.id = pk.user_id
    where pk.custom_bet_id = ${BET_ID} and pk.answer->>'value' = ${WINNING_VALUE}
    order by p.display_name`;
  out(`gt_295 winning picks (${winners.length}) — each moves ${OLD_FLOOR} → ${NEW_FLOOR}`, winners);

  const totalDelta = winners.filter((w) => w.was_correct).length * (NEW_FLOOR - OLD_FLOOR);
  console.log(`\nLeaderboard impact: ${winners.filter((w) => w.was_correct).length} winners × +${NEW_FLOOR - OLD_FLOOR} = +${totalDelta} points total.`);

  if (!APPLY) {
    console.log("\nDRY-RUN complete. No data changed. Re-run with APPLY=1 to commit.");
    await sql.end(); process.exit(0);
  }

  // ---- APPLY ----
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `scripts/one-off/reprice-total-goals-floor-backup-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify({ bet: { id: bet.id, answer_config: cfg }, winners }, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  const newOptions = opts.map((o) =>
    o.value === WINNING_VALUE ? { ...o, payoutOverride: NEW_FLOOR } : o);
  const newConfig = { ...cfg, options: newOptions };

  const result = await sql.begin(async (tx) => {
    await tx`
      update public.custom_bets
        set answer_config = ${tx.json(newConfig)}, updated_at = now()
      where id = ${BET_ID}`;

    const snapUpd = await tx`
      update public.user_custom_bet_picks
        set payout_snapshot = ${NEW_FLOOR}, updated_at = now()
      where custom_bet_id = ${BET_ID} and answer->>'value' = ${WINNING_VALUE}
        and payout_snapshot = ${OLD_FLOOR}
      returning id`;

    const ptsUpd = await tx`
      update public.user_custom_bet_picks
        set points_earned = ${NEW_FLOOR}, updated_at = now()
      where custom_bet_id = ${BET_ID} and answer->>'value' = ${WINNING_VALUE}
        and was_correct = true and points_earned = ${OLD_FLOOR}
      returning id`;

    await tx`
      insert into public.bet_grading_audit
        (custom_bet_id, action, previous_status, new_status, reason, performed_by)
      values (${BET_ID}, 'grade', 'graded', 'graded', ${REASON}, ${ADMIN_ID})`;

    return { snapshots: snapUpd.length, points: ptsUpd.length };
  });

  console.log(`\nApplied: ${result.snapshots} payout_snapshot rows, ${result.points} points_earned rows, +1 audit row.`);

  // Re-verify.
  out("after — answer_config options", (await sql`
    select answer_config from public.custom_bets where id = ${BET_ID}`)[0]
    .answer_config.options.map((o) => ({ value: o.value, payoutOverride: o.payoutOverride })));
  out("after — gt_295 picks (must all be 35)", await sql`
    select p.display_name, pk.payout_snapshot, pk.points_earned, pk.was_correct
    from public.user_custom_bet_picks pk
    join public.profiles p on p.id = pk.user_id
    where pk.custom_bet_id = ${BET_ID} and pk.answer->>'value' = ${WINNING_VALUE}
    order by p.display_name`);

  console.log("\nDONE");
} catch (e) {
  console.error("ERR:", e?.message || e);
} finally {
  await sql.end({ timeout: 5 });
  process.exit(0);
}
