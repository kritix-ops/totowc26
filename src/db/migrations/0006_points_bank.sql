-- Points bank ("Stake & Payout") system.
--
-- Every user starts with a bank (default 100 pts). Every action beyond the
-- main 1/X/2 pick costs a stake, deducted at submit time. Correct → full
-- payout. Wrong → stake is lost. Admin can adjust any user's bank with an
-- audited append-only log.
--
-- This migration:
--   1. Adds tunable points-bank settings (starting_bank + per-action stakes)
--   2. Bumps existing scoring payouts so net = payout − stake matches the
--      old free-bet payouts (e.g. BTTS 2 → 3 with stake 1 = net +2 right /
--      −1 wrong, matching the pre-migration "+2 / 0" feel but with risk).
--   3. Adds per-row stake snapshots to every bet table so future setting
--      changes do not retroactively re-price existing bets.
--   4. Creates the point_adjustments audit log with REVOKE UPDATE/DELETE
--      from client roles so admin corrections must be additive only.
--   5. Resets tournament-level picks (special_bets, bracket_predictions,
--      group_predictions) and clears side bets on existing match_bets rows
--      so everyone re-submits under the new pricing.
--
-- See _plans/2026-05-25-points-bank-system.md for the full design.

-- 1) Settings: starting bank, all stake costs, new per-team group payout.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "starting_bank"             smallint NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "stake_main"                smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "stake_btts"                smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "stake_over_25"             smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "stake_ht"                  smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "stake_group_team"          smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "stake_bracket_champion"    smallint NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "stake_bracket_runner_up"   smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "stake_bracket_third"       smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "stake_bracket_fourth"      smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "stake_top_scorer"          smallint NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "stake_final_penalties"     smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "scoring_group_team"        smallint NOT NULL DEFAULT 3;
--> statement-breakpoint

-- 2) Bump existing scoring payouts so net (payout − stake) preserves the
-- pre-migration feel of a correct bet. Only update rows that still hold the
-- OLD default - if the admin has already tuned a value, leave it alone.
UPDATE "settings" SET "scoring_btts"             = 3  WHERE id = 1 AND "scoring_btts"             = 2;
UPDATE "settings" SET "scoring_over_25"          = 3  WHERE id = 1 AND "scoring_over_25"          = 2;
UPDATE "settings" SET "scoring_ht_exact"         = 8  WHERE id = 1 AND "scoring_ht_exact"         = 5;
UPDATE "settings" SET "scoring_ht_outcome"       = 5  WHERE id = 1 AND "scoring_ht_outcome"       = 2;
UPDATE "settings" SET "scoring_champion"         = 30 WHERE id = 1 AND "scoring_champion"         = 25;
UPDATE "settings" SET "scoring_runner_up"        = 18 WHERE id = 1 AND "scoring_runner_up"        = 15;
UPDATE "settings" SET "scoring_third"            = 10 WHERE id = 1 AND "scoring_third"            = 8;
UPDATE "settings" SET "scoring_fourth"           = 7  WHERE id = 1 AND "scoring_fourth"           = 5;
UPDATE "settings" SET "scoring_top_scorer"       = 25 WHERE id = 1 AND "scoring_top_scorer"       = 20;
UPDATE "settings" SET "scoring_final_penalties"  = 13 WHERE id = 1 AND "scoring_final_penalties"  = 10;
UPDATE "settings" SET "scoring_group_perfect"    = 8  WHERE id = 1 AND "scoring_group_perfect"    = 20;
--> statement-breakpoint

-- Also update the column defaults so a fresh seed/install reflects the new
-- pricing, not the legacy values.
ALTER TABLE "settings" ALTER COLUMN "scoring_btts"            SET DEFAULT 3;
ALTER TABLE "settings" ALTER COLUMN "scoring_over_25"         SET DEFAULT 3;
ALTER TABLE "settings" ALTER COLUMN "scoring_ht_exact"        SET DEFAULT 8;
ALTER TABLE "settings" ALTER COLUMN "scoring_ht_outcome"      SET DEFAULT 5;
ALTER TABLE "settings" ALTER COLUMN "scoring_champion"        SET DEFAULT 30;
ALTER TABLE "settings" ALTER COLUMN "scoring_runner_up"       SET DEFAULT 18;
ALTER TABLE "settings" ALTER COLUMN "scoring_third"           SET DEFAULT 10;
ALTER TABLE "settings" ALTER COLUMN "scoring_fourth"          SET DEFAULT 7;
ALTER TABLE "settings" ALTER COLUMN "scoring_top_scorer"      SET DEFAULT 25;
ALTER TABLE "settings" ALTER COLUMN "scoring_final_penalties" SET DEFAULT 13;
ALTER TABLE "settings" ALTER COLUMN "scoring_group_perfect"   SET DEFAULT 8;
--> statement-breakpoint

-- 3) Per-row stake snapshots on every bet table. Snapshot captures the
-- settings value at submit time so future setting changes do not rewrite
-- the cost of a bet already on the books.

-- match_bets: side bets are optional, so each stake column is nullable -
-- null means "user did not opt into this side bet".
ALTER TABLE "match_bets"
  ADD COLUMN IF NOT EXISTS "stake_paid_btts"     smallint,
  ADD COLUMN IF NOT EXISTS "stake_paid_over_25"  smallint,
  ADD COLUMN IF NOT EXISTS "stake_paid_ht"       smallint;
--> statement-breakpoint

-- group_predictions / bracket_predictions / special_bets: always paid when
-- the row exists. Default 0 covers the empty truncated table; new inserts
-- will write the actual snapshot from settings at submit time.
ALTER TABLE "group_predictions"
  ADD COLUMN IF NOT EXISTS "stake_paid" smallint NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "bracket_predictions"
  ADD COLUMN IF NOT EXISTS "stake_paid" smallint NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "special_bets"
  ADD COLUMN IF NOT EXISTS "stake_paid" smallint NOT NULL DEFAULT 0;
--> statement-breakpoint

-- 4) Append-only audit log of admin bank adjustments.
CREATE TABLE IF NOT EXISTS "point_adjustments" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "delta"       integer NOT NULL,
  "reason"      text NOT NULL,
  "created_by"  uuid NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "point_adj_reason_not_empty" CHECK (length(reason) >= 3),
  CONSTRAINT "point_adj_delta_nonzero"    CHECK (delta <> 0),
  CONSTRAINT "point_adj_delta_capped"     CHECK (abs(delta) <= 500)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "point_adjustments_user_idx"
  ON "point_adjustments" ("user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "point_adjustments_created_idx"
  ON "point_adjustments" ("created_at" DESC);
--> statement-breakpoint

-- RLS: users see their own audit rows; admins see all and may INSERT only.
ALTER TABLE "point_adjustments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "point_adj read own" ON "point_adjustments"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY "point_adj admin read" ON "point_adjustments"
  FOR SELECT TO authenticated
  USING (public.is_admin());
--> statement-breakpoint

CREATE POLICY "point_adj admin insert" ON "point_adjustments"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND created_by = auth.uid());
--> statement-breakpoint

-- Immutability: REVOKE UPDATE/DELETE from every client role. Cascade
-- DELETE from profiles still works because the Drizzle pool connects as
-- the postgres superuser which bypasses these grants.
REVOKE UPDATE, DELETE ON "point_adjustments" FROM authenticated;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "point_adjustments" FROM anon;
--> statement-breakpoint

-- 5) Reset tournament-level picks so every paid user re-submits under the
-- new pricing. main score picks in match_bets are preserved (the main bet
-- is FREE), but the optional side-bet columns are cleared so users opt in
-- again, now with a cost attached.
TRUNCATE TABLE "special_bets"        RESTART IDENTITY;
--> statement-breakpoint
TRUNCATE TABLE "bracket_predictions" RESTART IDENTITY;
--> statement-breakpoint
TRUNCATE TABLE "group_predictions"   RESTART IDENTITY;
--> statement-breakpoint

UPDATE "match_bets" SET
  "bet_btts"        = NULL,
  "bet_over_25"     = NULL,
  "bet_ht_home"     = NULL,
  "bet_ht_away"     = NULL,
  "points_btts"     = NULL,
  "points_over_25"  = NULL,
  "points_ht"       = NULL
WHERE "bet_btts"     IS NOT NULL
   OR "bet_over_25"  IS NOT NULL
   OR "bet_ht_home"  IS NOT NULL
   OR "bet_ht_away"  IS NOT NULL
   OR "points_btts"  IS NOT NULL
   OR "points_over_25" IS NOT NULL
   OR "points_ht"    IS NOT NULL;
