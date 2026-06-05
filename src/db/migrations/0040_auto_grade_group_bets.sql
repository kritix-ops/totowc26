-- Auto-grade group-winner bets ("מי תנצח בקבוצה X?") from match results
-- once every group-stage match for that group is final.
--
-- Background: scoreAutoCustomBets() in src/lib/sync.ts already auto-grades
-- match- and day-scope custom_bets when grading_source IN
-- ('auto_football_data','auto_api_football'). Group-scope bets were left as
-- 'manual' in scripts/auto-publish-outright.mjs, which meant an admin had
-- to click through all 12 group winners after the group stage. This flips
-- them to 'auto_football_data' so the next cron sync pass after the group
-- stage ends grades them automatically.
--
-- The resolver (resolveGroupScope) is added in the same commit and
-- recognises grading_config = { source: 'football_data', field:
-- 'group_winner' }. It uses the same standings ordering as the live tables
-- on /tournament (points -> goal diff -> goals for). If the top two teams
-- are tied across all three, the resolver returns 'not_ready' so the bet
-- stays in the manual queue rather than crediting points ambiguously.
--
-- This migration only touches custom_bets metadata. It does NOT touch
-- user_custom_bet_picks. Bet immutability (user picks are sacred) is
-- preserved.
--
-- Idempotent: only flips rows currently set to 'manual'. Re-running is a
-- no-op once the first run completes.
--
-- Scoping rules (defensive, since admin can hand-author custom
-- group-scope bets that are NOT a group-winner question):
--   * Only multi_choice rows. Number / yes_no / free_text never make
--     sense as a group-winner question.
--   * Only rows whose question matches the auto-publish-outright pattern
--     ("מי תנצח בקבוצה X" / "Who wins Group X"). Any hand-rolled
--     ad-hoc group bet stays manual, because the resolver would have
--     nothing sensible to say about it.
--   * Only rows with grading_config IS NULL, to refuse clobbering any
--     custom grading_config an admin may have set.

UPDATE "custom_bets"
SET
  "grading_source" = 'auto_football_data',
  "grading_config" = jsonb_build_object('source', 'football_data', 'field', 'group_winner'),
  "updated_at"     = now()
WHERE "scope"           = 'group'
  AND "grading_source"  = 'manual'
  AND "status"          IN ('open', 'locked')
  AND "answer_type"     = 'multi_choice'
  AND "grading_config"  IS NULL
  AND (
       "question_he" LIKE 'מי תנצח בקבוצה %'
    OR "question_en" ILIKE 'Who wins Group %'
  );
