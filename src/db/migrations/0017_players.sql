-- Player roster.
--
-- Every player who appears in an API-Football WC squad lives here.
-- Hebrew name (name_he) is nullable on purpose: the players table
-- ships in this migration with English names only; migration 0018
-- adds the translation audit columns, and the translate-players
-- script (PR-3) fills name_he per row through Wikidata + Israeli
-- sports-media scrapers + LLM reviewer.
--
-- api_football_id is the external system of record — the squads
-- sync script keys upserts on it so re-running the sync is
-- idempotent (no duplicate rows for the same player even if their
-- name spelling changes between API responses).

CREATE TABLE IF NOT EXISTS "players" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "api_football_id"  integer NOT NULL UNIQUE,
  "team_code"        varchar(3) NOT NULL REFERENCES "teams"("code") ON DELETE CASCADE,
  "name_en"          text NOT NULL,
  "name_he"          text,
  "position"         varchar(20),
  "jersey_number"    smallint,
  "photo_url"        text,
  "birth_date"       date,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "players_team_idx"    ON "players" ("team_code");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "players_name_en_idx" ON "players" ("name_en");
--> statement-breakpoint

-- RLS: read open to anyone (rosters are public WC data), write
-- locked to service role only (the sync script runs with the
-- service key; admin UI in PR-3 goes through server actions that
-- elevate to service role).
ALTER TABLE "players" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "players_read" ON "players" FOR SELECT USING (true);
