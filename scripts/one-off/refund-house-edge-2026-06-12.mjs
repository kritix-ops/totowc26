#!/usr/bin/env node
// One-off: zero out the 5% live-bet house edge retroactively.
//
// Why this exists: the setting was already turned off on 2026-06-12
// 21:46, but pending picks (placed before the change) still carry a
// payout snapshot computed with the 5% trim, and already-paid winners
// got correspondingly fewer points. The user asked to fix both.
//
// Scope: live custom bets (scope in 'match', 'day') only. Outright /
// tournament / group bets price differently (see normalizeOutrightOdds)
// and use a different curve; they are explicitly out of scope here.
//
// Run modes:
//   DRY-RUN (default): prints the diff table per pick. No writes.
//   --apply           : applies the updates. Writes:
//     * user_custom_bet_picks.payout_snapshot for pending picks.
//     * custom_bets answer_config (payoutOverride*) + payout_snapshot
//       for open + locked bets so the bet card reflects the right
//       potential win to new pickers.
//     * point_adjustments rows for graded winners with delta > 0.
//
// Idempotent. Re-running after --apply writes nothing because the diff
// converges to zero. See _plans/2026-06-12-house-edge-duel-options-translation.md
// Part 1 for the design rationale.

import { config } from "dotenv";
config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const REASON = "house edge refund - retroactive 0% rollout";
// Admin issuing the refund. Sourced from profiles.role='admin' lookup.
// Required because point_adjustments.created_by is NOT NULL and references
// profiles(id). Yoav (the admin who flipped the setting) is the natural
// author of the refund.
const ADMIN_USER_ID = "7b6ff987-73de-4604-9390-1cb35fc9812b";

// Live cap config used for the pending-pick recompute. Mirrors the
// current production settings (ceiling=0 means no absolute cap, ratio
// is the only multiplier-side guard). Pulled live below so a future
// admin edit doesn't make this drift.
let pendingCfg = null;

// Cap config we assume was active at grading time for the graded
// winners. Ratio has been 8 since the variable-stake rollout; ceiling
// was 100 until the recent removal. Using the pre-removal numbers so
// the refund honors what the cap would have allowed at the time and
// doesn't accidentally bake in a separate change.
const GRADED_CFG = {
  maxPayoutRatio: 8,
  maxPayoutCeiling: 100,
};

// ---------- payout math (mirrors src/lib/odds-normalize.ts) ----------

function clampPositiveInt(value, min) {
  if (!Number.isFinite(value)) return min;
  const n = Math.floor(value);
  return n < min ? min : n;
}

function clampInRange(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function liveStakeCap(stake, config) {
  const ratio = clampPositiveInt(config.maxPayoutRatio, 1);
  const safeStake = clampPositiveInt(stake, 1);
  const ratioCap = safeStake * ratio;
  if (!Number.isFinite(config.maxPayoutCeiling) || config.maxPayoutCeiling <= 0) {
    return ratioCap;
  }
  const ceiling = clampPositiveInt(config.maxPayoutCeiling, ratio);
  return Math.min(ratioCap, ceiling);
}

function computeOddsPayout(decimalOdds, { notionalStake, maxPayout, houseEdgePct }) {
  const notional = clampPositiveInt(notionalStake, 1);
  const safeOdds = decimalOdds > 1 ? decimalOdds : 1.01;
  const houseEdgeFactor = (100 - clampInRange(houseEdgePct, 0, 50)) / 100;
  const rawPayout = notional * safeOdds * houseEdgeFactor;
  let payout = Math.floor(rawPayout + 0.5);
  const cap = clampPositiveInt(maxPayout, notional + 1);
  if (payout > cap) payout = cap;
  if (payout <= notional) payout = notional + 1;
  return payout;
}

function normalizeOdds(decimalOdds, { baseStake, maxPayout, houseEdgePct }) {
  const stake = clampPositiveInt(baseStake, 1);
  const payout = computeOddsPayout(decimalOdds, {
    notionalStake: stake,
    maxPayout,
    houseEdgePct,
  });
  return { stake, payout };
}

// ---------- REST helpers ----------

async function rest(path, init) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: init?.preferReturn ?? "return=minimal",
      ...((init?.headers) ?? {}),
    },
    method: init?.method ?? "GET",
    body: init?.body,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}: ${await res.text()}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------- pick odds resolution (mirrors write-core.resolveLiveOptionOdds) ----------

function resolveOptionOdds({ answerType, answerConfig, answer, betLevelDecimalOdds }) {
  if (answerType === "multi_choice" && answer?.type === "multi_choice") {
    const v = answerConfig?.decimalOddsByValue?.[answer.value];
    if (typeof v === "number" && Number.isFinite(v) && v > 1) return v;
    return null;
  }
  if (answerType === "yes_no" && answer?.type === "yes_no") {
    const side = answer.value ? answerConfig?.decimalOddsYes : answerConfig?.decimalOddsNo;
    if (typeof side === "number" && Number.isFinite(side) && side > 1) return side;
  }
  if (
    betLevelDecimalOdds != null &&
    Number.isFinite(betLevelDecimalOdds) &&
    betLevelDecimalOdds > 1
  ) {
    return betLevelDecimalOdds;
  }
  return null;
}

// ---------- main ----------

async function loadLiveCfg() {
  const [s] = await rest(
    "settings?id=eq.1&select=live_odds_max_payout_ratio,live_odds_max_payout_ceiling,live_odds_house_edge_pct",
  );
  pendingCfg = {
    maxPayoutRatio: s.live_odds_max_payout_ratio ?? 8,
    maxPayoutCeiling: s.live_odds_max_payout_ceiling ?? 0,
  };
  console.log(
    `[refund-house-edge] settings: houseEdgePct=${s.live_odds_house_edge_pct} ratio=${pendingCfg.maxPayoutRatio} ceiling=${pendingCfg.maxPayoutCeiling}`,
  );
  if (s.live_odds_house_edge_pct !== 0) {
    console.warn(
      `[refund-house-edge] WARNING: liveOddsHouseEdgePct is ${s.live_odds_house_edge_pct}, expected 0. Pending picks will be recomputed against current setting, which still trims.`,
    );
  }
}

async function loadLiveBets() {
  // Pending = open OR locked. Both can still receive picks (locked
  // grace auto-fill stops new picks but existing picks remain).
  // Graded = paid out, needs the point_adjustments fix.
  const rows = await rest(
    "custom_bets?scope=in.(match,day)&status=in.(open,locked,graded)&select=id,status,answer_type,answer_config,decimal_odds,payout_snapshot,stake_snapshot,question_he,scope",
  );
  return rows;
}

async function loadPicks(betIds) {
  if (betIds.length === 0) return [];
  const csv = betIds.join(",");
  return await rest(
    `user_custom_bet_picks?custom_bet_id=in.(${csv})&select=id,user_id,custom_bet_id,answer,stake_paid,payout_snapshot,points_earned,was_correct,locked`,
  );
}

// Idempotency for the graded-winner branch: the pick's payout_snapshot
// stays at the pre-refund value (we only add a point_adjustments row),
// so a naive re-run would diff +delta again and write a duplicate
// adjustment. Load every refund row we've already issued (keyed by
// the bet UUID embedded in the reason string) so we can skip them on
// the second pass. Pending-pick + bet-config writes ARE self-idempotent
// because they overwrite the source-of-truth column.
async function loadExistingRefunds() {
  // The bet id is recorded in the reason as `bet XXXXXXXX` (first 8
  // hex chars). Group by user + bet8 so a single user can't double-
  // collect on the same bet. PostgREST `like` is case-sensitive and the
  // URL parameter is decoded once - we put the literal `%` wildcard in
  // the string so encodeURIComponent turns it into `%25` over the wire.
  const rows = await rest(
    `point_adjustments?reason=like.${encodeURIComponent("house edge refund%")}&select=user_id,reason`,
  );
  const issued = new Set();
  for (const r of rows ?? []) {
    const m = String(r.reason).match(/bet ([0-9a-f]{8})/);
    if (m) issued.add(`${r.user_id}::${m[1]}`);
  }
  return issued;
}

function recomputePickPayout(bet, pick, cfg) {
  const odds = resolveOptionOdds({
    answerType: bet.answer_type,
    answerConfig: bet.answer_config ?? {},
    answer: pick.answer,
    betLevelDecimalOdds: bet.decimal_odds == null ? null : Number(bet.decimal_odds),
  });
  if (odds == null) return null; // legacy bet with no captured odds - skip
  const { payout } = normalizeOdds(odds, {
    baseStake: pick.stake_paid,
    maxPayout: liveStakeCap(pick.stake_paid, cfg),
    houseEdgePct: 0,
  });
  return payout;
}

function recomputeBetOptionPayouts(bet) {
  // Reprice every captured option in the bet's answer_config using the
  // BASE stake (the bet's snapshot stake) so the bet card displays the
  // right potential win to a new picker before they choose a stake.
  // Per-pick payouts still recompute against the user's chosen stake;
  // this is display-side only.
  const cfg = bet.answer_config ? { ...bet.answer_config } : {};
  const stake = bet.stake_snapshot ?? 3;
  const cap = liveStakeCap(stake, pendingCfg);
  let maxPayout = 0;
  let changed = false;

  if (bet.answer_type === "multi_choice" && cfg.decimalOddsByValue) {
    const next = {};
    for (const [key, odds] of Object.entries(cfg.decimalOddsByValue)) {
      const { payout } = normalizeOdds(odds, {
        baseStake: stake,
        maxPayout: cap,
        houseEdgePct: 0,
      });
      next[key] = payout;
      if (payout > maxPayout) maxPayout = payout;
    }
    if (JSON.stringify(cfg.payoutOverridesByValue) !== JSON.stringify(next)) {
      cfg.payoutOverridesByValue = next;
      changed = true;
    }
    if (Array.isArray(cfg.options)) {
      const opts = cfg.options.map((o) =>
        next[o.value] != null ? { ...o, payoutOverride: next[o.value] } : o,
      );
      if (JSON.stringify(opts) !== JSON.stringify(cfg.options)) {
        cfg.options = opts;
        changed = true;
      }
    }
  }

  if (bet.answer_type === "yes_no") {
    if (cfg.decimalOddsYes != null) {
      const { payout } = normalizeOdds(cfg.decimalOddsYes, {
        baseStake: stake,
        maxPayout: cap,
        houseEdgePct: 0,
      });
      if (cfg.payoutOverrideYes !== payout) {
        cfg.payoutOverrideYes = payout;
        changed = true;
      }
      if (payout > maxPayout) maxPayout = payout;
    }
    if (cfg.decimalOddsNo != null) {
      const { payout } = normalizeOdds(cfg.decimalOddsNo, {
        baseStake: stake,
        maxPayout: cap,
        houseEdgePct: 0,
      });
      if (cfg.payoutOverrideNo !== payout) {
        cfg.payoutOverrideNo = payout;
        changed = true;
      }
      if (payout > maxPayout) maxPayout = payout;
    }
  }

  return { config: cfg, maxPayout: maxPayout > 0 ? maxPayout : bet.payout_snapshot, changed };
}

async function main() {
  console.log(`[refund-house-edge] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`[refund-house-edge] database=${SUPABASE_URL}`);

  await loadLiveCfg();
  const bets = await loadLiveBets();
  const pendingBets = bets.filter((b) => b.status === "open" || b.status === "locked");
  const gradedBets = bets.filter((b) => b.status === "graded");
  console.log(
    `[refund-house-edge] bets: pending=${pendingBets.length} graded=${gradedBets.length}`,
  );

  const allPicks = await loadPicks(bets.map((b) => b.id));
  const picksByBetId = new Map();
  for (const p of allPicks) {
    if (!picksByBetId.has(p.custom_bet_id)) picksByBetId.set(p.custom_bet_id, []);
    picksByBetId.get(p.custom_bet_id).push(p);
  }
  const alreadyRefunded = await loadExistingRefunds();
  console.log(`[refund-house-edge] already refunded (user::bet8): ${alreadyRefunded.size}`);

  const pendingDiffs = [];
  const winnerAdjustments = [];
  const betConfigUpdates = [];

  for (const bet of bets) {
    const picks = picksByBetId.get(bet.id) ?? [];

    if (bet.status === "open" || bet.status === "locked") {
      // Bet-level display reprice (so new pickers see right numbers).
      const { config, maxPayout, changed } = recomputeBetOptionPayouts(bet);
      if (changed) {
        betConfigUpdates.push({
          betId: bet.id,
          question: bet.question_he?.slice(0, 50) ?? "",
          oldSnapshot: bet.payout_snapshot,
          newSnapshot: maxPayout,
          newConfig: config,
        });
      }
      // Pick-level snapshot reprice.
      for (const pick of picks) {
        const newPayout = recomputePickPayout(bet, pick, pendingCfg);
        if (newPayout == null) continue;
        if (newPayout !== pick.payout_snapshot) {
          pendingDiffs.push({
            pickId: pick.id,
            userId: pick.user_id,
            betId: bet.id,
            stake: pick.stake_paid,
            oldPayout: pick.payout_snapshot,
            newPayout,
            delta: newPayout - (pick.payout_snapshot ?? 0),
            betQ: bet.question_he?.slice(0, 40) ?? "",
          });
        }
      }
    } else if (bet.status === "graded") {
      for (const pick of picks) {
        if (pick.was_correct !== true) continue; // losers got nothing changed
        const newPayout = recomputePickPayout(bet, pick, GRADED_CFG);
        if (newPayout == null) continue;
        const delta = newPayout - (pick.payout_snapshot ?? 0);
        if (delta > 0) {
          const dedupKey = `${pick.user_id}::${bet.id.slice(0, 8)}`;
          if (alreadyRefunded.has(dedupKey)) continue; // already paid out
          winnerAdjustments.push({
            userId: pick.user_id,
            pickId: pick.id,
            betId: bet.id,
            stake: pick.stake_paid,
            paidPayout: pick.payout_snapshot,
            newPayout,
            delta,
          });
        }
      }
    }
  }

  // ---- report ----
  console.log(`\n=== Pending pick reprice ===`);
  console.log(`changes: ${pendingDiffs.length}`);
  let pendingDeltaSum = 0;
  for (const d of pendingDiffs) {
    pendingDeltaSum += d.delta;
    console.log(
      `  user=${d.userId.slice(0, 8)} bet=${d.betId.slice(0, 8)} stake=${d.stake}  ${d.oldPayout} -> ${d.newPayout}  (delta ${d.delta > 0 ? "+" : ""}${d.delta})  "${d.betQ}"`,
    );
  }
  console.log(`pending delta sum: ${pendingDeltaSum}`);

  console.log(`\n=== Bet display reprice (open/locked bets) ===`);
  console.log(`changes: ${betConfigUpdates.length}`);
  for (const u of betConfigUpdates) {
    console.log(
      `  bet=${u.betId.slice(0, 8)} snapshot ${u.oldSnapshot} -> ${u.newSnapshot}  "${u.question}"`,
    );
  }

  console.log(`\n=== Graded winner refunds ===`);
  console.log(`refunds: ${winnerAdjustments.length}`);
  let refundSum = 0;
  for (const a of winnerAdjustments) {
    refundSum += a.delta;
    console.log(
      `  user=${a.userId.slice(0, 8)} bet=${a.betId.slice(0, 8)} stake=${a.stake}  paid=${a.paidPayout} should=${a.newPayout}  refund +${a.delta}`,
    );
  }
  console.log(`refund total: +${refundSum} points`);

  if (!APPLY) {
    console.log(`\nDRY-RUN complete. Re-run with --apply to write the changes.`);
    return;
  }

  // ---- apply ----
  console.log(`\n[refund-house-edge] applying changes...`);

  for (const d of pendingDiffs) {
    await rest(`user_custom_bet_picks?id=eq.${d.pickId}`, {
      method: "PATCH",
      body: JSON.stringify({ payout_snapshot: d.newPayout }),
    });
    console.info(
      `[refund-house-edge apply pending] pickId=${d.pickId} oldPayout=${d.oldPayout} newPayout=${d.newPayout} delta=${d.delta}`,
    );
  }

  for (const u of betConfigUpdates) {
    await rest(`custom_bets?id=eq.${u.betId}`, {
      method: "PATCH",
      body: JSON.stringify({
        answer_config: u.newConfig,
        payout_snapshot: u.newSnapshot,
      }),
    });
    console.info(
      `[refund-house-edge apply bet] betId=${u.betId} newSnapshot=${u.newSnapshot}`,
    );
  }

  for (const a of winnerAdjustments) {
    // point_adjustments shape: { user_id, delta, reason, created_by? }
    // The bank reads them straight into the balance, so a positive
    // delta credits the user.
    await rest(`point_adjustments`, {
      method: "POST",
      body: JSON.stringify({
        user_id: a.userId,
        delta: a.delta,
        reason: `${REASON} (bet ${a.betId.slice(0, 8)})`,
        created_by: ADMIN_USER_ID,
      }),
    });
    console.info(
      `[refund-house-edge apply adjustment] userId=${a.userId} delta=+${a.delta} reason="${REASON}"`,
    );
  }

  console.log(`\n[refund-house-edge] done. wrote ${pendingDiffs.length} pending updates, ${betConfigUpdates.length} bet configs, ${winnerAdjustments.length} refund adjustments.`);
}

main().catch((err) => {
  console.error("[refund-house-edge] fatal", err);
  process.exit(1);
});
