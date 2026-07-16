// One-off READ-ONLY probe: list every tournament-scope custom bet with its
// per-option payouts and the realised pick payout range. Answers "what does
// each tournament bet score for each choice?" from the DB source of truth
// (outright surfaces price per-option from the odds snapshot at publish, so
// the template file is NOT authoritative for them).
// Run: node --env-file=.env.local scripts/one-off/list-tournament-bet-payouts-2026-07-16.mjs
import postgres from "postgres";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) { console.error("No DIRECT_URL / DATABASE_URL"); process.exit(1); }

const sql = postgres(url, {
  max: 1, prepare: false, idle_timeout: 5, connect_timeout: 12,
  connection: { statement_timeout: 15000 },
});

try {
  const ident = await sql`select current_database() as db,
    (select count(*) from public.profiles where not coalesce(is_bot,false)) as humans`;
  console.log(`\nDB: ${ident[0].db}   human profiles: ${ident[0].humans}\n`);

  const bets = await sql`
    select b.id, b.scope, b.status, b.question_he, b.answer_type,
           b.payout_snapshot, b.answer_config, b.resolved_value, b.graded_at,
           (select count(*) from public.user_custom_bet_picks p where p.custom_bet_id = b.id) as picks,
           (select min(p.payout_snapshot) from public.user_custom_bet_picks p where p.custom_bet_id = b.id) as pick_pay_min,
           (select max(p.payout_snapshot) from public.user_custom_bet_picks p where p.custom_bet_id = b.id) as pick_pay_max,
           (select count(*) from public.user_custom_bet_picks p where p.custom_bet_id = b.id and p.was_correct) as winners,
           (select max(p.points_earned) from public.user_custom_bet_picks p where p.custom_bet_id = b.id and p.was_correct) as winner_points
    from public.custom_bets b
    where b.scope in ('tournament','stage','group')
    order by b.scope, b.created_at
  `;

  for (const b of bets) {
    const cfg = b.answer_config || {};
    const opts = Array.isArray(cfg.options) ? cfg.options : [];
    console.log(`\n────────────────────────────────────────────────────`);
    console.log(`[${b.scope}/${b.status}] ${b.question_he}`);
    console.log(`  id=${b.id}  type=${b.answer_type}  bet_payout_snapshot=${b.payout_snapshot}  picks=${b.picks}  winners=${b.winners}  winner_points=${b.winner_points}`);
    console.log(`  pick payout_snapshot range: ${b.pick_pay_min} .. ${b.pick_pay_max}`);
    if (b.resolved_value != null) console.log(`  resolved: ${JSON.stringify(b.resolved_value)}`);
    if (b.answer_type === "yes_no") {
      console.log(`  yes → ${cfg.payoutOverrideYes ?? "(bet default)"}   no → ${cfg.payoutOverrideNo ?? "(bet default)"}`);
    } else if (cfg.dynamicSource) {
      console.log(`  dynamicSource=${cfg.dynamicSource}  (options hydrated at view time)`);
      if (opts.length) {
        const pays = opts.map((o) => o.payoutOverride).filter((v) => typeof v === "number").sort((a, z) => a - z);
        console.log(`  baked options: ${opts.length}, payout range ${pays[0]} .. ${pays[pays.length - 1]}`);
      }
    } else if (opts.length) {
      const sorted = [...opts].sort((a, z) => (a.payoutOverride ?? 0) - (z.payoutOverride ?? 0));
      const preview = sorted.length > 12 ? [...sorted.slice(0, 6), { labelHe: "…", payoutOverride: "…" }, ...sorted.slice(-6)] : sorted;
      for (const o of preview) {
        console.log(`    ${String(o.payoutOverride).padStart(4)}  ${o.labelHe ?? o.value}`);
      }
      console.log(`  (${opts.length} options total)`);
    } else {
      console.log(`  (no options in answer_config)`);
    }
  }

  console.log(`\n\nTotal tournament/stage/group bets: ${bets.length}`);
  console.log("DONE");
} catch (err) {
  console.error("\nERROR:", err?.message || err);
} finally {
  await sql.end({ timeout: 5 });
  process.exit(0);
}
