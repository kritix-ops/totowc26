-- Drop the legacy bet system. Pure cleanup - no data migration needed
-- because every legacy table was empty when this ran (verified by a
-- one-off introspection script, all four tables held 0 rows).
--
-- What goes:
--   • Tables       : special_bets, bracket_predictions, group_predictions,
--                    tournament_results
--   • match_bets   : BTTS / Over 2.5 / halftime side-bet columns and
--                    their stake/points snapshot siblings
--   • settings     : every scoring_* / stake_* column whose only consumer
--                    was a legacy table (BTTS, over25, ht, group rank,
--                    bracket slots, top scorer, final penalties). Main
--                    1/X/2 + new custom-bets defaults stay.
--   • sync_runs    : scored_specials column (no more writer)
--   • Enums        : bracket_slot, special_bet_type. "stage" stays - it
--                    is used by matches and custom_bets.
--
-- The full design lives in _plans/2026-05-25-matchday-custom-bets-system.md
-- §10.1. This is the follow-up migration the plan called for, executed
-- earlier than scheduled because the data picture made it safe.

-- 1) Drop legacy bet tables. CASCADE keeps the migration robust even if
-- some downstream policy / dependent object slipped in.
DROP TABLE IF EXISTS "special_bets"        CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "bracket_predictions" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "group_predictions"   CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "tournament_results"  CASCADE;
--> statement-breakpoint

-- 2) Drop per-row side-bet columns from match_bets. The main 1/X/2 pick
-- (home_score, away_score, points_earned, was_exact, was_correct_outcome,
-- locked) is untouched.
ALTER TABLE "match_bets"
  DROP COLUMN IF EXISTS "bet_btts",
  DROP COLUMN IF EXISTS "bet_over_25",
  DROP COLUMN IF EXISTS "bet_ht_home",
  DROP COLUMN IF EXISTS "bet_ht_away",
  DROP COLUMN IF EXISTS "points_btts",
  DROP COLUMN IF EXISTS "points_over_25",
  DROP COLUMN IF EXISTS "points_ht",
  DROP COLUMN IF EXISTS "stake_paid_btts",
  DROP COLUMN IF EXISTS "stake_paid_over_25",
  DROP COLUMN IF EXISTS "stake_paid_ht";
--> statement-breakpoint

-- 3) Drop legacy scoring + stake columns from settings. Everything kept
-- now belongs to either the main bet (scoring_exact, scoring_outcome,
-- stake_main, starting_bank), the new custom-bets system (stake_yes_no
-- and friends), or to operational config (entry_fee_ils, paybox_url,
-- bet_lock_minutes, prize_pct_1..4).
ALTER TABLE "settings"
  DROP COLUMN IF EXISTS "scoring_btts",
  DROP COLUMN IF EXISTS "scoring_over_25",
  DROP COLUMN IF EXISTS "scoring_ht_exact",
  DROP COLUMN IF EXISTS "scoring_ht_outcome",
  DROP COLUMN IF EXISTS "stake_btts",
  DROP COLUMN IF EXISTS "stake_over_25",
  DROP COLUMN IF EXISTS "stake_ht",
  DROP COLUMN IF EXISTS "scoring_top_scorer",
  DROP COLUMN IF EXISTS "scoring_final_penalties",
  DROP COLUMN IF EXISTS "stake_top_scorer",
  DROP COLUMN IF EXISTS "stake_final_penalties",
  DROP COLUMN IF EXISTS "scoring_group_team",
  DROP COLUMN IF EXISTS "scoring_group_perfect",
  DROP COLUMN IF EXISTS "stake_group_team",
  DROP COLUMN IF EXISTS "scoring_champion",
  DROP COLUMN IF EXISTS "scoring_runner_up",
  DROP COLUMN IF EXISTS "scoring_third",
  DROP COLUMN IF EXISTS "scoring_fourth",
  DROP COLUMN IF EXISTS "stake_bracket_champion",
  DROP COLUMN IF EXISTS "stake_bracket_runner_up",
  DROP COLUMN IF EXISTS "stake_bracket_third",
  DROP COLUMN IF EXISTS "stake_bracket_fourth";
--> statement-breakpoint

-- 4) Drop the now-dead "scored_specials" column from sync_runs. The
-- scored_bets and scored_matches columns stay since the main-match
-- scoring pass still writes them. (We don't add a scored_auto_custom
-- column for the new auto-grade pass - the [grading auto] logs cover
-- that without a schema change.)
ALTER TABLE "sync_runs"
  DROP COLUMN IF EXISTS "scored_specials";
--> statement-breakpoint

-- 5) Drop the enums that only the legacy tables referenced. "stage"
-- stays - it is still used by matches and custom_bets. "role" and
-- "match_status" and "payment_*" likewise stay.
DROP TYPE IF EXISTS "special_bet_type";
--> statement-breakpoint
DROP TYPE IF EXISTS "bracket_slot";
