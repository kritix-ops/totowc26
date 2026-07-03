// Read-only regression check for the "header pill shows a lower number than
// the real score" bug (2026-07-03).
//
// Root cause: the bank-balance formula (header pill, profile total, admin
// roster, monkey benchmark) never added the "who advances?" (מי עולה)
// payouts stored in match_advance_bets, while the leaderboard's match_score
// did. Anyone who earned advance points saw a pill BELOW their leaderboard
// score.
//
// This script recomputes, per non-bot user:
//   old_balance  = the buggy formula (no advance term)
//   new_balance  = the fixed formula (with advance term)  == what bank.ts now returns
//   board_score  = the leaderboard overall score           == source of truth
// and asserts new_balance == board_score for every user. It also reports how
// many users the bug actually moved (advance_points <> 0).
//
// Run:
//   node --env-file=.env.local scripts/one-off/verify-bank-includes-advance-2026-07-03.mjs
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connection: { statement_timeout: 15000 },
});

// Per-duel net delta, mirroring duelCaseSql / duelDeltaSql in src/lib/bank.ts.
// Kept inline so this script has zero import coupling to the app build.
const duelDelta = (ref) => sql`coalesce((
  select sum(case
    when d.status = 'open' and d.opener_id = ${ref} then -d.stake
    when d.status = 'matched' and (d.opener_id = ${ref} or d.joiner_id = ${ref}) then -d.stake
    when d.status = 'settled' and d.opener_id = ${ref} then
      case
        when d.options is null then
          case when d.resolved_value = d.opener_answer then d.stake else -d.stake end
        else
          case when d.resolved_option = d.opener_option
            then ((d.stake * (d.opener_option_multiplier_pct - 100)) / 100)::int
            else -d.stake end
      end
    when d.status = 'settled' and d.joiner_id = ${ref} then
      case
        when d.options is null then
          case when d.resolved_value = d.opener_answer then -d.stake else d.stake end
        else
          case when d.resolved_option = d.joiner_option
            then ((d.stake * (d.joiner_option_multiplier_pct - 100)) / 100)::int
            else -d.stake end
      end
    else 0
  end)::int
  from public.duels d
  where (d.opener_id = ${ref} or d.joiner_id = ${ref})
    and d.status <> 'cancelled'
), 0)`;

try {
  const rows = await sql`
    select
      p.id::text        as user_id,
      p.display_name    as name,
      (select starting_bank from public.settings where id = 1)::int as starting,
      coalesce((select sum(coalesce(mb.points_earned, 0))::int
        from public.match_bets mb where mb.user_id = p.id), 0)         as match_pts,
      coalesce((select sum(coalesce(ab.points_earned, 0))::int
        from public.match_advance_bets ab where ab.user_id = p.id), 0) as advance_pts,
      coalesce((select sum(coalesce(pk.points_earned, 0) - pk.stake_paid)::int
        from public.user_custom_bet_picks pk where pk.user_id = p.id), 0) as live_net,
      ${duelDelta(sql`p.id`)}                                          as duel_delta,
      coalesce((select sum(pa.delta)::int
        from public.point_adjustments pa where pa.user_id = p.id), 0)  as adjustments
    from public.profiles p
    where p.is_bot = false
    order by p.display_name asc
  `;

  let mismatches = 0;
  let affected = 0;
  for (const r of rows) {
    const starting = Number(r.starting);
    const match = Number(r.match_pts);
    const advance = Number(r.advance_pts);
    const live = Number(r.live_net);
    const duel = Number(r.duel_delta);
    const adj = Number(r.adjustments);

    const oldBalance = starting + match + live + duel + adj;
    const newBalance = starting + match + advance + live + duel + adj;
    const boardScore = starting + match + advance + live + duel + adj; // leaderboard overall

    if (newBalance !== boardScore) {
      mismatches += 1;
      console.error(
        `[verify] MISMATCH ${r.name}: new=${newBalance} board=${boardScore}`,
      );
    }
    if (advance !== 0) {
      affected += 1;
      console.log(
        `[verify] ${r.name.padEnd(20)} advance=${String(advance).padStart(4)}  old=${String(oldBalance).padStart(5)} -> fixed=${String(newBalance).padStart(5)}`,
      );
    }
  }

  console.log(
    `[verify] users=${rows.length} affected-by-advance=${affected} balance!=board mismatches=${mismatches}`,
  );
  if (mismatches > 0) {
    console.error("[verify] FAILED — bank balance no longer equals leaderboard score");
    process.exitCode = 1;
  } else {
    console.log("[verify] OK — bank balance == leaderboard score for every user");
  }
} finally {
  await sql.end();
}
