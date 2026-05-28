-- Per-stage lock-offset default. Sits between the per-matchday override
-- and the per-type default in the deadline cascade (see
-- src/lib/deadlines.ts) so an admin can set "all R16 matchdays lock 90
-- min before kickoff" once instead of editing each matchday row.
-- Affects the same bet types as the matchday override: match_score,
-- custom_match, custom_day.
--
-- Empty seed = zero behavior change. Resolver falls through to the type
-- default exactly as today until an admin saves a value for a stage.
-- See _plans/2026-05-28-stage-default-layer.md.

CREATE TABLE IF NOT EXISTS "stage_lock_defaults" (
  "stage" "stage" PRIMARY KEY,
  "offset_minutes" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  CONSTRAINT "stage_lock_defaults_offset_range"
    CHECK ("offset_minutes" >= 0 AND "offset_minutes" <= 60 * 24 * 14)
);
--> statement-breakpoint

ALTER TABLE "stage_lock_defaults" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Read open to authenticated so the deadline resolver and the player UI
-- (countdown component) can both compute effective lock times. Matches
-- the policy on bet_lock_defaults from migration 0021.
CREATE POLICY "stage_lock_defaults read auth" ON "stage_lock_defaults"
  FOR SELECT TO authenticated USING (true);
--> statement-breakpoint

CREATE POLICY "stage_lock_defaults admin all" ON "stage_lock_defaults"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
