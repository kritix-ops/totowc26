-- password_reset_audit: append-only log of every admin-initiated
-- password reset. A "reset" here means an admin generated a one-time
-- Supabase recovery link for a user (the same link machinery used by the
-- invite flow), letting that user set a new password via /set-password.
--
-- Generating the link does not itself change the password, so this is not
-- a destructive action — but it is a security-relevant one (an admin can
-- hand a user a path back into an account), so every occurrence is
-- recorded: who did it, for whom, and when.
--
-- Mirrors the bet_admin_audit precedent (migration 0043): admin-only
-- read+insert via RLS, REVOKE UPDATE/DELETE from client roles so the log
-- can only ever grow. The server action runs as service_role, which
-- bypasses RLS and retains full DML, so it can always insert.
--
-- Idempotent: CREATE TABLE / INDEX / POLICY are all IF NOT EXISTS or
-- wrapped in safe re-runs.

BEGIN;

CREATE TABLE IF NOT EXISTS "password_reset_audit" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_id"        uuid NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "target_user_id"  uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "password_reset_audit_target_idx"
  ON "password_reset_audit" ("target_user_id", "created_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "password_reset_audit_admin_idx"
  ON "password_reset_audit" ("admin_id", "created_at" DESC);
--> statement-breakpoint

ALTER TABLE "password_reset_audit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Admins read all, anyone else sees nothing. Service role bypasses RLS
-- so the server action always has full visibility regardless.
DO $$ BEGIN
  CREATE POLICY "password_reset_audit admin read" ON "password_reset_audit"
    FOR SELECT TO authenticated USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Admin-issued inserts: the row's `admin_id` must equal the calling
-- session's UID (no spoofing one admin as another).
DO $$ BEGIN
  CREATE POLICY "password_reset_audit admin insert" ON "password_reset_audit"
    FOR INSERT TO authenticated WITH CHECK (
      public.is_admin() AND admin_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Physical immutability. The REVOKE here only affects the client roles —
-- the service_role used by the server action still has full DML.
REVOKE UPDATE, DELETE ON "password_reset_audit" FROM authenticated;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "password_reset_audit" FROM anon;

COMMIT;
