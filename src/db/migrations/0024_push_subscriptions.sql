-- Push notifications (iteration 2 of the lock-reminders feature).
--
-- push_subscriptions: one row per (user, browser/device). Multi-device
-- supported - a player who subscribes from desktop and phone gets push
-- on both. The triplet (endpoint, p256dh, auth) comes from the
-- PushSubscription.toJSON() shape the browser hands back after
-- pushManager.subscribe().
--
-- profiles.push_opt_in: opt-IN (default false). Even with a stored
-- subscription, push only fires when this is true - lets the user
-- pause notifications without re-granting browser permission.
--
-- See _plans/2026-05-28-lock-reminders.md §5.

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "push_subscriptions_endpoint_uniq" UNIQUE ("endpoint")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx"
  ON "push_subscriptions" ("user_id");
--> statement-breakpoint

ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Users can read / insert / delete only their own subscriptions. The
-- cron sender runs with the service role and bypasses RLS so it can
-- read every row.
CREATE POLICY "push_subscriptions select own" ON "push_subscriptions"
  FOR SELECT TO authenticated USING (user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY "push_subscriptions insert own" ON "push_subscriptions"
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY "push_subscriptions delete own" ON "push_subscriptions"
  FOR DELETE TO authenticated USING (user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY "push_subscriptions admin all" ON "push_subscriptions"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- Opt-in flag on the profile. Default false: players must explicitly
-- agree to receive push (matches browser permission UX, where consent
-- is required up front anyway). When true AND a subscription exists,
-- the cron sends push alongside email.
ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "push_opt_in" boolean NOT NULL DEFAULT false;
