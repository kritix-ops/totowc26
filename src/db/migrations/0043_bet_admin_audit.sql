-- bet_admin_audit: append-only log of every admin write performed
-- against a user's bet on their behalf.
--
-- Background: until phase 2 of _plans/2026-06-08-admin-bet-inspector.md
-- the only way an admin could influence a user's pick was via the
-- existing admin/bets[id] grading flow (manual settle) — never a
-- proactive "fill in for X" capability. The forthcoming admin-proxy
-- write-core principal needs an immutable record of every such
-- intervention: who set it, for whom, what changed, why, and whether
-- the deadline was bypassed.
--
-- Mirrors the bet_grading_audit precedent (migration 0009): admin-only
-- read+insert via RLS, REVOKE UPDATE/DELETE from client roles so any
-- correction must be a NEW row, never a silent rewrite. `before` /
-- `after` JSONB columns snapshot the pick contents on both sides so a
-- future report can reconstruct exactly what the admin changed without
-- re-querying the volatile live tables. Reason text is enforced
-- non-empty at the DB level via CHECK, so an accidental empty string
-- slipping past server validation still cannot land a "no reason" row.
--
-- Idempotent: CREATE TABLE / INDEX / POLICY are all IF NOT EXISTS or
-- wrapped in safe re-runs.

BEGIN;

CREATE TABLE IF NOT EXISTS "bet_admin_audit" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_id"        uuid NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "target_user_id"  uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "action"          text NOT NULL,
  "surface"         text NOT NULL,
  "match_id"        uuid REFERENCES "matches"("id") ON DELETE SET NULL,
  "custom_bet_id"   uuid REFERENCES "custom_bets"("id") ON DELETE SET NULL,
  "before"          jsonb,
  "after"           jsonb,
  "reason"          text NOT NULL,
  "lock_bypassed"   boolean NOT NULL DEFAULT false,
  "created_at"      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "bet_admin_audit_action_valid"
    CHECK ("action" IN ('set', 'clear')),
  CONSTRAINT "bet_admin_audit_surface_valid"
    CHECK ("surface" IN ('match', 'custom')),
  CONSTRAINT "bet_admin_audit_reason_non_empty"
    CHECK (length(trim("reason")) > 0),
  CONSTRAINT "bet_admin_audit_surface_xor"
    CHECK (
      ("surface" = 'match'  AND "match_id"      IS NOT NULL AND "custom_bet_id" IS NULL) OR
      ("surface" = 'custom' AND "custom_bet_id" IS NOT NULL AND "match_id"      IS NULL)
    )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bet_admin_audit_target_idx"
  ON "bet_admin_audit" ("target_user_id", "created_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bet_admin_audit_admin_idx"
  ON "bet_admin_audit" ("admin_id", "created_at" DESC);
--> statement-breakpoint

ALTER TABLE "bet_admin_audit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Admins read all, anyone else sees nothing. Service role bypasses RLS
-- so server actions always have full visibility regardless.
DO $$ BEGIN
  CREATE POLICY "bet_admin_audit admin read" ON "bet_admin_audit"
    FOR SELECT TO authenticated USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Admin-issued inserts: the row's `admin_id` must equal the calling
-- session's UID (no spoofing one admin as another).
DO $$ BEGIN
  CREATE POLICY "bet_admin_audit admin insert" ON "bet_admin_audit"
    FOR INSERT TO authenticated WITH CHECK (
      public.is_admin() AND admin_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Physical immutability. The REVOKE here only affects the client roles
-- — the service_role used by server actions still has full DML, which
-- is required because the audit insert lands as the same transaction
-- as the pick mutation (driven by the DB pool, not the user session).
REVOKE UPDATE, DELETE ON "bet_admin_audit" FROM authenticated;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "bet_admin_audit" FROM anon;

COMMIT;
