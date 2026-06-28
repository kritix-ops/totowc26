// One-shot, owner-authorised RETROACTIVE re-pricing of the Mexico vs South
// Africa (2026-06-11) live bets with corrected PER-SIDE odds.
//
// The user decided WITH all participants to retroactively re-price these
// bets so each yes/no side carries its own fair odds (the original bets
// shared one odds for both sides, so the safe side — e.g. "no VAR" — was
// massively overpaid). This supersedes the earlier uncap-only re-settle.
//
// Per-side odds (decimal), agreed with the user. Yes on bets 5 & 6 set to
// 6 (not 10/8). House edge (5%) and the ratio guard (×8, no ceiling) are
// applied exactly as the live engine prices a freshly-published bet.
//
// Safety: dry-run by default (--apply to write); backs up the full current
// state of every affected pick; writes one bet_grading_audit row per bet;
// recomputes points fresh from (side odds, stake) so it is idempotent.
// Honours feedback_user_bets_are_sacred: owner-explicit, reversible, audited.

import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";
import { normalizeOdds, liveStakeCap } from "../src/lib/odds-normalize";

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APPLY = process.argv.includes("--apply");
const MATCH_ID = "75ed52a9-d3c7-4e12-bdd4-f9b18e2b54df"; // MEX 2:0 RSA

// Corrected per-side decimal odds, keyed by custom_bets.id prefix.
const ODDS: Record<string, { yes: number; no: number; label: string }> = {
  "ac7774f0": { yes: 3, no: 2, label: "BTTS" },
  "afdc73d2": { yes: 2, no: 2, label: "3+ goals" },
  "626077a8": { yes: 2, no: 2, label: "10+ corners" },
  "a838874e": { yes: 5, no: 2, label: "goal before 15'" },
  "2f3cdf49": { yes: 6, no: 2, label: "VAR 1H red card" },
  "5d6b53f1": { yes: 6, no: 2, label: "VAR 2H penalty" },
  "4793c4a1": { yes: 6, no: 2, label: "substitute scores" },
};

async function rest(path: string, init?: RequestInit) {
  const r = await fetch(`${supaUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

function oddsKey(betId: string) {
  const pre = betId.slice(0, 8);
  return ODDS[pre] ? pre : null;
}

async function main() {
  console.log(`MODE: ${APPLY ? "APPLY (writes to PROD)" : "DRY RUN"}`);

  const [s] = (await rest(
    "settings?id=eq.1&select=live_odds_house_edge_pct,live_odds_max_payout_ratio,live_odds_base_stake",
  )) as any[];
  const houseEdgePct = s.live_odds_house_edge_pct;
  const ratio = s.live_odds_max_payout_ratio;
  const baseStake = s.live_odds_base_stake;
  console.log(`settings: edge=${houseEdgePct}% ratio=${ratio} baseStake=${baseStake}`);

  // Price one side at a given stake, no ceiling.
  const price = (odds: number, stake: number) =>
    normalizeOdds(odds, {
      baseStake: stake,
      maxPayout: liveStakeCap(stake, { maxPayoutRatio: ratio, maxPayoutCeiling: 0 }),
      houseEdgePct,
    }).payout;

  const bets = (await rest(
    `custom_bets?match_id=eq.${MATCH_ID}&scope=eq.match&select=id,question_he,answer_type,answer_config,decimal_odds,payout_snapshot,resolved_value`,
  )) as any[];

  // Safety: every bet must be in the odds table and be a yes_no bet.
  const unmatched = bets.filter((b) => !oddsKey(b.id) || b.answer_type !== "yes_no");
  if (unmatched.length) {
    console.error("ABORT: unmatched / non-yes_no bets:", unmatched.map((b) => b.id));
    process.exit(1);
  }

  const pickChanges: any[] = [];
  const betUpdates: any[] = [];
  const userDelta = new Map<string, number>();

  for (const b of bets) {
    const key = oddsKey(b.id)!;
    const { yes, no, label } = ODDS[key];
    const payoutOverrideYes = price(yes, baseStake);
    const payoutOverrideNo = price(no, baseStake);
    const newConfig = {
      ...(b.answer_config && typeof b.answer_config === "object" ? b.answer_config : {}),
      kind: "yes_no",
      decimalOddsYes: yes,
      decimalOddsNo: no,
      payoutOverrideYes,
      payoutOverrideNo,
    };
    betUpdates.push({
      id: b.id,
      label,
      yes,
      no,
      newConfig,
      newBetPayout: Math.max(payoutOverrideYes, payoutOverrideNo),
      oldBetPayout: b.payout_snapshot,
    });

    const picks = (await rest(
      `user_custom_bet_picks?custom_bet_id=eq.${b.id}&select=id,user_id,answer,stake_paid,payout_snapshot,was_correct,points_earned`,
    )) as any[];

    for (const p of picks) {
      const pickedYes = p.answer?.type === "yes_no" ? !!p.answer.value : null;
      if (pickedYes === null) {
        console.warn(`  skip non-yes_no pick ${p.id.slice(0, 8)} on ${label}`);
        continue;
      }
      const sideOdds = pickedYes ? yes : no;
      const newPayout = price(sideOdds, p.stake_paid);
      const newPoints = p.was_correct ? newPayout : 0;
      const oldPoints = p.points_earned ?? 0;
      if (newPayout !== p.payout_snapshot || newPoints !== oldPoints) {
        pickChanges.push({
          pickId: p.id,
          userId: p.user_id,
          betLabel: label,
          side: pickedYes ? "Yes" : "No",
          stake: p.stake_paid,
          sideOdds,
          oldPayout: p.payout_snapshot,
          newPayout,
          oldPoints,
          newPoints,
          correct: p.was_correct,
        });
        userDelta.set(p.user_id, (userDelta.get(p.user_id) ?? 0) + (newPoints - oldPoints));
      }
    }
  }

  // Resolve names.
  const userIds = Array.from(userDelta.keys());
  const profiles = userIds.length
    ? ((await rest(`profiles?id=in.(${userIds.join(",")})&select=id,display_name,is_bot`)) as any[])
    : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name + (p.is_bot ? " (bot)" : "")]));

  console.log(`\nBet-level config updates: ${betUpdates.length}`);
  for (const u of betUpdates) {
    console.log(
      `  ${u.label.padEnd(20)} Yes=×${u.yes} No=×${u.no}  ` +
        `overrides Yes=${u.newConfig.payoutOverrideYes} No=${u.newConfig.payoutOverrideNo}  ` +
        `(bet payout ${u.oldBetPayout} → ${u.newBetPayout})`,
    );
  }

  console.log(`\nPick changes: ${pickChanges.length}`);
  // group by bet for readability
  for (const u of betUpdates) {
    const rows = pickChanges.filter((c) => c.betLabel === u.label);
    if (!rows.length) continue;
    console.log(`\n  ── ${u.label} (resolved winner side pays its own odds) ──`);
    rows
      .sort((a, b) => b.newPoints - a.newPoints || b.stake - a.stake)
      .forEach((c) =>
        console.log(
          `    ${(nameById.get(c.userId) ?? c.userId.slice(0, 8)).padEnd(16)} ` +
            `${c.side.padEnd(3)} stake=${String(c.stake).padStart(2)} ×${c.sideOdds}  ` +
            `pts ${String(c.oldPoints).padStart(3)} → ${String(c.newPoints).padStart(3)}  ` +
            `(${c.newPoints - c.oldPoints >= 0 ? "+" : ""}${c.newPoints - c.oldPoints})` +
            (c.correct ? "" : "  [lost]"),
        ),
      );
  }

  console.log(`\nPer-user net point delta:`);
  Array.from(userDelta.entries())
    .sort((a, b) => a[1] - b[1])
    .forEach(([uid, d]) =>
      console.log(`  ${(nameById.get(uid) ?? uid.slice(0, 8)).padEnd(16)} ${d >= 0 ? "+" : ""}${d}`),
    );
  const poolDelta = Array.from(userDelta.values()).reduce((a, b) => a + b, 0);
  console.log(`\nTotal pool point delta: ${poolDelta >= 0 ? "+" : ""}${poolDelta}`);

  if (!APPLY) {
    console.log("\nDRY RUN complete. Re-run with --apply to write.");
    return;
  }

  // Backup current state of every pick on these bets.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `_scripts/reprice-mex-rsa-backup-${stamp}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        betUpdates: betUpdates.map((u) => ({ id: u.id, oldBetPayout: u.oldBetPayout })),
        pickChanges: pickChanges.map((c) => ({
          pickId: c.pickId,
          userId: c.userId,
          before: { payout_snapshot: c.oldPayout, points_earned: c.oldPoints },
          after: { payout_snapshot: c.newPayout, points_earned: c.newPoints },
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nBackup written: ${backupPath}`);

  // Update picks.
  for (const c of pickChanges) {
    await rest(`user_custom_bet_picks?id=eq.${c.pickId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        payout_snapshot: c.newPayout,
        points_earned: c.newPoints,
        updated_at: new Date().toISOString(),
      }),
    });
  }
  console.log(`Picks updated: ${pickChanges.length}`);

  // Update bet answer_config + bet-level payout snapshot.
  for (const u of betUpdates) {
    await rest(`custom_bets?id=eq.${u.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        answer_config: u.newConfig,
        payout_snapshot: u.newBetPayout,
        updated_at: new Date().toISOString(),
      }),
    });
  }
  console.log(`Bets updated: ${betUpdates.length}`);

  // Audit trail.
  const [admin] = (await rest("profiles?role=eq.admin&select=id&limit=1")) as any[];
  if (admin?.id) {
    for (const u of betUpdates) {
      await rest("bet_grading_audit", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          custom_bet_id: u.id,
          action: "grade",
          previous_status: "graded",
          new_status: "graded",
          reason: `Retroactive per-side re-pricing (Yes ×${u.yes} / No ×${u.no}), no ceiling. Decided with all participants.`,
          performed_by: admin.id,
        }),
      });
    }
    console.log(`Audit rows: ${betUpdates.length}`);
  } else {
    console.warn("No admin profile found — skipped DB audit rows (backup still written).");
  }

  console.log("\nAPPLY complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
