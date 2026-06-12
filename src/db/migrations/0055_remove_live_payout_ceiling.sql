-- Allow disabling the absolute live-bet payout ceiling.
--
-- The live payout cap was min(stake * ratio, ceiling) with ceiling = 100.
-- That flat ceiling punished bigger stakes: on the MEX–RSA VAR red-card
-- bet (×6) a player who staked 30 and a player who staked 20 both hit the
-- 100 cap, so the bigger staker risked more for the SAME prize and netted
-- less. The user has chosen to drop the absolute ceiling while keeping the
-- per-stake ratio guard (stake * ratio) as the overflow backstop.
--
-- Representation: ceiling = 0 is the documented "no absolute cap" sentinel,
-- read by liveStakeCap() in src/lib/odds-normalize.ts. This migration only
-- WIDENS the CHECK so 0 becomes a legal value — it does NOT flip the value.
--
-- Why not flip here: liveStakeCap() must understand the 0 sentinel BEFORE
-- the value is 0, or the old code would read 0 and cap every live payout at
-- `ratio`. So this migration ships with the code (safe no-op: value stays
-- 100), and the ceiling is flipped to 0 deliberately AFTER the new code is
-- live — from /admin/settings/scoring (the field now accepts 0) or a
-- one-line UPDATE. See _plans/2026-06-12-remove-live-payout-ceiling.md.

ALTER TABLE "settings"
  DROP CONSTRAINT IF EXISTS "live_odds_payout_caps_chk";

ALTER TABLE "settings"
  ADD CONSTRAINT "live_odds_payout_caps_chk"
  CHECK (
    "live_odds_max_payout_ratio" >= 1
    AND (
      "live_odds_max_payout_ceiling" = 0
      OR (
        "live_odds_max_payout_ceiling" >= "live_odds_max_payout_ratio"
        AND "live_odds_max_payout_ceiling" <= 32000
      )
    )
  );

COMMENT ON COLUMN "settings"."live_odds_max_payout_ceiling" IS
  'Absolute upper bound on gross payout regardless of stake. 0 = no ceiling (the per-stake ratio guard is the only cap). Otherwise must be in [ratio, 32000].';
