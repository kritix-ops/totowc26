-- Drop the default lock offset for live (match/day) custom bets from 60
-- minutes before kickoff to 5 minutes before kickoff. Matches the user's
-- intent for the WC 2026 pool — live bets should accept picks as close
-- to kickoff as the bookmaker odds stay sane.
--
-- Tournament/stage/group scopes are unchanged (they keep the 60-minute
-- default — they anchor on a later match in the surface and the longer
-- buffer is by design).
--
-- This migration only touches the bet_lock_defaults rows. It does NOT
-- touch any existing custom_bets.lock_at — that column carries a
-- concrete snapshotted timestamp computed at publish time. There are no
-- live custom_bets rows in flight (confirmed by the user), so there is
-- nothing to backfill.
--
-- Code-level companion changes:
--   • src/lib/deadlines.ts FALLBACK_OFFSET_MINUTES drops to 5 so a
--     freshly seeded DB with no bet_lock_defaults rows gets the same
--     behaviour.
--   • src/app/[lang]/admin/live-bets/suggestions/actions.ts publishes
--     stop hardcoding (kickoff - 60min) and instead route through
--     getDeadlineContext() so the admin can keep tuning the value
--     from /admin/deadlines without a follow-up code change.

UPDATE "bet_lock_defaults"
   SET "offset_minutes" = 5
 WHERE "bet_type" IN ('custom_match', 'custom_day');
