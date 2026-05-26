-- Add api_football_fixture_id to matches.
--
-- Why: API-Football identifies fixtures with its own integer ID,
-- different from football-data.org's api_fixture_id we already store.
-- The auto_api_football grading path needs to know which API-Football
-- fixture corresponds to each of our matches; storing it as a column
-- avoids per-grade lookups via team + date matching.
--
-- The column is nullable + unique. A one-shot mapping script runs at
-- activation time (scripts/api-football-map-fixtures.mjs) that hits
-- /fixtures?league=15&season=2026 and back-fills the column for every
-- World Cup fixture. Until that runs, the column stays null and
-- scoreAutoCustomBets short-circuits the api_football branch for each
-- match — bets queue for manual grading, same as if the API key wasn't
-- set.

ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "api_football_fixture_id" integer;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "matches_api_football_fixture_uniq"
  ON "matches" ("api_football_fixture_id")
  WHERE "api_football_fixture_id" IS NOT NULL;
