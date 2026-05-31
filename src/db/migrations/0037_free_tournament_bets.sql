-- Free tournament bets + rescaled outright payouts.
--
-- Two changes in one migration, both surgical:
--
--   1. Drop the 3-point stake on every tournament/stage/group-scope bet.
--      These are single-pick outright markets that lock early; the stake
--      throttled nothing and turned every pick into a tax.
--
--   2. Cap pre-existing bet-level payout snapshots at the new outright
--      ceiling (OUTRIGHT_MAX_PAYOUT = 25). Bets that currently carry a
--      60-point fallback ("longshot default") drop to 25, matching the
--      live-odds default cap and the new publish flow.
--
-- Per-option payout overrides inside custom_bets.answer_config.
-- payoutOverridesByValue are NOT rewritten by this SQL migration; the
-- per-option rescale needs the JS odds-multiplication formula and runs
-- via scripts/migrate-tournament-payouts.ts as a one-shot follow-up.
--
-- User_custom_bet_picks: any pick already placed on a free-scope bet
-- gets its stake_paid zeroed. The bank formula reads
-- sum(payout - stake_paid), so the in-flight debit simply reverses; no
-- point_adjustments row is needed (this is a policy change, not an admin
-- correction).
--
-- Defensive on both updates:
--   - skip graded picks (points_earned IS NOT NULL) so already-settled
--     history is untouched.
--   - skip cancelled / reversed bets so we do not rewrite the dead.
--
-- See _plans/2026-05-31-free-tournament-bets-and-rescaled-payouts.md.

-- A. Re-price open tournament/stage/group bets at the new scale.
--    least(25, …) only ever lowers a payout snapshot; bets already at
--    or below the cap are unchanged.
UPDATE public.custom_bets
SET
  stake_snapshot   = 0,
  payout_snapshot  = LEAST(25, payout_snapshot)
WHERE scope IN ('tournament', 'stage', 'group')
  AND status IN ('draft', 'open', 'locked');
--> statement-breakpoint

-- B. Refund any in-flight stake on existing picks for those bets, and
--    clamp the locked-in per-pick payout snapshot at the new cap so a
--    pick made under the old scale (e.g. Haaland at 43) pays no more
--    than the new ceiling. Favourites that were already below 25 stay
--    where they are — re-running the publish flow via
--    scripts/auto-publish-outright.mjs after this migration rewrites
--    the bet's answer_config to the proper new per-option prices, and
--    any pick updates from then on snapshot the new value.
--
--    points_earned IS NULL filters out anything already settled (none
--    should exist pre-tournament, but the filter keeps the migration
--    safe to re-run if needed).
UPDATE public.user_custom_bet_picks pk
SET
  stake_paid     = 0,
  payout_snapshot = LEAST(25, COALESCE(pk.payout_snapshot, 25))
FROM public.custom_bets b
WHERE pk.custom_bet_id = b.id
  AND b.scope IN ('tournament', 'stage', 'group')
  AND pk.points_earned IS NULL
  AND (pk.stake_paid > 0 OR pk.payout_snapshot > 25);
