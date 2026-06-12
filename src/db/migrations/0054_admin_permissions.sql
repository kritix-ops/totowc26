-- Replace the single 'live_bets_admin' role with a per-user permission
-- catalog. See _plans/2026-06-12-live-bets-admin-role.md (revision 2)
-- for the design.
--
-- Shape: profiles.permissions is a JSONB object whose keys are
-- permission slugs and whose values are booleans. Empty object means
-- the user has no scoped operator permission (and is therefore a
-- regular player unless role = 'admin').
--
-- Recognised keys (the app validates against this allowlist):
--   liveBets         — /admin/bets, /admin/bets-overview,
--                      /admin/live-bets/*, /admin/deadlines
--   tournamentBets   — /admin/tournament-suggestions
--   tournamentOdds   — /admin/tournament-odds
--
-- Existing scoped operators (role = 'live_bets_admin', added in 0053)
-- get the equivalent permission flag and are demoted to role = 'player'
-- so the app code can stop reading the enum value entirely. The enum
-- value itself stays in place because Postgres makes enum-value removal
-- painful; the application no longer assigns it.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Defensive shape check: must be a JSON object. Anything else is
-- rejected by the DB so a buggy write can never store [], "", or null.
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_permissions_is_object"
  CHECK (jsonb_typeof("permissions") = 'object');

-- Migrate previously-scoped operators into the new model.
UPDATE "profiles"
SET    "permissions" = '{"liveBets": true}'::jsonb,
       "role"        = 'player'
WHERE  "role" = 'live_bets_admin';
