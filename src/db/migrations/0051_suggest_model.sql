-- Admin-selectable Claude model for the live-bet AI suggestion generator.
--
-- Background: the generator (src/lib/bets/suggest/generate.ts) used to read
-- the model id only from the CLAUDE_MODEL_SUGGEST env var, which a non-
-- technical admin can't change without a redeploy. This column moves the
-- choice into settings so the organizer can trade cost for quality from the
-- admin UI, with a projected end-of-tournament cost shown per model.
--
-- The value is one of the ids in the fixed catalogue in
-- src/lib/bets/suggest/models.ts (Sonnet 4.6 by default). If a stored id is
-- ever retired, the generator falls back to the catalogue default.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "suggest_model" text NOT NULL DEFAULT 'claude-sonnet-4-6';

COMMENT ON COLUMN "settings"."suggest_model" IS
  'Claude model id used by the live-bet AI suggestion generator. One of the ids in src/lib/bets/suggest/models.ts.';
