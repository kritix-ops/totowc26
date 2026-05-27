-- PR 1 of the football-data → API-Football migration.
-- See _plans/2026-05-27-migrate-fixture-sync-to-api-football.md.
--
-- Schema only, no behaviour change. Two columns are added:
--
-- 1. teams.api_football_team_id — DB-backed mapping from our 3-letter
--    code to API-Football's numeric team id. Null until the operator
--    runs scripts/api-football-map-teams.mjs. Once the column is
--    populated for every WC team, PR 2 flips _runSync to look teams
--    up by primary key instead of fuzzy name-match — which is what
--    fixes the recurring "32 unknown teams" cron skips.
--
-- 2. sync_runs.provider — records which provider each sync row used.
--    Nullable so historical rows (all football-data) read as "—" in
--    the admin UI. PR 2 starts populating it explicitly on every
--    write ("api-football" on success, "football-data" on fallback).

ALTER TABLE "teams"
  ADD COLUMN IF NOT EXISTS "api_football_team_id" integer;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "teams_api_football_team_id_uniq"
  ON "teams" ("api_football_team_id")
  WHERE "api_football_team_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "sync_runs"
  ADD COLUMN IF NOT EXISTS "provider" text;
