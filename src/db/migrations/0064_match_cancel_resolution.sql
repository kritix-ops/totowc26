-- Match cancel/postpone resolution columns, settings knob, and the
-- match_status_audit trail. Pairs with the enum values added in 0063.
-- See _plans/2026-06-22-match-cancel-postpone-admin.md.
--
-- cancel_resolution / cancel_resolution_config describe HOW a canceled
-- match's 1/X/2 guesses are settled, chosen by the admin after the match
-- is already marked canceled (so a match can sit pending with no scoring):
--   void     - config NULL. Everyone gets 0, no points, no risk penalty.
--   awarded  - config {"home":h,"away":a}. Guesses graded vs the technical
--              scoreline, but a wrong guess is 0 (never -penalty): nobody
--              could have predicted a forfeit.
--   split    - config {"points":n}. Flat n points to every picker.
--
-- status_changed_at records the last MANUAL status change, separate from
-- finalized_at (which the sync owns for the final transition).
--
-- match_status_audit mirrors the bet_grading_audit / bet_admin_audit
-- precedent (migrations 0009 / 0043): admin-only RLS read+insert, REVOKE
-- UPDATE/DELETE so a correction is a NEW row, never a silent rewrite.
--
-- Idempotent throughout (IF NOT EXISTS / duplicate_object guards) so a
-- re-run, or an emergency manual prod apply, is a no-op.

BEGIN;

-- 1. How a canceled match is resolved for the 1/X/2 guesses.
DO $$ BEGIN
  CREATE TYPE "public"."cancel_resolution" AS ENUM ('void', 'awarded', 'split');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- 2. matches: resolution + manual-status-change timestamp.
ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "cancel_resolution" "public"."cancel_resolution";
--> statement-breakpoint
ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "cancel_resolution_config" jsonb;
--> statement-breakpoint
ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "status_changed_at" timestamptz;
--> statement-breakpoint

-- 3. settings: default points for the "split" resolution so the admin does
--    not retype the amount each time. 0 = no default (admin must enter one).
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "cancel_split_default_points" smallint NOT NULL DEFAULT 0;
--> statement-breakpoint

-- 4. match_status_audit: append-only trail of every manual status move.
CREATE TABLE IF NOT EXISTS "match_status_audit" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "match_id"         uuid NOT NULL REFERENCES "matches"("id") ON DELETE CASCADE,
  "action"           text NOT NULL,
  "previous_status"  "public"."match_status",
  "new_status"       "public"."match_status" NOT NULL,
  "payload"          jsonb,
  "reason"           text NOT NULL,
  "performed_by"     uuid NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "performed_at"     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "match_status_audit_action_valid"
    CHECK ("action" IN ('postpone', 'cancel', 'resolve', 'reschedule', 'reopen')),
  CONSTRAINT "match_status_audit_reason_non_empty"
    CHECK (length(trim("reason")) > 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "match_status_audit_match_idx"
  ON "match_status_audit" ("match_id", "performed_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "match_status_audit_time_idx"
  ON "match_status_audit" ("performed_at" DESC);
--> statement-breakpoint

ALTER TABLE "match_status_audit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Admins read all; everyone else sees nothing. service_role (the server
-- action pool) bypasses RLS, so the actions always have full visibility.
DO $$ BEGIN
  CREATE POLICY "match_status_audit admin read" ON "match_status_audit"
    FOR SELECT TO authenticated USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Defensive: any client-side insert must be an admin stamping their own
-- UID. In practice the inserts run via the service-role pool inside the
-- status-change transaction, so this policy is belt-and-suspenders.
DO $$ BEGIN
  CREATE POLICY "match_status_audit admin insert" ON "match_status_audit"
    FOR INSERT TO authenticated WITH CHECK (
      public.is_admin() AND performed_by = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Physical immutability for client roles. service_role keeps full DML
-- because the audit insert shares the status-change transaction.
REVOKE UPDATE, DELETE ON "match_status_audit" FROM authenticated;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "match_status_audit" FROM anon;

COMMIT;
