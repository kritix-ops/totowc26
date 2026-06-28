// One-shot, owner-authorised re-settlement of the Mexico vs South Africa
// (2026-06-11) live bets after the absolute payout ceiling was removed.
//
// Why: the old cap was min(stake * ratio, 100). On the VAR red-card bet
// (odds 6.0) a 30-stake and a 20-stake pick both hit the 100 ceiling, so
// the bigger staker risked more for the same prize and netted LESS. The
// user has chosen to honour the odds that were SHOWN (we do NOT re-price)
// and simply lift the 100 ceiling, keeping the per-stake ratio guard.
//
// Safety:
//   - Dry-run by default. Pass --apply to write.
//   - Self-validates: for every pick, the CAPPED recompute must equal the
//     stored payout_snapshot. If any pick disagrees, the house-edge / ratio
//     assumptions are wrong and the script aborts before touching a row.
//   - Only WINNING picks whose uncapped payout exceeds the stored points
//     are changed — the minimal set that affects the leaderboard.
//   - On --apply: writes a full before-state backup JSON and one
//     bet_grading_audit row per affected bet (action='resettle_uncap').
//
// Honours feedback_user_bets_are_sacred: insert-only audit + owner-explicit
// correction + reversible backup. See migration 0055.

import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";
import { normalizeOdds, liveStakeCap } from "../src/lib/odds-normalize";

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APPLY = process.argv.includes("--apply");

const MATCH_ID = "75ed52a9-d3c7-4e12-bdd4-f9b18e2b54df"; // MEX 2:0 RSA, 11/06

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

// Mirror write-core's resolveLiveOptionOdds for the answer types these bets
// use. These old bets carry only a single bet-level decimal_odds (no
// per-side / per-option overrides), so both yes and no read that value —
// exactly the odds the player saw. We deliberately keep it that way.
function optionOdds(
  answerType: string,
  answerConfig: any,
  betDecimalOdds: number | null,
  answer: any,
): number | null {
  if (answerType === "yes_no" && answer?.type === "yes_no") {
    const side = answer.value
      ? answerConfig?.decimalOddsYes
      : answerConfig?.decimalOddsNo;
    if (typeof side === "number" && Number.isFinite(side) && side > 1) return side;
  }
  if (answerType === "multi_choice" && answer?.type === "multi_choice") {
    const v = answerConfig?.decimalOddsByValue?.[answer.value];
    if (typeof v === "number" && Number.isFinite(v) && v > 1) return v;
  }
  if (betDecimalOdds != null && Number.isFinite(betDecimalOdds) && betDecimalOdds > 1) {
    return betDecimalOdds;
  }
  return null;
}

async function main() {
  console.log(`MODE: ${APPLY ? "APPLY (writes to PROD)" : "DRY RUN"}`);

  const [s] = (await rest(
    "settings?id=eq.1&select=live_odds_house_edge_pct,live_odds_max_payout_ratio,live_odds_max_payout_ceiling",
  )) as any[];
  const houseEdgePct = s.live_odds_house_edge_pct;
  const ratio = s.live_odds_max_payout_ratio;
  const oldCeiling = s.live_odds_max_payout_ceiling || 100; // pre-flip value
  console.log(
    `settings: houseEdgePct=${houseEdgePct} ratio=${ratio} oldCeiling=${oldCeiling}`,
  );

  const bets = (await rest(
    `custom_bets?match_id=eq.${MATCH_ID}&scope=eq.match&select=id,question_he,answer_type,answer_config,decimal_odds,payout_snapshot,resolved_value,status`,
  )) as any[];

  const changes: any[] = [];
  const mismatches: any[] = [];
  let picksTotal = 0;

  for (const b of bets) {
    const picks = (await rest(
      `user_custom_bet_picks?custom_bet_id=eq.${b.id}&select=id,user_id,answer,stake_paid,payout_snapshot,was_correct,points_earned`,
    )) as any[];
    picksTotal += picks.length;
    const betOdds = b.decimal_odds == null ? null : Number(b.decimal_odds);

    for (const p of picks) {
      const odds = optionOdds(b.answer_type, b.answer_config, betOdds, p.answer);
      if (odds == null) continue; // legacy no-odds pick — untouched

      const cappedCap = liveStakeCap(p.stake_paid, {
        maxPayoutRatio: ratio,
        maxPayoutCeiling: oldCeiling,
      });
      const uncappedCap = liveStakeCap(p.stake_paid, {
        maxPayoutRatio: ratio,
        maxPayoutCeiling: 0, // no ceiling
      });
      const capped = normalizeOdds(odds, {
        baseStake: p.stake_paid,
        maxPayout: cappedCap,
        houseEdgePct,
      }).payout;
      const uncapped = normalizeOdds(odds, {
        baseStake: p.stake_paid,
        maxPayout: uncappedCap,
        houseEdgePct,
      }).payout;

      // Sanity: the capped recompute must reproduce what was stored.
      if (capped !== p.payout_snapshot) {
        mismatches.push({
          betId: b.id.slice(0, 8),
          pickId: p.id.slice(0, 8),
          stake: p.stake_paid,
          odds,
          recomputedCapped: capped,
          storedPayout: p.payout_snapshot,
        });
      }

      // Only winners whose uncapped payout beats their stored points change.
      if (p.was_correct && uncapped > (p.points_earned ?? 0)) {
        changes.push({
          betId: b.id,
          betQ: b.question_he,
          pickId: p.id,
          userId: p.user_id,
          stake: p.stake_paid,
          odds,
          oldPayout: p.payout_snapshot,
          newPayout: uncapped,
          oldPts: p.points_earned,
          newPts: uncapped,
          deltaPts: uncapped - (p.points_earned ?? 0),
        });
      }
    }
  }

  // Resolve display names for the change set.
  const userIds = Array.from(new Set(changes.map((c) => c.userId)));
  const profiles = userIds.length
    ? ((await rest(
        `profiles?id=in.(${userIds.join(",")})&select=id,display_name`,
      )) as any[])
    : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));

  console.log(`\nBets: ${bets.length}  Picks scanned: ${picksTotal}`);
  console.log(`Sanity mismatches (capped recompute != stored): ${mismatches.length}`);
  if (mismatches.length) {
    console.log(JSON.stringify(mismatches, null, 2));
    console.error(
      "\nABORT: stored payouts do not reproduce under the assumed edge/ratio. " +
        "Do NOT apply — investigate before writing.",
    );
    process.exit(1);
  }

  console.log(`\nPicks to change (winners the ceiling clipped): ${changes.length}`);
  let poolDelta = 0;
  for (const c of changes) {
    poolDelta += c.deltaPts;
    console.log(
      `  ${(nameById.get(c.userId) ?? c.userId.slice(0, 8)).padEnd(16)} ` +
        `"${c.betQ}"  stake=${c.stake} odds=${c.odds}  ` +
        `pts ${c.oldPts} → ${c.newPts}  (+${c.deltaPts})`,
    );
  }
  console.log(`\nTotal points added to the pool: +${poolDelta}`);

  if (!APPLY) {
    console.log("\nDRY RUN complete. Re-run with --apply to write.");
    return;
  }
  if (!changes.length) {
    console.log("\nNothing to change.");
    return;
  }

  // Backup before-state for reversibility.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `_scripts/resettle-mex-rsa-backup-${stamp}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify(
      changes.map((c) => ({
        pickId: c.pickId,
        userId: c.userId,
        betId: c.betId,
        before: { payout_snapshot: c.oldPayout, points_earned: c.oldPts },
        after: { payout_snapshot: c.newPayout, points_earned: c.newPts },
      })),
      null,
      2,
    ),
  );
  console.log(`\nBackup written: ${backupPath}`);

  // Resolve an admin profile for the audit trail's performed_by FK.
  const [admin] = (await rest(
    "profiles?role=eq.admin&select=id&limit=1",
  )) as any[];

  for (const c of changes) {
    await rest(`user_custom_bet_picks?id=eq.${c.pickId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        payout_snapshot: c.newPayout,
        points_earned: c.newPts,
        updated_at: new Date().toISOString(),
      }),
    });
    console.log(
      `  [written] pick ${c.pickId.slice(0, 8)} pts ${c.oldPts} → ${c.newPts}`,
    );
  }

  // One audit row per affected bet.
  const betIds = Array.from(new Set(changes.map((c) => c.betId)));
  if (admin?.id) {
    for (const betId of betIds) {
      await rest("bet_grading_audit", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        // action is constrained to grade|reverse|cancel (migration 0009);
        // a re-settle is a re-grade with a higher payout.
        body: JSON.stringify({
          custom_bet_id: betId,
          action: "grade",
          previous_status: "graded",
          new_status: "graded",
          reason:
            "Re-settled without the 100-pt payout ceiling (migration 0055). " +
            "Odds unchanged; bigger stakes now win proportionally more.",
          performed_by: admin.id,
        }),
      });
    }
    console.log(`\nAudit rows written: ${betIds.length}`);
  } else {
    console.warn("\nNo admin profile found — skipped DB audit rows (backup file still written).");
  }

  console.log("\nAPPLY complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
