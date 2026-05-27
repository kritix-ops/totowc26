-- Lock reminders (iteration 1: email).
--
-- One reminder per (bet, user, channel) sent N minutes before the bet
-- locks, where N is settings.reminder_offset_minutes. Only sent to
-- users who haven't placed a pick on the bet yet. See
-- _plans/2026-05-28-lock-reminders.md.
--
-- The channel column makes room for iteration 2 (push) on the same
-- primary key without conflicting with email's row.

CREATE TABLE IF NOT EXISTS "bet_reminder_sent" (
  "custom_bet_id" uuid NOT NULL REFERENCES "custom_bets"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bet_reminder_sent_pk"
    PRIMARY KEY ("custom_bet_id", "user_id", "channel"),
  CONSTRAINT "bet_reminder_sent_channel"
    CHECK ("channel" IN ('email', 'push'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bet_reminder_sent_sent_at_idx"
  ON "bet_reminder_sent" ("sent_at");
--> statement-breakpoint

ALTER TABLE "bet_reminder_sent" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Service role writes (the cron) and admin reads. Players don't query
-- this table directly; it's internal dedup state.
CREATE POLICY "bet_reminder_sent admin all" ON "bet_reminder_sent"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- Admin-controlled offset. 0 = feature disabled (no reminders sent).
-- Upper bound at 7 days because a longer reminder makes no sense for a
-- typical custom bet.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "reminder_offset_minutes" integer NOT NULL DEFAULT 60;
--> statement-breakpoint

ALTER TABLE "settings"
  ADD CONSTRAINT "settings_reminder_offset_range"
    CHECK ("reminder_offset_minutes" >= 0 AND "reminder_offset_minutes" <= 10080);
