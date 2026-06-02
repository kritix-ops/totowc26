-- Per-match deadlines for 1/X/2 score picks. The pool changed the rule:
-- instead of one global cutoff that locked every match pick the night
-- before the tournament, each match's result bet now stays open until
-- shortly before that match's own kickoff, for the whole tournament.
--
-- Two data changes, no resolver code change. The cascade in
-- src/lib/deadlines.ts already falls back to the per-match / per-day /
-- per-stage / type-default chain whenever match_picks_global_lock_at is
-- null - this migration just clears the cap and pins the match_score
-- default to the agreed buffer.
--
--   1. Clear settings.match_picks_global_lock_at (was 2026-06-10 23:59
--      Asia/Jerusalem, seeded in migration 0029) -> the per-match cascade
--      takes over for every score pick.
--   2. Pin the match_score per-type default to 5 minutes before kickoff.
--      That is already the seeded value from migration 0021; set here
--      explicitly so the intent is documented and survives any prior
--      manual edit made while the global cap masked it.
--
-- The admin can re-impose a single global cutoff at any time from
-- /admin/deadlines (new "global match-picks lock" control shipped with
-- this change). Other bet types (custom_match, custom_day, custom_stage,
-- custom_group, custom_tournament) are untouched and keep their defaults.

UPDATE "settings"
SET "match_picks_global_lock_at" = NULL,
    "updated_at" = now()
WHERE "id" = 1;
--> statement-breakpoint

UPDATE "bet_lock_defaults"
SET "offset_minutes" = 5, "updated_at" = now()
WHERE "bet_type" = 'match_score' AND "offset_minutes" <> 5;
