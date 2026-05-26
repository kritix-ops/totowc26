-- Duels follow-ups (PR 3 → follow-up sweep).
--
-- 1) Optional auto-settle for match-scope duels: re-uses the existing
--    grading_source enum (auto_api_football / auto_football_data /
--    manual). A non-null grading_config carries the comparator +
--    threshold the sync pass evaluates against API-Football stats.
-- 2) Per-user rate limit on opening duels — daily cap stored in
--    settings.duel_daily_limit so the admin can tune it mid-tournament.
--
-- All additive — no existing column dropped.

ALTER TABLE "duels"
  ADD COLUMN IF NOT EXISTS "grading_source" grading_source NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "grading_config" jsonb;
--> statement-breakpoint

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "duel_daily_limit" smallint NOT NULL DEFAULT 20;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "duels_grading_source_idx"
  ON "duels" ("grading_source");
--> statement-breakpoint
