-- Live-bet CATEGORY: the semantic "what kind of live bet is this" tag
-- (offside / yellow / red / corner / penalty / goals / btts / var / other)
-- used to group history for data-driven odds on NEW live bets. Yellow and
-- red are kept SEPARATE on purpose — the realized data shows them behaving
-- very differently. See _plans/2026-06-30-data-driven-live-bet-odds.md and
-- src/lib/bets/live-bet-category.ts (the single source of the value list).
--
-- Nullable and additive: only NEW bets store a category going forward.
-- Legacy rows stay NULL and are bucketed on read by the classifier, so this
-- migration re-prices nothing and touches no existing bet.

DO $$ BEGIN
  CREATE TYPE "public"."live_bet_category" AS ENUM (
    'offside', 'yellow', 'red', 'corner', 'penalty', 'goals', 'btts', 'var', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

ALTER TABLE "custom_bets"
  ADD COLUMN IF NOT EXISTS "category" "public"."live_bet_category";
--> statement-breakpoint

COMMENT ON COLUMN "custom_bets"."category" IS
  'Semantic live-bet type (offside/yellow/red/corner/penalty/goals/btts/var/other) for data-driven odds history. NULL on legacy rows; classified on read. Set only for new bets.';
