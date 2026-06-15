// One-off: refund the losing stakes on the 7 re-priced opener live bets.
//
// Why: the opener (2026-06-11) flat-odds bets were retroactively re-settled
// at corrected odds on 2026-06-12 for WINNERS, and the house-edge refund the
// same day also only credited winners. Losers were never made whole. This
// returns each loser's forfeited stake on those 7 bets, as a single
// point_adjustments row per user. See
// _plans/2026-06-15-opener-live-bet-loss-refund.md
//
// Set selection is NOT hardcoded: the 7 bets are the ones carrying a
// bet_grading_audit row reasoned "Retroactive per-side re-pricing%", the
// exact marker the June 12 re-settlement left behind.
//
// Run modes:
//   DRY-RUN (default): prints the per-user refund table. No writes.
//   --apply          : inserts one point_adjustments row per user.
//
// Idempotent: skips any user who already has a point_adjustments row with
// this exact reason, so a re-run after --apply writes nothing.

import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Missing DIRECT_URL / DATABASE_URL in .env.local");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");

// Admin issuing the refund (Yoav, role=admin). point_adjustments.created_by
// is NOT NULL and references profiles(id). Same id the house-edge refund and
// the auto-grade fix used.
const ADMIN_ID = "7b6ff987-73de-4604-9390-1cb35fc9812b";

// The on-screen label. This exact text renders as the title on the
// leaderboard accordion and as the detail on /me/bank. Keep it one clear
// Hebrew sentence; the dedup key below is this string verbatim.
const REASON =
  "החזר נקודות · באג הימורי הלייב במשחק הפתיחה (11.6). היחסים היו שבורים, אז הוחזר הסכום שהופסד.";

const sql = postgres(url, {
  max: 1,
  prepare: false,
  idle_timeout: 5,
  connect_timeout: 12,
  connection: { statement_timeout: 20000 },
});

try {
  const [{ db }] = await sql`select current_database() as db`;
  console.log(`[opener-refund] mode=${APPLY ? "APPLY" : "DRY-RUN"}  db=${db}`);

  // The 7 re-priced opener bets.
  const betRows = await sql`
    select distinct custom_bet_id as id
    from public.bet_grading_audit
    where reason like 'Retroactive per-side re-pricing%'`;
  const betIds = betRows.map((r) => r.id);
  console.log(`[opener-refund] re-priced opener bets: ${betIds.length}`);
  if (betIds.length === 0) {
    console.log("Nothing to do.");
    await sql.end();
    process.exit(0);
  }

  // Per-user sum of forfeited stake on losing picks of those bets.
  const owed = await sql`
    select pk.user_id, p.display_name, sum(pk.stake_paid)::int as refund, count(*)::int as picks
    from public.user_custom_bet_picks pk
    join public.profiles p on p.id = pk.user_id
    where pk.custom_bet_id in ${sql(betIds)}
      and pk.was_correct = false
    group by pk.user_id, p.display_name
    order by refund desc`;

  // Idempotency: who already has this exact refund?
  const existing = await sql`
    select user_id from public.point_adjustments where reason = ${REASON}`;
  const already = new Set(existing.map((r) => r.user_id));

  const toWrite = owed.filter((r) => !already.has(r.user_id));
  const skipped = owed.length - toWrite.length;

  console.log(`\n=== Refund plan (${owed.length} users, ${skipped} already refunded) ===`);
  let total = 0;
  for (const r of owed) {
    total += already.has(r.user_id) ? 0 : r.refund;
    console.log(
      `  ${String(r.display_name).slice(0, 20).padEnd(20)} +${r.refund}  (${r.picks} losing picks)${already.has(r.user_id) ? "  [already refunded - skip]" : ""}`,
    );
  }
  console.log(`\nWill write ${toWrite.length} adjustments, total +${total} points.`);
  console.log(`Reason: "${REASON}"`);

  if (!APPLY) {
    console.log(`\nDRY-RUN. Re-run with --apply to write.`);
    await sql.end();
    process.exit(0);
  }

  for (const r of toWrite) {
    await sql`
      insert into public.point_adjustments (user_id, delta, reason, created_by)
      values (${r.user_id}, ${r.refund}, ${REASON}, ${ADMIN_ID})`;
    console.info(`[opener-refund apply] user=${r.user_id} delta=+${r.refund}`);
  }
  console.log(`\n[opener-refund] done. wrote ${toWrite.length} adjustments (+${total}).`);
  await sql.end();
} catch (err) {
  console.error("[opener-refund] fatal", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
}
