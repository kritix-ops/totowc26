-- Persistent cache for live-bet odds, fed by the /api/cron/odds-sync
-- cron and read by /admin/live-bets/suggestions.
--
-- Background: the suggestions page used to call The Odds API on every
-- render. That works for one admin but burns credits any time the page
-- is reloaded and leaves no audit trail. With this table the cron does
-- the fetch once (per its schedule), upserts the latest MarketOdds[]
-- per fixture, and the suggestions page reads the table directly —
-- credits cost stays predictable, fetched_at gives admins a clear
-- "last refreshed at HH:MM" signal, and we have the door open to a
-- line-movement history in a follow-up by promoting this to an
-- append-only log.
--
-- Schema decisions:
--   - match_id is the PK so the table holds at most one row per
--     fixture (the current snapshot). History is out of scope for v1.
--   - markets is JSONB carrying the same MarketOdds[] shape the
--     suggestions page already consumes via fetchOddsForMatch, so the
--     suggestions-page rewrite is a single read + JSON.parse rather
--     than a column-by-column reconstruction.
--   - fetched_at is the wall-clock time of the cron's successful
--     upsert. Admins see this on the page so they can decide whether
--     to trigger a manual refresh.
--   - notes is free-form (parse failures, no-match logs from the
--     wrapper); kept so an admin can investigate why a particular
--     fixture is empty.

CREATE TABLE IF NOT EXISTS "live_odds_snapshot" (
  "match_id"   uuid PRIMARY KEY REFERENCES "matches"("id") ON DELETE CASCADE,
  "markets"    jsonb NOT NULL,
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  "notes"      text
);

CREATE INDEX IF NOT EXISTS "live_odds_snapshot_fetched_at_idx"
  ON "live_odds_snapshot" ("fetched_at" DESC);

COMMENT ON TABLE "live_odds_snapshot" IS
  'Per-fixture latest snapshot of bookmaker odds (median across The Odds API bookmakers). Cron-refreshed, read by /admin/live-bets/suggestions.';
COMMENT ON COLUMN "live_odds_snapshot"."markets" IS
  'JSON-serialised MarketOdds[] (src/lib/odds.ts shape). Per-bookmaker raw data is intentionally dropped to keep the row small and the read fast.';
