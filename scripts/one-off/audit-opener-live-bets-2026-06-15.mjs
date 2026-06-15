// READ-ONLY: definitive opener-day numbers + grading history + cancel handling.
// Writes NOTHING. Only SELECTs.

import postgres from "postgres";
import { config } from "dotenv";
config({ path: ".env.local" });

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) { console.error("Missing DIRECT_URL / DATABASE_URL"); process.exit(1); }
const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 12, connection: { statement_timeout: 20000 } });
const D = (ts) => ts ? ts.toISOString().slice(0, 16).replace("T", " ") : "-";

try {
  // ---- A. The 7 original opener bets (June 11 morning, Mexico-RSA) ----
  console.log(`===== A. ORIGINAL OPENER BETS (created 2026-06-11 before noon) =====`);
  const opener = await sql`
    select cb.id, cb.question_he, cb.status::text as status, cb.created_at, cb.graded_at
    from public.custom_bets cb
    where cb.scope in ('match','day')
      and cb.created_at >= '2026-06-11' and cb.created_at < '2026-06-11 18:00'
    order by cb.created_at`;
  console.log(`count: ${opener.length}`);

  // grading audit for these
  const openerIds = opener.map((b) => b.id);
  const audit = await sql`
    select custom_bet_id, action, previous_status, new_status, reason, performed_at
    from public.bet_grading_audit
    where custom_bet_id in ${sql(openerIds)}
    order by performed_at`;
  console.log(`\ngrading-audit rows for opener bets: ${audit.length}`);
  for (const a of audit) {
    console.log(`  ${D(a.performed_at)} ${a.action.padEnd(8)} ${String(a.previous_status)}->${a.new_status}  "${String(a.reason).slice(0,60)}"`);
  }

  // ---- B. Aggregate every graded opener-day (June 11) live pick ----
  console.log(`\n===== B. ALL GRADED LIVE PICKS, bets created on 2026-06-11 =====`);
  const picks = await sql`
    select p.display_name, pk.user_id, cb.question_he, cb.status::text as bet_status,
           pk.answer, pk.stake_paid, pk.payout_snapshot, pk.points_earned, pk.was_correct
    from public.user_custom_bet_picks pk
    join public.custom_bets cb on cb.id = pk.custom_bet_id
    join public.profiles p on p.id = pk.user_id
    where cb.scope in ('match','day')
      and cb.created_at >= '2026-06-11' and cb.created_at < '2026-06-12'
      and cb.status = 'graded'`;

  let staked = 0, won = 0, lost = 0;
  const perUser = new Map();
  for (const r of picks) {
    staked += r.stake_paid;
    const u = perUser.get(r.display_name) ?? { net: 0, won: 0, lost: 0, staked: 0, n: 0, bigLoss: 0 };
    u.staked += r.stake_paid; u.n++;
    if (r.was_correct) { won += r.points_earned ?? 0; u.won += r.points_earned ?? 0; u.net += (r.points_earned ?? 0) - r.stake_paid; }
    else { lost += r.stake_paid; u.lost += r.stake_paid; u.net -= r.stake_paid; if (r.stake_paid > u.bigLoss) u.bigLoss = r.stake_paid; }
    perUser.set(r.display_name, u);
  }
  console.log(`graded picks: ${picks.length} | total staked: ${staked} | paid to winners: ${won} | forfeited by losers: ${lost}`);
  console.log(`net minted into pool by opener live bets: ${won - lost}`);
  console.log(`\nper-user (sorted by net):`);
  for (const [name, u] of [...perUser.entries()].sort((a,b)=>a[1].net-b[1].net)) {
    console.log(`  ${String(name).slice(0,20).padEnd(20)} net ${u.net>0?'+':''}${u.net}  (won ${u.won}, lost ${u.lost}, biggest single loss ${u.bigLoss}, picks ${u.n})`);
  }

  // ---- C. How many opener-day picks lost MORE than the new 10 cap? ----
  console.log(`\n===== C. LOSSES ABOVE THE NEW 10-POINT STAKE CAP (June 11 graded) =====`);
  const bigLosses = await sql`
    select p.display_name, cb.question_he, pk.stake_paid
    from public.user_custom_bet_picks pk
    join public.custom_bets cb on cb.id = pk.custom_bet_id
    join public.profiles p on p.id = pk.user_id
    where cb.scope in ('match','day') and cb.status='graded'
      and cb.created_at >= '2026-06-11' and cb.created_at < '2026-06-12'
      and pk.was_correct = false and pk.stake_paid > 10
    order by pk.stake_paid desc`;
  let overflow = 0;
  for (const r of bigLosses) { overflow += r.stake_paid - 10; console.log(`  ${String(r.display_name).slice(0,18).padEnd(18)} lost ${r.stake_paid} (over-cap ${r.stake_paid-10})  ${String(r.question_he).slice(0,34)}`); }
  console.log(`  -> refunding only the over-10 portion would cost: ${overflow} points across ${bigLosses.length} picks`);

  // ---- D. Cancelled bets: are stakes still debited from players? ----
  console.log(`\n===== D. CANCELLED LIVE BETS - are picks still costing players? =====`);
  const cancelled = await sql`
    select cb.id, cb.question_he, cb.created_at,
           count(pk.id) as n_picks,
           coalesce(sum(pk.stake_paid),0) as staked,
           coalesce(sum(pk.points_earned),0) as earned
    from public.custom_bets cb
    left join public.user_custom_bet_picks pk on pk.custom_bet_id = cb.id
    where cb.status = 'cancelled' and cb.scope in ('match','day')
    group by cb.id, cb.question_he, cb.created_at
    order by cb.created_at`;
  let cancStillDebited = 0;
  for (const c of cancelled) {
    const net = Number(c.earned) - Number(c.staked);
    if (Number(c.n_picks) > 0) cancStillDebited += Number(c.staked) - Number(c.earned);
    console.log(`  ${D(c.created_at)} picks=${c.n_picks} staked=${c.staked} earned=${c.earned} net=${net}  ${String(c.question_he).slice(0,34)}`);
  }
  console.log(`  -> if cancelled picks keep stake_paid>0 with earned=0, those players are STILL DOWN ${cancStillDebited} total (bank counts points_earned - stake_paid)`);

  await sql.end();
} catch (err) {
  console.error("audit failed:", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
}
