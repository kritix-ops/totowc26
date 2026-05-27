-- Admin-controlled page visibility. Single JSONB column on settings
-- holding an array of hidden page keys. Default '[]' so behaviour
-- after the migration matches today (everything visible). See
-- _plans/2026-05-27-page-visibility.md.
--
-- The hideable catalog (8 keys: bets, duels, leaderboard, tournament,
-- live, transparency, pay, rules) lives in src/lib/page-visibility.ts
-- and is validated in the server action. Unknown keys are rejected
-- there - they're not blocked at the DB level so the catalog can grow
-- without a migration backfill.
--
-- Shape constraint: array (possibly empty), strings only. We do not
-- CHECK against the catalog at the DB level for forward compatibility.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "hidden_pages" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

ALTER TABLE "settings"
  ADD CONSTRAINT "hidden_pages_is_array" CHECK (
    jsonb_typeof("hidden_pages") = 'array'
  );
