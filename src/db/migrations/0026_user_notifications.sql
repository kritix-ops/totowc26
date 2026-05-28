-- In-app notification feed (admin broadcasts + auto-generated events).
--
-- Each row is a single notification delivered to a single user, even
-- when the source is a broadcast. The duplication on insert keeps the
-- player-side query trivially per-user (SELECT WHERE user_id) and lets
-- us track read_at per device without a join table.
--
-- Kinds:
--   announcement  -> admin sent via /admin/broadcast
--   bet_graded    -> a custom bet the player picked was graded
--   match_final   -> a 1/X/2 score bet was scored
--   custom        -> reserved for ad-hoc system messages
--
-- pushed=true means we ALSO fired a web-push at send time. Used by the
-- broadcast UI to surface "X pushed / Y also stored" stats.

CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "url" text,
  "read_at" timestamptz,
  "pushed" boolean NOT NULL DEFAULT false,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_notifications_kind"
    CHECK ("kind" IN ('announcement', 'bet_graded', 'match_final', 'custom'))
);
--> statement-breakpoint

-- Most reads are "give me the latest N for this user" so a composite
-- index on (user_id, created_at desc) is the right shape. Drizzle's
-- pgIndex doesn't expose DESC directly so we declare the index in raw
-- SQL.
CREATE INDEX IF NOT EXISTS "user_notifications_user_created_idx"
  ON "user_notifications" ("user_id", "created_at" DESC);
--> statement-breakpoint

-- Partial index for the unread-count query in the profile menu badge.
-- ~99% of historical rows will be read; a partial index keeps the
-- count() lookup tiny.
CREATE INDEX IF NOT EXISTS "user_notifications_unread_idx"
  ON "user_notifications" ("user_id")
  WHERE "read_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "user_notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Player reads / marks-read their own rows. Admin can do everything.
CREATE POLICY "user_notifications select own" ON "user_notifications"
  FOR SELECT TO authenticated USING (user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY "user_notifications update own read" ON "user_notifications"
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

CREATE POLICY "user_notifications admin all" ON "user_notifications"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
