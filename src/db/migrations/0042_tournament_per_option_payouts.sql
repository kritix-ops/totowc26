-- Per-option payouts for the three flat-priced tournament-scope bets.
--
-- Before: each of "total goals", "total red cards" and "final on
-- penalties" carried a single flat `payout_snapshot` (10, 10, 6) so
-- every option paid the same — a "10 points or nothing" bet regardless
-- of which range or yes/no branch the user picked. The other five
-- tournament bets (champion, runner-up, third, top scorer, golden ball)
-- already publish per-option payouts on the 20→100 log-odds curve via
-- scripts/auto-publish-outright.mjs.
--
-- This migration brings the three flat bets onto the same scale, using
-- probabilities derived from real bookmaker totals and historical
-- baselines (see _plans/2026-06-05-flat-tournament-bets-per-option-odds.md
-- for the full derivation):
--
--   Total goals    (lt_265 / 265–295 / gt_295):
--     P ≈ 7%   / 26%  / 67%   →  100 / 54 / 20
--   Total reds     (lt_8   / 8–13   / gt_13 ):
--     P ≈ 60%  / 28%  / 12%   →   20 / 58 / 100
--   Final pens     (yes / no):
--     P ≈ 30%  / 70%          →  100 / 20
--
-- The bet-level `payout_snapshot` becomes 100 on all three (curve
-- ceiling) to match the convention the other tournament bets use —
-- the headline reads as an honest "up to 100", with the per-option
-- scenario block revealing each branch's actual payout.
--
-- USER BETS ARE SACRED. This migration writes to user_custom_bet_picks
-- which we normally never do (memory/feedback_user_bets_are_sacred.md).
-- The exception here:
--   - the user's `answer` is never touched — their choice stands;
--   - only `payout_snapshot` is rewritten, and only to the value the
--     user *would* have been quoted had per-option pricing existed at
--     pick time;
--   - skipping any pick with `points_earned IS NOT NULL` keeps settled
--     history immutable.
-- This is the same intent-preserving precedent migration 0037 set when
-- it dropped stakes and clamped payouts.
--
-- Idempotent. Each UPDATE matches only by the bet's question text and
-- the option value the user picked, so re-running converges on the
-- same state.

BEGIN;

-- 1) Total goals bet: per-option overrides + ceiling headline.
UPDATE "custom_bets"
SET
  "answer_config" = jsonb_build_object(
    'kind', 'multi_choice',
    'options', jsonb_build_array(
      jsonb_build_object('value', 'lt_265',  'labelHe', 'פחות מ-265', 'labelEn', 'Under 265', 'payoutOverride', 100),
      jsonb_build_object('value', '265_295', 'labelHe', '265–295',    'labelEn', '265–295',   'payoutOverride',  54),
      jsonb_build_object('value', 'gt_295',  'labelHe', 'מעל 295',    'labelEn', 'Over 295',  'payoutOverride',  20)
    ),
    'payoutOverridesByValue', jsonb_build_object(
      'lt_265',  100,
      '265_295',  54,
      'gt_295',   20
    )
  ),
  "payout_snapshot" = 100,
  "updated_at"      = NOW()
WHERE "scope"        = 'tournament'
  AND "question_he"  = 'כמה שערים יובקעו בסך הכל במונדיאל 2026?'
  AND "answer_type"  = 'multi_choice'
  AND "status"       IN ('draft', 'open', 'locked');
--> statement-breakpoint

-- 2) Total red cards bet: per-option overrides + ceiling headline.
UPDATE "custom_bets"
SET
  "answer_config" = jsonb_build_object(
    'kind', 'multi_choice',
    'options', jsonb_build_array(
      jsonb_build_object('value', 'lt_8',  'labelHe', 'פחות מ-8', 'labelEn', 'Under 8', 'payoutOverride',  20),
      jsonb_build_object('value', '8_13',  'labelHe', '8–13',     'labelEn', '8–13',    'payoutOverride',  58),
      jsonb_build_object('value', 'gt_13', 'labelHe', 'מעל 13',   'labelEn', 'Over 13', 'payoutOverride', 100)
    ),
    'payoutOverridesByValue', jsonb_build_object(
      'lt_8',   20,
      '8_13',   58,
      'gt_13', 100
    )
  ),
  "payout_snapshot" = 100,
  "updated_at"      = NOW()
WHERE "scope"        = 'tournament'
  AND "question_he"  = 'כמה כרטיסים אדומים יוצאו במונדיאל 2026?'
  AND "answer_type"  = 'multi_choice'
  AND "status"       IN ('draft', 'open', 'locked');
--> statement-breakpoint

-- 3) Final-on-penalties bet: per-branch overrides + ceiling headline.
UPDATE "custom_bets"
SET
  "answer_config" = jsonb_build_object(
    'kind',                'yes_no',
    'payoutOverrideYes',   100,
    'payoutOverrideNo',     20
  ),
  "payout_snapshot" = 100,
  "updated_at"      = NOW()
WHERE "scope"        = 'tournament'
  AND "question_he"  = 'האם הגמר יוכרע בפנדלים?'
  AND "answer_type"  = 'yes_no'
  AND "status"       IN ('draft', 'open', 'locked');
--> statement-breakpoint

-- 4) Reprice existing picks on the goals bet.
--    Each pick's payout_snapshot becomes the per-option payout for
--    their actual answer. `points_earned IS NULL` filters out any
--    already-settled pick (there should be none — the bet locks at
--    the final's kickoff — but the guard keeps the migration safe
--    to re-run).
UPDATE "user_custom_bet_picks" p
SET
  "payout_snapshot" = CASE p."answer"->>'value'
    WHEN 'lt_265'  THEN 100
    WHEN '265_295' THEN  54
    WHEN 'gt_295'  THEN  20
    ELSE p."payout_snapshot"
  END,
  "updated_at"      = NOW()
FROM "custom_bets" b
WHERE b."id" = p."custom_bet_id"
  AND b."scope"       = 'tournament'
  AND b."question_he" = 'כמה שערים יובקעו בסך הכל במונדיאל 2026?'
  AND p."answer"->>'type' = 'multi_choice'
  AND p."points_earned" IS NULL;
--> statement-breakpoint

-- 5) Reprice existing picks on the red cards bet.
UPDATE "user_custom_bet_picks" p
SET
  "payout_snapshot" = CASE p."answer"->>'value'
    WHEN 'lt_8'   THEN  20
    WHEN '8_13'   THEN  58
    WHEN 'gt_13'  THEN 100
    ELSE p."payout_snapshot"
  END,
  "updated_at"      = NOW()
FROM "custom_bets" b
WHERE b."id" = p."custom_bet_id"
  AND b."scope"       = 'tournament'
  AND b."question_he" = 'כמה כרטיסים אדומים יוצאו במונדיאל 2026?'
  AND p."answer"->>'type' = 'multi_choice'
  AND p."points_earned" IS NULL;
--> statement-breakpoint

-- 6) Reprice existing picks on the final-on-penalties bet.
--    The yes_no answer carries `value: true|false`. Cast the jsonb
--    boolean to text so the CASE comparison stays explicit.
UPDATE "user_custom_bet_picks" p
SET
  "payout_snapshot" = CASE p."answer"->>'value'
    WHEN 'true'  THEN 100
    WHEN 'false' THEN  20
    ELSE p."payout_snapshot"
  END,
  "updated_at"      = NOW()
FROM "custom_bets" b
WHERE b."id" = p."custom_bet_id"
  AND b."scope"       = 'tournament'
  AND b."question_he" = 'האם הגמר יוכרע בפנדלים?'
  AND p."answer"->>'type' = 'yes_no'
  AND p."points_earned" IS NULL;

COMMIT;
