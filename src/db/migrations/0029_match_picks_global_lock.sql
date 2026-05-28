-- Global cutoff for all 1/X/2 match picks. The pool decided every match
-- pick (across the entire tournament) closes at one absolute moment
-- rather than per-match offsets, so the late-rounds picks land at the
-- same time as the group-stage picks. Stored as a single nullable
-- timestamptz on settings; null = fall back to the existing per-match /
-- per-day / type-default cascade so an admin can disable the global cap
-- without dropping the column.
--
-- Seed value: 2026-06-10 23:59:00 Asia/Jerusalem (= 20:59:00 UTC in
-- IDT). This is one minute before the tournament's opening day, so
-- every player has their full slate locked in before kickoff.
--
-- Sibling change in the same migration: bump custom_match and custom_day
-- defaults from 5 → 60 minutes so live bets and day-scope custom bets
-- align with the new "one hour before" rule for everything that is not
-- a match pick. Stage / group / tournament defaults were already 60.
-- Existing custom_bets rows keep their snapshotted lock_at; admin can
-- backfill via /admin/deadlines if they want the new default applied
-- retroactively (the admin UI already explains this).

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "match_picks_global_lock_at" timestamptz;
--> statement-breakpoint

UPDATE "settings"
SET "match_picks_global_lock_at" = TIMESTAMPTZ '2026-06-10 20:59:00+00'
WHERE "id" = 1 AND "match_picks_global_lock_at" IS NULL;
--> statement-breakpoint

UPDATE "bet_lock_defaults"
SET "offset_minutes" = 60, "updated_at" = now()
WHERE "bet_type" IN ('custom_match', 'custom_day')
  AND "offset_minutes" <> 60;
