-- Knockout stages: 90-minute match grading, penalty/extra-time score capture,
-- the advancing-team marker, the "who advances?" (מי עולה?) pick table, and the
-- editable scoring_advance setting.
-- See _plans/2026-06-28-knockout-stage-90min-who-advances.md.

-- 1) matches: split the stored score into "final incl. extra time" (existing
--    home/away_score) vs "90-minute regulation" (new reg_* columns), capture the
--    penalty-shootout score, and mark the team that advances/wins the tie.
ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "reg_home_score" smallint,
  ADD COLUMN IF NOT EXISTS "reg_away_score" smallint,
  ADD COLUMN IF NOT EXISTS "pen_home_score" smallint,
  ADD COLUMN IF NOT EXISTS "pen_away_score" smallint,
  ADD COLUMN IF NOT EXISTS "advancing_team" varchar(3) REFERENCES "teams"("code");
--> statement-breakpoint

-- Backfill: every already-final match was decided in regulation (no knockout has
-- reached extra time yet), so the 90-minute score equals the stored final score.
-- This keeps the 1/X/2 grader (which now reads reg_*) consistent for past rows.
UPDATE "matches"
  SET "reg_home_score" = "home_score",
      "reg_away_score" = "away_score"
  WHERE "status" = 'final'
    AND "home_score" IS NOT NULL
    AND "away_score" IS NOT NULL
    AND "reg_home_score" IS NULL;
--> statement-breakpoint

-- 2) match_advance_bets: one "who advances?" pick per (user, knockout match).
CREATE TABLE IF NOT EXISTS "match_advance_bets" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "match_id"      uuid NOT NULL REFERENCES "matches"("id") ON DELETE CASCADE,
  "team"          varchar(3) NOT NULL REFERENCES "teams"("code"),
  "locked"        boolean NOT NULL DEFAULT false,
  "points_earned" smallint,
  "was_correct"   boolean,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "match_advance_bets_user_match_uniq"
  ON "match_advance_bets" ("user_id", "match_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_advance_bets_user_idx"
  ON "match_advance_bets" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_advance_bets_match_idx"
  ON "match_advance_bets" ("match_id");
--> statement-breakpoint

ALTER TABLE "match_advance_bets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- RLS mirrors match_bets: everyone reads (transparency / leaderboard), each
-- player writes only their own pick before the match locks, admins do anything.
-- Server actions run via the service-role pool (bypasses RLS); these policies
-- are the defense-in-depth backstop for any direct client access.
DO $$ BEGIN
  CREATE POLICY "match_advance_bets read all" ON "match_advance_bets"
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "match_advance_bets insert own" ON "match_advance_bets"
    FOR INSERT TO authenticated WITH CHECK (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.matches m, public.settings s
        WHERE m.id = match_advance_bets.match_id
          AND m.status = 'scheduled'
          AND m.kickoff_at > now() + (s.bet_lock_minutes || ' minutes')::interval
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "match_advance_bets update own unlocked" ON "match_advance_bets"
    FOR UPDATE TO authenticated USING (
      user_id = auth.uid()
      AND locked = false
      AND points_earned IS NULL
    ) WITH CHECK (
      user_id = auth.uid()
      AND locked = false
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY "match_advance_bets admin all" ON "match_advance_bets"
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- 3) settings: editable points for a correct "who advances?" pick (default 10).
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "scoring_advance" smallint NOT NULL DEFAULT 10;
