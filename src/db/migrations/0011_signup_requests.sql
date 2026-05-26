-- Public self-service signup queue + admin approval.
--
-- See _plans/2026-05-26-public-signup-with-admin-approval.md.
--
-- Adds:
--   1. signup_request_status enum
--   2. signup_requests table (PK uuid, FK decided_by → profiles.id)
--   3. Indexes: status_idx + partial-unique (email) WHERE status='pending'
--   4. settings.public_signup_open boolean (default true)
--   5. RLS enabled. No INSERT/UPDATE/DELETE policies for anon or
--      authenticated — only the server's superuser-role DB connection
--      (Drizzle via DATABASE_URL) writes here, which bypasses RLS by
--      design. Admin-read policy is added in case a future admin page
--      switches to the Supabase JS client.
--
-- All writes go through server actions in
-- src/app/[lang]/signup/actions.ts and
-- src/app/[lang]/admin/signup-requests/actions.ts.

-- 1) Enum.
DO $$ BEGIN
  CREATE TYPE "signup_request_status" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- 2) Table.
CREATE TABLE IF NOT EXISTS "signup_requests" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "display_name"    text NOT NULL,
  "phone"           text NOT NULL,
  "email"           text NOT NULL,
  "status"          signup_request_status NOT NULL DEFAULT 'pending',
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "decided_at"      timestamptz,
  "decided_by"      uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "note"            text,
  "created_user_id" uuid
);
--> statement-breakpoint

-- 3a) Plain index on status — admin list filters by it constantly.
CREATE INDEX IF NOT EXISTS "signup_requests_status_idx"
  ON "signup_requests" ("status");
--> statement-breakpoint

-- 3b) Partial unique index: at most one pending request per email at a
-- time. Approved and rejected history rows can repeat freely so a person
-- who was rejected can re-apply later if the admin opens the queue again.
CREATE UNIQUE INDEX IF NOT EXISTS "signup_requests_pending_email_uq"
  ON "signup_requests" ("email")
  WHERE status = 'pending';
--> statement-breakpoint

-- 4) Settings: public-signup gate. Default open so existing prod
-- behaviour (the admin can immediately receive requests) holds; admin
-- can flip it off from the settings panel once signups should close.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "public_signup_open" boolean NOT NULL DEFAULT true;
--> statement-breakpoint

-- 5) RLS. Enable with no public policies. The server connects as the
-- table owner and bypasses RLS for inserts/updates; anon and
-- authenticated roles have no policy and therefore no access. The admin
-- SELECT policy below is defensive — present so a future admin surface
-- using the Supabase JS client (anon-key + JWT) can list requests
-- without rewriting access. Today nothing relies on it.
ALTER TABLE "signup_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "signup_requests admin all" ON "signup_requests";
--> statement-breakpoint

CREATE POLICY "signup_requests admin all" ON "signup_requests"
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
