#!/usr/bin/env node
// Probe current published outright bets + odds snapshots so we know
// exactly what surface needs patching.
//
// Usage:
//   node --env-file=.env.local scripts/probe-outright-bets.mjs
import postgres from "postgres";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL missing");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });

try {
  console.log("=== custom_bets with dynamicSource=players ===");
  const playerBets = await sql`
    select
      id, question_he, status,
      answer_config -> 'dynamicSource' as dynamic_source,
      coalesce(jsonb_array_length(answer_config -> 'options'), 0) as options_count,
      lock_at, created_at
    from public.custom_bets
    where answer_config ->> 'dynamicSource' = 'players'
    order by created_at desc
  `;
  for (const b of playerBets) {
    console.log(`  ${b.id} | ${b.status.padEnd(10)} | options=${b.options_count} | ${b.question_he}`);
  }

  console.log("\n=== custom_bets ALL non-archived ===");
  const allBets = await sql`
    select id, question_he, scope, status,
      answer_config ->> 'dynamicSource' as ds,
      coalesce(jsonb_array_length(answer_config -> 'options'), 0) as options_count,
      lock_at
    from public.custom_bets
    where status not in ('cancelled')
    order by created_at desc
  `;
  console.log(`  ${allBets.length} non-cancelled bets`);
  for (const b of allBets) {
    console.log(`  ${b.id} | ${b.scope.padEnd(11)} | ${b.status.padEnd(10)} | ds=${(b.ds??"-").padEnd(8)} | opts=${String(b.options_count).padStart(4)} | ${b.question_he}`);
  }

  console.log("\n=== outright_odds_snapshot ===");
  const snap = await sql`
    select surface, option_kind, count(*)::int as n, max(fetched_at) as last_fetched, bool_or(admin_override) as has_overrides
    from public.outright_odds_snapshot
    group by surface, option_kind
    order by surface
  `;
  for (const s of snap) {
    console.log(`  ${s.surface.padEnd(15)} | ${s.option_kind.padEnd(7)} | n=${String(s.n).padStart(4)} | last=${s.last_fetched?.toISOString?.() ?? s.last_fetched} | overrides=${s.has_overrides}`);
  }

  console.log("\n=== user_custom_bet_picks pointing at currently-published bets ===");
  const picks = await sql`
    select cb.id, cb.question_he, count(p.*)::int as picks
    from public.custom_bets cb
    join public.user_custom_bet_picks p on p.custom_bet_id = cb.id
    where cb.status not in ('cancelled')
    group by cb.id, cb.question_he
    order by picks desc
  `;
  for (const p of picks) {
    console.log(`  ${String(p.picks).padStart(3)} picks | ${p.question_he}`);
  }
} finally {
  await sql.end();
}
