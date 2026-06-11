-- Variable player-chosen stake on live (match/day) custom bets.
--
-- Today live bets charge the global live_odds_base_stake (default 3) to
-- every player on every bet. Players now pick how much to risk per bet
-- (1..30 by default), and the payout scales with their stake under a
-- bounded ceiling.
--
-- Changes in this migration:
--   1. Four new settings knobs for the stake bounds and the new
--      "ratio + absolute ceiling" payout cap formula.
--   2. live_odds_max_payout (the previous single cap) is KEPT for one
--      cycle in case we need to roll back the new caps. It is no longer
--      consulted by the live path.
--   3. Force daily_renewal_enabled = false on row 1. Variable stake
--      raises the per-bet downside; the user has explicitly chosen to
--      let players own that risk without an automatic safety net.
--   4. custom_bets.decimal_odds — new nullable column carrying the
--      original bookmaker odds the bet was published against. Required
--      at publish time for live (match/day) scope so the submit path
--      can recompute payout exactly for any player-chosen stake;
--      free-pick scopes (tournament/stage/group) stay NULL (their
--      payouts come from the per-option curve, not from a single odds
--      value).
--
-- No backfill block: the World Cup starts today (2026-06-11) and the
-- live-bet surface has no published custom_bets rows yet. New rows from
-- this point write decimal_odds at publish (see
-- src/app/[lang]/admin/live-bets/suggestions/actions.ts).
--
-- See _plans/2026-06-11-variable-live-bet-stake.md.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "live_odds_min_stake"          smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "live_odds_max_stake"          smallint NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "live_odds_max_payout_ratio"   smallint NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS "live_odds_max_payout_ceiling" smallint NOT NULL DEFAULT 100;

ALTER TABLE "settings"
  ADD CONSTRAINT "live_odds_stake_range_chk"
  CHECK (
    "live_odds_min_stake" >= 1
    AND "live_odds_max_stake" >= "live_odds_min_stake"
    AND "live_odds_max_stake" <= 100
  );

ALTER TABLE "settings"
  ADD CONSTRAINT "live_odds_payout_caps_chk"
  CHECK (
    "live_odds_max_payout_ratio" >= 1
    AND "live_odds_max_payout_ceiling" >= "live_odds_max_payout_ratio"
    AND "live_odds_max_payout_ceiling" <= 32000
  );

-- Per the user's confirmed scope: disable the daily renewal cron. The
-- column stays so a future tournament can flip it back on without a
-- schema change.
UPDATE "settings" SET "daily_renewal_enabled" = false WHERE "id" = 1;

ALTER TABLE "custom_bets"
  ADD COLUMN IF NOT EXISTS "decimal_odds" numeric(6,2) NULL;

-- A live (match/day) bet without decimal_odds cannot price a
-- player-chosen stake. Free-pick scopes (tournament/stage/group) must
-- stay NULL because their per-option payouts come from buildOutrightCurve.
ALTER TABLE "custom_bets"
  ADD CONSTRAINT "custom_bets_decimal_odds_scope_chk"
  CHECK (
    (scope IN ('match', 'day') AND (decimal_odds IS NULL OR decimal_odds > 1))
    OR
    (scope IN ('tournament', 'stage', 'group') AND decimal_odds IS NULL)
  );

COMMENT ON COLUMN "custom_bets"."decimal_odds" IS
  'Bookmaker decimal odds the bet was published against. Live (match/day) scope reads this at submit to recompute payout for the player-chosen stake. Free-pick scopes keep it NULL.';

COMMENT ON COLUMN "settings"."live_odds_min_stake" IS
  'Minimum stake (in points) a player may pick for a single live bet. Default 1.';
COMMENT ON COLUMN "settings"."live_odds_max_stake" IS
  'Maximum stake (in points) a player may pick for a single live bet. Default 30 = whole starting bank in one bet.';
COMMENT ON COLUMN "settings"."live_odds_max_payout_ratio" IS
  'Per-stake-unit cap on gross payout. effective_cap = min(stake * ratio, ceiling). Default 8 preserves the legacy ~8x relationship at stake=3.';
COMMENT ON COLUMN "settings"."live_odds_max_payout_ceiling" IS
  'Absolute upper bound on gross payout regardless of stake. Default 100 so a single bet cannot decide the tournament.';
