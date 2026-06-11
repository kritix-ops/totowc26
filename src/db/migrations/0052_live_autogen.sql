-- Admin-controlled rule for auto-generating live-bet suggestions.
--
-- When enabled, a daily cron (/api/cron/live-autogen) asks the AI
-- generator for a batch of live bets for every upcoming match within the
-- lead window that has no custom bets yet, and queues them as DRAFTS for
-- the admin to review. Nothing publishes automatically — the approval tap
-- stays manual. Off by default so the behaviour is opt-in.
--
-- See _plans/2026-06-12-live-bets-llm-overhaul.md Phase 3 (rules engine).

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "live_autogen_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "live_autogen_lead_hours" smallint NOT NULL DEFAULT 30;

COMMENT ON COLUMN "settings"."live_autogen_enabled" IS
  'When true, the live-autogen cron seeds draft AI suggestions for upcoming matches.';
COMMENT ON COLUMN "settings"."live_autogen_lead_hours" IS
  'How many hours before kickoff the autogen cron will seed a match.';
