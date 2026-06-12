-- Custom-option duels with per-option payout multipliers.
--
-- Until now every duel was a fixed yes/no with a 1:1 payout (winner
-- +stake, loser -stake). The opener wanted free-form options + custom
-- ratios per outcome - see _plans/2026-06-12-house-edge-duel-options-translation.md
-- Part 2 for the design rationale and the per-option payout math.
--
-- Schema additions (all nullable so legacy yes/no duels keep working):
--   options                        - jsonb array, [{key, labelHe, labelEn, multiplierPct}]
--   opener_option                  - which option the opener picked
--   joiner_option                  - which option the joiner picked (NULL until joined)
--   resolved_option                - which option won at settle time
--   opener_option_multiplier_pct   - frozen at open time for fast bank math
--   joiner_option_multiplier_pct   - frozen at join time for fast bank math
--
-- multiplierPct uses integer hundredths (1.5x = 150, 5.0x = 500) so the
-- bank balance SQL CASE can multiply with no float drift. Float math in
-- the running-balance subquery would diverge across PG versions; the
-- integer form gives us a single, exact result.
--
-- Existing duels (legacy yes/no with options IS NULL) are untouched -
-- the bank.ts SQL and the actions both branch on options IS NULL so
-- both shapes can coexist forever.

ALTER TABLE "duels"
  ADD COLUMN "options" jsonb,
  ADD COLUMN "opener_option" text,
  ADD COLUMN "joiner_option" text,
  ADD COLUMN "resolved_option" text,
  ADD COLUMN "opener_option_multiplier_pct" smallint,
  ADD COLUMN "joiner_option_multiplier_pct" smallint;

-- Legacy schema treated opener_answer as NOT NULL. New-style duels
-- carry their pick in opener_option instead, so we drop the constraint.
-- The duels_options_shape CHECK below replaces it: legacy rows still
-- have opener_answer (with options NULL); new rows have opener_option
-- (with opener_answer NULL).
ALTER TABLE "duels"
  ALTER COLUMN "opener_answer" DROP NOT NULL;

-- Shape consistency: either it is a legacy yes/no duel (every new
-- column NULL) or it is a custom-option duel (options + opener_option
-- + opener_option_multiplier_pct all present from the moment the duel
-- is opened). joiner_option and joiner_multiplier are set together
-- when the joiner joins.
ALTER TABLE "duels"
  ADD CONSTRAINT "duels_options_shape" CHECK (
    (
      -- Legacy yes/no duel.
      options IS NULL
      AND opener_answer IS NOT NULL
      AND opener_option IS NULL
      AND joiner_option IS NULL
      AND resolved_option IS NULL
      AND opener_option_multiplier_pct IS NULL
      AND joiner_option_multiplier_pct IS NULL
    )
    OR (
      -- New-style custom-option duel.
      options IS NOT NULL
      AND opener_answer IS NULL
      AND opener_option IS NOT NULL
      AND opener_option_multiplier_pct IS NOT NULL
      AND (
        (joiner_option IS NULL AND joiner_option_multiplier_pct IS NULL)
        OR (joiner_option IS NOT NULL AND joiner_option_multiplier_pct IS NOT NULL)
      )
    )
  );

-- Options array bounds: 2..5 entries, multipliers in [150, 500]. The
-- opener can never set a 1.0x multiplier (would be a guaranteed loss)
-- or above 5.0x (caps the bank blow-up on long-shot picks).
ALTER TABLE "duels"
  ADD CONSTRAINT "duels_options_count" CHECK (
    options IS NULL
    OR (jsonb_typeof(options) = 'array'
        AND jsonb_array_length(options) BETWEEN 2 AND 5)
  );

ALTER TABLE "duels"
  ADD CONSTRAINT "duels_opener_multiplier_range" CHECK (
    opener_option_multiplier_pct IS NULL
    OR opener_option_multiplier_pct BETWEEN 150 AND 500
  );

ALTER TABLE "duels"
  ADD CONSTRAINT "duels_joiner_multiplier_range" CHECK (
    joiner_option_multiplier_pct IS NULL
    OR joiner_option_multiplier_pct BETWEEN 150 AND 500
  );

-- Opener and joiner must pick different options. Mirrors the yes/no
-- model where the joiner always took the opposite side.
ALTER TABLE "duels"
  ADD CONSTRAINT "duels_options_distinct_picks" CHECK (
    joiner_option IS NULL
    OR opener_option IS NULL
    OR opener_option <> joiner_option
  );
