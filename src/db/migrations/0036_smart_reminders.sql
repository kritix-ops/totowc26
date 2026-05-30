-- Smart Reminders (Smart Hub + per-trigger push toggles).
--
-- Adds three per-user toggles:
--   smart_hub_enabled    - Show the Smart Hub card on the dashboard.
--   push_lock_reminders  - AND'd with push_opt_in in sendPushReminders
--                          before firing a lock-reminder push.
--   push_duel_received   - AND'd with push_opt_in in openDuel before
--                          firing the "you've got a new duel" push.
--
-- New table user_moment_dismissals: when a player dismisses a row in
-- the Smart Hub, we record (user, moment_key, dismissed_until). The
-- ranker filters out any key whose dismissed_until is still in the
-- future, so the same nudge does not nag the user repeatedly. The
-- default window is "tomorrow 04:00 Asia/Jerusalem" (set by the API
-- route, not in SQL, so the timezone math stays in one place).
--
-- Extends user_notifications.kind check constraint to allow the two
-- new kinds the Smart Reminders feature emits:
--   lock_reminder  - Sent by sendPushReminders alongside the push.
--   duel_received  - Sent by openDuel when a duel is opened that
--                    targets the recipient via the matchmaking flow.
--
-- See _plans/2026-05-30-smart-reminders.md.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "smart_hub_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "push_lock_reminders" boolean NOT NULL DEFAULT true;
--> statement-breakpoint

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "push_duel_received" boolean NOT NULL DEFAULT true;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_moment_dismissals" (
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "moment_key" text NOT NULL,
  "dismissed_until" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_moment_dismissals_pk"
    PRIMARY KEY ("user_id", "moment_key"),
  CONSTRAINT "user_moment_dismissals_key_shape"
    CHECK ("moment_key" ~ '^[a-z_]+(:[a-zA-Z0-9_-]+)?$')
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_moment_dismissals_until_idx"
  ON "user_moment_dismissals" ("dismissed_until");
--> statement-breakpoint

ALTER TABLE "user_moment_dismissals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Player reads / writes their own dismissals; admin has full access for
-- support tooling. No public role - only authenticated.
CREATE POLICY "user_moment_dismissals select own" ON "user_moment_dismissals"
  FOR SELECT TO authenticated USING (user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY "user_moment_dismissals insert own" ON "user_moment_dismissals"
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY "user_moment_dismissals update own" ON "user_moment_dismissals"
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY "user_moment_dismissals delete own" ON "user_moment_dismissals"
  FOR DELETE TO authenticated USING (user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY "user_moment_dismissals admin all" ON "user_moment_dismissals"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- Extend the notification kind whitelist. ALTER ... DROP/ADD CONSTRAINT
-- is the standard Postgres pattern; the table is small enough that the
-- rewrite cost is negligible. If a future migration adds more kinds it
-- can do the same dance.
ALTER TABLE "user_notifications"
  DROP CONSTRAINT IF EXISTS "user_notifications_kind";
--> statement-breakpoint

ALTER TABLE "user_notifications"
  ADD CONSTRAINT "user_notifications_kind"
    CHECK ("kind" IN (
      'announcement',
      'bet_graded',
      'match_final',
      'custom',
      'lock_reminder',
      'duel_received'
    ));
