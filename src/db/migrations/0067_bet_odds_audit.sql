-- bet_odds_audit: append-only trail of every admin odds-correction on a
-- PUBLISHED live bet (re-pricing the odds + all existing picks). Mirrors the
-- match_status_audit / bet_grading_audit precedent — admin-only RLS read +
-- insert, REVOKE UPDATE/DELETE so a correction is a NEW row, never a silent
-- rewrite. `before` / `after` snapshot the per-option decimal-odds maps and
-- `affected_picks` is how many already-placed picks were re-priced.
-- See _plans/2026-06-24-edit-published-live-bet-odds.md.
CREATE TABLE IF NOT EXISTS "bet_odds_audit" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "custom_bet_id"   uuid NOT NULL REFERENCES "custom_bets"("id") ON DELETE CASCADE,
  "before"          jsonb,
  "after"           jsonb,
  "affected_picks"  integer NOT NULL DEFAULT 0,
  "reason"          text NOT NULL,
  "performed_by"    uuid NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "performed_at"    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "bet_odds_audit_reason_non_empty"
    CHECK (length(trim("reason")) > 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bet_odds_audit_bet_idx"
  ON "bet_odds_audit" ("custom_bet_id", "performed_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bet_odds_audit_time_idx"
  ON "bet_odds_audit" ("performed_at" DESC);
--> statement-breakpoint

ALTER TABLE "bet_odds_audit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Admins read all; everyone else sees nothing. service_role (the server
-- action pool) bypasses RLS, so the actions always have full visibility.
DO $$ BEGIN
  CREATE POLICY "bet_odds_audit admin read" ON "bet_odds_audit"
    FOR SELECT TO authenticated USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Defensive: any client-side insert must be an admin stamping their own UID.
-- In practice the insert runs via the service-role pool inside the reprice
-- transaction, so this policy is belt-and-suspenders.
DO $$ BEGIN
  CREATE POLICY "bet_odds_audit admin insert" ON "bet_odds_audit"
    FOR INSERT TO authenticated WITH CHECK (
      public.is_admin() AND performed_by = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Physical immutability for client roles. service_role keeps full DML because
-- the audit insert shares the reprice transaction.
REVOKE UPDATE, DELETE ON "bet_odds_audit" FROM authenticated;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "bet_odds_audit" FROM anon;
