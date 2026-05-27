-- Admin-controlled mobile navigation config.
--
-- Single JSONB column on the settings singleton that drives which items
-- appear in the mobile bottom bar, in what order, and how many cells the
-- bar holds. Items not in `items` are hidden. If `length(items)` exceeds
-- `bottomBarCount`, the last bar slot becomes "More" and overflow spills
-- into the bottom sheet. See _plans/2026-05-27-admin-mobile-nav-config.md.
--
-- Default matches the pre-migration hardcoded layout so behaviour is
-- unchanged immediately after the migration runs. CHECK constraints
-- prevent server-side corruption (empty list, out-of-range count).

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "mobile_nav_config" jsonb NOT NULL DEFAULT
  '{"items":["home","bets","duels","leaderboard","tournament","live","transparency","pay","admin","profile","rules"],"bottomBarCount":5}'::jsonb;
--> statement-breakpoint

ALTER TABLE "settings"
  ADD CONSTRAINT "mobile_nav_config_shape" CHECK (
    jsonb_typeof(mobile_nav_config->'items') = 'array'
    AND jsonb_array_length(mobile_nav_config->'items') >= 1
    AND (mobile_nav_config->>'bottomBarCount')::int BETWEEN 2 AND 5
  );
