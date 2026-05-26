#!/usr/bin/env node
// Computes points for every match_bet on a finalized match: main 1X2/exact
// score plus the per-match side bets (BTTS, O/U 2.5, halftime exact, halftime
// outcome). Idempotent: bets with points_earned already set are skipped.
// Usage: pnpm db:score

import postgres from "postgres";

const dbUrl = process.env.DIRECT_URL;
if (!dbUrl) {
  console.error("DIRECT_URL not set.");
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 1, prepare: false });

function outcome(home, away) {
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

try {
  const [settings] = await sql`
    select
      scoring_exact, scoring_outcome,
      scoring_btts, scoring_over_25,
      scoring_ht_exact, scoring_ht_outcome
    from public.settings where id = 1
  `;
  if (!settings) {
    console.error("settings row missing");
    process.exit(1);
  }
  const wExact = Number(settings.scoring_exact);
  const wOutcome = Number(settings.scoring_outcome);
  const wBtts = Number(settings.scoring_btts);
  const wOver25 = Number(settings.scoring_over_25);
  const wHtExact = Number(settings.scoring_ht_exact);
  const wHtOutcome = Number(settings.scoring_ht_outcome);

  // Find matches that are final and have at least one unscored bet.
  const matches = await sql`
    select id, home_score, away_score, ht_home_score, ht_away_score
    from public.matches
    where status = 'final'
      and home_score is not null
      and away_score is not null
      and exists (
        select 1 from public.match_bets mb
        where mb.match_id = matches.id and mb.points_earned is null
      )
  `;

  console.log(`Scoring ${matches.length} matches...`);
  let updatedBets = 0;

  for (const m of matches) {
    const actualOutcome = outcome(m.home_score, m.away_score);
    const actualBtts = m.home_score > 0 && m.away_score > 0;
    const actualOver25 = m.home_score + m.away_score > 2;
    const haveHt = m.ht_home_score !== null && m.ht_away_score !== null;
    const actualHtOutcome = haveHt ? outcome(m.ht_home_score, m.ht_away_score) : null;

    const bets = await sql`
      select id,
             home_score, away_score,
             bet_btts, bet_over_25,
             bet_ht_home, bet_ht_away
      from public.match_bets
      where match_id = ${m.id} and points_earned is null
    `;

    for (const b of bets) {
      const exact = b.home_score === m.home_score && b.away_score === m.away_score;
      const correctOutcome = outcome(b.home_score, b.away_score) === actualOutcome;
      const points = exact ? wExact : correctOutcome ? wOutcome : 0;

      // Side bets - only score when the user actually placed that bet.
      let pointsBtts = null;
      if (b.bet_btts !== null) {
        pointsBtts = b.bet_btts === actualBtts ? wBtts : 0;
      }
      let pointsOver25 = null;
      if (b.bet_over_25 !== null) {
        pointsOver25 = b.bet_over_25 === actualOver25 ? wOver25 : 0;
      }
      let pointsHt = null;
      if (haveHt && b.bet_ht_home !== null && b.bet_ht_away !== null) {
        const htExact = b.bet_ht_home === m.ht_home_score && b.bet_ht_away === m.ht_away_score;
        const htOutcome = outcome(b.bet_ht_home, b.bet_ht_away) === actualHtOutcome;
        pointsHt = htExact ? wHtExact : htOutcome ? wHtOutcome : 0;
      }

      await sql`
        update public.match_bets
        set points_earned = ${points},
            was_exact = ${exact},
            was_correct_outcome = ${correctOutcome},
            points_btts = ${pointsBtts},
            points_over_25 = ${pointsOver25},
            points_ht = ${pointsHt},
            locked = true
        where id = ${b.id}
      `;
      updatedBets += 1;
    }
    console.log(`  match ${m.id.slice(0, 8)}: scored ${bets.length} bets`);
  }

  console.log("");
  console.log(`✅ Done. ${updatedBets} bets scored across ${matches.length} matches.`);
} catch (e) {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 3 });
}
