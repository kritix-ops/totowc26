-- Player translation audit columns.
--
-- name_he in 0017 is just "what is the current Hebrew name". This
-- migration records WHERE the Hebrew name came from and HOW
-- confident we are in it, so:
--   * the admin review queue can sort by trust (reject → flag →
--     low-confidence approved → high-confidence approved)
--   * future re-syncs can compare against the manual_locked flag
--     and skip rows the admin has already vetted
--   * the LLM-expert reviewer (PR-3b) can flag rows that look
--     wrong even when multiple sources agree
--
-- Backward-compatible: all new columns are nullable / have safe
-- defaults so 0017's data shape keeps working.

ALTER TABLE "players"
  ADD COLUMN IF NOT EXISTS "name_he_source"          text,                          -- 'wikidata' / 'walla' / 'one' / 'sport5' / 'sport1' / 'ynet' / 'llm_claude' / 'llm_reviewer' / 'manual'
  ADD COLUMN IF NOT EXISTS "name_he_confidence"      smallint,                       -- 0-100
  ADD COLUMN IF NOT EXISTS "name_he_review_verdict"  text,                           -- 'approved' / 'flag' / 'reject' / NULL (unreviewed)
  ADD COLUMN IF NOT EXISTS "name_he_review_reason"   text,                           -- explanation from the LLM reviewer
  ADD COLUMN IF NOT EXISTS "name_he_reviewed_at"     timestamptz,                    -- when the row was last reviewed (LLM or admin)
  ADD COLUMN IF NOT EXISTS "name_he_admin_locked"    boolean NOT NULL DEFAULT false; -- true once an admin manually edits the row; pipeline skips locked rows
--> statement-breakpoint

ALTER TABLE "players"
  ADD CONSTRAINT "players_name_he_confidence_range" CHECK (
    name_he_confidence IS NULL OR (name_he_confidence >= 0 AND name_he_confidence <= 100)
  );
--> statement-breakpoint

ALTER TABLE "players"
  ADD CONSTRAINT "players_name_he_review_verdict_enum" CHECK (
    name_he_review_verdict IS NULL OR name_he_review_verdict IN ('approved', 'flag', 'reject')
  );
--> statement-breakpoint

-- Composite index for the admin review queue's main sort: verdict
-- bucket first (reject before flag before approved), then confidence
-- ascending so the lowest-confidence rows surface first inside each
-- bucket.
CREATE INDEX IF NOT EXISTS "players_review_queue_idx"
  ON "players" ("name_he_review_verdict", "name_he_confidence");
