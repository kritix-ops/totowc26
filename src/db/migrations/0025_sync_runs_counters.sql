-- Surfaces reminder + auto-lock activity in the admin SyncPanel.
--
-- The cron pass already returns `remindersSent` and
-- `lockedExpiredCustomBets` in its in-memory report, but only
-- `scored_bets` / `scored_matches` were persisted to sync_runs. After
-- this migration the admin can scroll the recent-runs list and see
-- whether the email/push pipeline did anything on each invocation,
-- which is the only operational signal available between cron
-- triggers on the current schedule.
--
-- Both columns are nullable so historical rows stay valid; the writer
-- in src/lib/sync.ts defaults to 0 on new rows.

ALTER TABLE "sync_runs"
  ADD COLUMN IF NOT EXISTS "reminders_sent" integer DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "sync_runs"
  ADD COLUMN IF NOT EXISTS "locked_expired_custom_bets" integer DEFAULT 0;
