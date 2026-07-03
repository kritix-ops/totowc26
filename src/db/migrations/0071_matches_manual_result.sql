-- Manual match result entry (admin). When an admin punches a result in by hand
-- (API sync delayed or wrong), the match is flipped to final AND flagged
-- manual_result = true. The fixture-sync upsert skips any row where
-- manual_result is true, exactly like it already skips postponed/canceled
-- holds, so a late API update can never stomp the admin's entry.
-- "Manual override always wins." See
-- _plans/2026-07-03-manual-match-result-entry.md.

ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "manual_result" boolean NOT NULL DEFAULT false;
