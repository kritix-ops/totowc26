// One-off READ-ONLY audit. No writes anywhere.
//
// Context: prod was regressed today between roughly 16:45 (cron-ping commit
// landed on master and Vercel auto-redeployed master, which was missing
// every 2026-06-11 sandbox commit) and 18:26 (operator re-promoted sandbox
// via /he/admin/sandbox). During that window:
//   - The admin /he/admin/bets form rendered the OLD code → no decimal_odds
//     field, so any live (match/day) bet created in that window has
//     custom_bets.decimal_odds = NULL.
//   - The player /he/bets/live cards rendered the OLD code → fixed stake of 3
//     and no 1-30 pill selector, so any user_custom_bet_picks placed in that
//     window paid stake_snapshot = 3 by default.
//
// This audit answers three questions, in priority order:
//   1) How many live-scope custom_bets were created today, and of those how
//      many are still missing decimal_odds?
//   2) How many player picks landed on those decimal_odds-missing bets?
//   3) What stake / payout snapshots do those picks carry?
//
// Why READ-ONLY: per memory feedback_user_bets_are_sacred, we never silently
// mutate placed picks. The audit only surfaces what's at risk; any repair
// (admin re-edits the bet to add decimal_odds, leaves player picks intact)
// is a human decision after seeing these numbers.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("[audit] missing SUPABASE env. abort.");
  process.exit(1);
}
const s = createClient(url, key);

const ENV_HINT = url.includes("sandbox") ? "SANDBOX" : "PROD (or non-sandbox)";
console.info(`[audit env] ${ENV_HINT} - ${url}`);

// Asia/Jerusalem 00:00 of 2026-06-11 = 2026-06-10T21:00:00Z (UTC+3 summer).
const DAY_START_UTC = "2026-06-10T21:00:00Z";

const { data: liveBetsToday, error: betsErr } = await s
  .from("custom_bets")
  .select(
    "id, scope, question_he, stake_snapshot, payout_snapshot, decimal_odds, created_at, lock_at, status",
  )
  .in("scope", ["match", "day"])
  .gte("created_at", DAY_START_UTC)
  .order("created_at", { ascending: true });

if (betsErr) {
  console.error("[audit] failed to read custom_bets:", betsErr.message);
  process.exit(1);
}

const total = liveBetsToday.length;
const missingOdds = liveBetsToday.filter((b) => b.decimal_odds == null);

console.info("");
console.info("=== live (match/day) custom_bets created today (Jerusalem) ===");
console.info(`total:                ${total}`);
console.info(`missing decimal_odds: ${missingOdds.length}`);
console.info("");

if (missingOdds.length === 0) {
  console.info("[audit] no structurally at-risk bets (all have decimal_odds).");
  console.info("[audit] continuing to inspect player picks for fixed-stake");
  console.info("[audit] placements during the 16:45-18:26 regression window.");
  console.info("");
}

const allLiveBetIds = liveBetsToday.map((b) => b.id);

const { data: allPicks, error: allPicksErr } = await s
  .from("user_custom_bet_picks")
  .select(
    "id, user_id, custom_bet_id, stake_paid, payout_snapshot, points_earned, was_correct, locked, created_at, updated_at",
  )
  .in("custom_bet_id", allLiveBetIds)
  .order("created_at", { ascending: true });

if (allPicksErr) {
  console.error("[audit] failed to read all picks:", allPicksErr.message);
  process.exit(1);
}

console.info("=== player picks on today's live bets (all) ===");
console.info(`total picks: ${allPicks.length}`);
const stakeBuckets = new Map();
for (const p of allPicks) {
  stakeBuckets.set(p.stake_paid, (stakeBuckets.get(p.stake_paid) ?? 0) + 1);
}
for (const [stake, n] of [...stakeBuckets.entries()].sort((a, b) => a[0] - b[0])) {
  console.info(`  stake_paid=${stake}: ${n} picks`);
}

const REGRESSION_START = "2026-06-11T13:45:00Z"; // 16:45 Asia/Jerusalem
const REGRESSION_END = "2026-06-11T15:26:00Z"; // 18:26 Asia/Jerusalem
const inWindow = allPicks.filter(
  (p) => p.created_at >= REGRESSION_START && p.created_at <= REGRESSION_END,
);
console.info("");
console.info(
  `=== picks placed in regression window (${REGRESSION_START} - ${REGRESSION_END}) ===`,
);
console.info(`count: ${inWindow.length}`);
if (inWindow.length > 0) {
  for (const p of inWindow) {
    const bet = liveBetsToday.find((b) => b.id === p.custom_bet_id);
    console.info(
      `  user=${p.user_id.slice(0, 8)} bet=${p.custom_bet_id.slice(0, 8)} stake_paid=${p.stake_paid} payout_snap=${p.payout_snapshot} locked=${p.locked} created=${p.created_at}`,
    );
  }
}

if (missingOdds.length === 0) {
  console.info("");
  console.info("[audit] DONE.");
  process.exit(0);
}

const atRiskIds = missingOdds.map((b) => b.id);

const { data: picks, error: picksErr } = await s
  .from("user_custom_bet_picks")
  .select(
    "id, user_id, custom_bet_id, stake_paid, payout_snapshot, payout_outcome, status, created_at",
  )
  .in("custom_bet_id", atRiskIds);

if (picksErr) {
  console.error("[audit] failed to read picks:", picksErr.message);
  process.exit(1);
}

const byBet = new Map();
for (const p of picks) {
  if (!byBet.has(p.custom_bet_id)) byBet.set(p.custom_bet_id, []);
  byBet.get(p.custom_bet_id).push(p);
}

console.info("=== bets at risk + player picks on each ===");
for (const b of missingOdds) {
  const ps = byBet.get(b.id) ?? [];
  const totalStake = ps.reduce((a, p) => a + (p.stake_paid ?? 0), 0);
  const distinctUsers = new Set(ps.map((p) => p.user_id)).size;
  console.info(
    [
      `  ${b.id.slice(0, 8)}`,
      `[${b.scope}]`,
      `snap=${b.stake_snapshot}/${b.payout_snapshot}`,
      `status=${b.status}`,
      `picks=${ps.length} (users=${distinctUsers}, totalStake=${totalStake})`,
      `q="${b.question_he.slice(0, 60)}${b.question_he.length > 60 ? "…" : ""}"`,
    ].join(" "),
  );
}

console.info("");
console.info("=== summary ===");
console.info(`bets at risk:        ${missingOdds.length}`);
console.info(`player picks landed: ${picks.length}`);
console.info(
  `distinct players:    ${new Set(picks.map((p) => p.user_id)).size}`,
);
console.info(
  `total points staked: ${picks.reduce((a, p) => a + (p.stake_paid ?? 0), 0)}`,
);
console.info("");
console.info("[audit] DONE. No writes performed. To repair: admin edits each");
console.info("[audit] bet's decimal_odds via /he/admin/bets/<id>/edit. Player");
console.info("[audit] picks remain untouched (sacred).");
