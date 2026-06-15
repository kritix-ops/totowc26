// One-off: refund stakes on picks of bets that were CANCELLED before the
// cancel flow learned to refund (see cancelCustomBet — the "refund loop"
// promised in a TODO was never built, so cancelled bets with picks left
// their pickers down the stake).
//
// Fix mirrors the new inline refund: points_earned = stake_paid, which nets
// the pick to zero in every bank/leaderboard sum. Idempotent: only touches
// cancelled-bet picks that are still un-refunded (points_earned IS NULL).
//
//   DRY-RUN (default): prints the affected picks. No writes.
//   --apply          : sets points_earned = stake_paid on them.

import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Missing DIRECT_URL / DATABASE_URL in .env.local");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");
const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 12, connection: { statement_timeout: 20000 } });

try {
  const [{ db }] = await sql`select current_database() as db`;
  console.log(`[refund-cancelled] mode=${APPLY ? "APPLY" : "DRY-RUN"}  db=${db}`);

  const affected = await sql`
    select pk.id, p.display_name, pk.stake_paid, cb.question_he
    from public.user_custom_bet_picks pk
    join public.custom_bets cb on cb.id = pk.custom_bet_id
    join public.profiles p on p.id = pk.user_id
    where cb.status = 'cancelled'
      and pk.points_earned is null
      and pk.stake_paid > 0
    order by cb.question_he, p.display_name`;

  console.log(`\nun-refunded cancelled-bet picks: ${affected.length}`);
  let total = 0;
  for (const r of affected) {
    total += r.stake_paid;
    console.log(`  ${String(r.display_name).slice(0, 20).padEnd(20)} +${r.stake_paid}  "${String(r.question_he).slice(0, 36)}"`);
  }
  console.log(`\nWill refund ${affected.length} picks, total +${total} points.`);

  if (!APPLY) {
    console.log(`\nDRY-RUN. Re-run with --apply to write.`);
    await sql.end();
    process.exit(0);
  }

  const res = await sql`
    update public.user_custom_bet_picks pk
    set points_earned = pk.stake_paid, updated_at = now()
    from public.custom_bets cb
    where cb.id = pk.custom_bet_id
      and cb.status = 'cancelled'
      and pk.points_earned is null
      and pk.stake_paid > 0`;
  console.log(`\n[refund-cancelled] done. updated ${res.count} pick rows (+${total}).`);
  await sql.end();
} catch (err) {
  console.error("[refund-cancelled] fatal", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
}
