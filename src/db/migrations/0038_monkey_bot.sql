-- Monkey bot baseline player.
--
-- Adds profiles.is_bot: marks the non-human "monkey" account whose picks are
-- filled by /api/cron/monkey (an odds-weighted random guess on every open
-- bet) so human players have a baseline to beat.
--
-- Behavioural contract (enforced in app code, not SQL):
--   - Bots are excluded from the ranked leaderboard and rendered as a
--     separate benchmark line (loadLeaderboardFromDb / getMonkeyBenchmark).
--   - Bots are excluded from email + in-app broadcast fan-outs
--     (resolveRecipients) and the admin player listing / counts.
--   - Payment-gated surfaces (pot math, lock reminders, duel notifications)
--     already skip the bot because it has no approved payment row.
--
-- See _plans/2026-06-01-monkey-bot-and-random-fill.md.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "is_bot" boolean NOT NULL DEFAULT false;
