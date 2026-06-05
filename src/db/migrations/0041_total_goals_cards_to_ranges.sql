-- Convert the two tournament-scope "total X" bets from exact-number
-- guesses to 3 fixed range buckets, and remap every already-placed
-- pick to the bucket containing its original numeric guess.
--
-- Why: a closest-wins exact-number guess on a tournament total
-- (~280 goals, ~10 reds across 104 matches) is effectively
-- impossible to hit. Switching to 3 fixed ranges turns it into
-- a real bet — every player has a ~33% chance to land the bucket.
--
-- The two affected bets, identified by question_he so this is safe
-- to re-run against the sandbox project where row IDs differ:
--   1. "כמה שערים יובקעו בסך הכל במונדיאל 2026?"
--      Ranges: <265 / 265-295 / >295   (centered on 280, the
--      104 matches × 2.67 goals/match historical baseline).
--   2. "כמה כרטיסים אדומים יוצאו במונדיאל 2026?"
--      Ranges: <8 / 8-13 / >13   (centered on 10.5, balancing
--      the VAR-era 4/64 baseline against the 48-team expansion's
--      tendency toward more cards from inexperienced teams).
--
-- USER BETS ARE SACRED. This migration touches user_custom_bet_picks,
-- which normally we never do. The exception here is admin-approved
-- and mechanical: each existing pick's numeric value is mapped to the
-- bucket containing it (17 -> '>13', 11 -> '8-13', 270 -> '265-295').
-- The user's intent is preserved — a guess of 17 cards meant "high",
-- and the '>13' bucket continues to represent that intent. No pick
-- is silently re-priced, re-graded, or moved to a different intent.
-- Picks are confirmed not locked and not yet graded as of the
-- migration's authorship (lock_at = 2026-06-28, none with
-- points_earned or was_correct set).
--
-- Idempotent: each UPDATE matches only the legacy shape
-- (answer_type='number' for bets, answer->>'type'='number' for picks),
-- so re-running is a no-op once the first pass completes.

BEGIN;

-- 1) Bet: total goals -> 3-range multi_choice
UPDATE "custom_bets"
SET
  "answer_type"     = 'multi_choice',
  "answer_config"   = jsonb_build_object(
    'kind', 'multi_choice',
    'options', jsonb_build_array(
      jsonb_build_object('value', 'lt_265',  'labelHe', 'פחות מ-265', 'labelEn', 'Under 265'),
      jsonb_build_object('value', '265_295', 'labelHe', '265–295',    'labelEn', '265–295'),
      jsonb_build_object('value', 'gt_295',  'labelHe', 'מעל 295',    'labelEn', 'Over 295')
    )
  ),
  "grading_rule_he" = 'סך כל השערים בכל המשחקים, כולל הארכות, פנדלים אחרי תיקו לא נספרים. הזוכים הם מי שבחרו את הטווח המכיל את המספר הסופי.',
  "grading_rule_en" = 'Sum of goals across every match including extra time; penalty shoot-outs after a draw are not counted. Winners are those who picked the range containing the final number.',
  "updated_at"      = NOW()
WHERE "scope"        = 'tournament'
  AND "question_he"  = 'כמה שערים יובקעו בסך הכל במונדיאל 2026?'
  AND "answer_type"  = 'number';

-- 2) Bet: total red cards -> 3-range multi_choice
UPDATE "custom_bets"
SET
  "answer_type"     = 'multi_choice',
  "answer_config"   = jsonb_build_object(
    'kind', 'multi_choice',
    'options', jsonb_build_array(
      jsonb_build_object('value', 'lt_8',  'labelHe', 'פחות מ-8', 'labelEn', 'Under 8'),
      jsonb_build_object('value', '8_13',  'labelHe', '8–13',     'labelEn', '8–13'),
      jsonb_build_object('value', 'gt_13', 'labelHe', 'מעל 13',   'labelEn', 'Over 13')
    )
  ),
  "grading_rule_he" = 'סך כל הכרטיסים האדומים שדווחו במשחק. שני כרטיסים צהובים שהפכו לאדום נספרים פעם אחת. הזוכים הם מי שבחרו את הטווח המכיל את המספר הסופי.',
  "grading_rule_en" = 'Sum of red cards reported per match. Two yellows that became a red count once. Winners are those who picked the range containing the final number.',
  "updated_at"      = NOW()
WHERE "scope"        = 'tournament'
  AND "question_he"  = 'כמה כרטיסים אדומים יוצאו במונדיאל 2026?'
  AND "answer_type"  = 'number';

-- 3) Picks on the goals bet: numeric value -> bucket value.
UPDATE "user_custom_bet_picks" p
SET
  "answer"     = jsonb_build_object(
    'type', 'multi_choice',
    'value', CASE
      WHEN (p."answer"->>'value')::numeric <  265 THEN 'lt_265'
      WHEN (p."answer"->>'value')::numeric <= 295 THEN '265_295'
      ELSE 'gt_295'
    END
  ),
  "updated_at" = NOW()
FROM "custom_bets" b
WHERE b."id" = p."custom_bet_id"
  AND b."scope"       = 'tournament'
  AND b."question_he" = 'כמה שערים יובקעו בסך הכל במונדיאל 2026?'
  AND p."answer"->>'type' = 'number'
  AND p."was_correct" IS NULL
  AND p."points_earned" IS NULL;

-- 4) Picks on the red cards bet: numeric value -> bucket value.
UPDATE "user_custom_bet_picks" p
SET
  "answer"     = jsonb_build_object(
    'type', 'multi_choice',
    'value', CASE
      WHEN (p."answer"->>'value')::numeric <  8  THEN 'lt_8'
      WHEN (p."answer"->>'value')::numeric <= 13 THEN '8_13'
      ELSE 'gt_13'
    END
  ),
  "updated_at" = NOW()
FROM "custom_bets" b
WHERE b."id" = p."custom_bet_id"
  AND b."scope"       = 'tournament'
  AND b."question_he" = 'כמה כרטיסים אדומים יוצאו במונדיאל 2026?'
  AND p."answer"->>'type' = 'number'
  AND p."was_correct" IS NULL
  AND p."points_earned" IS NULL;

COMMIT;
