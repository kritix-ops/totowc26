-- Outright-bet payout staging area for per-option longshot premium pricing.
--
-- Background: tournament-outright bets (Top scorer, Golden Ball, Champion,
-- Runner-up, Third, 12 Group winners) currently carry one flat payout per
-- bet — so picking Mbappé and picking a random Saudi defender both pay the
-- same. The intended behavior is per-option payout derived from real
-- bookmaker decimal odds via the existing normalizeOdds engine.
--
-- This table is the staging area. The fetcher script
-- (scripts/fetch-outright-odds.mjs) writes a snapshot here; admin reviews
-- and edits in /admin/tournament-odds; clicking Publish builds the
-- per-option MultiChoiceOption[] and writes it onto the target
-- custom_bets.answer_config. Once a user picks an option,
-- bet_picks.payout_snapshot freezes the per-option payout for life.
--
-- Surfaces are enumerated strings rather than a separate enum table — they
-- map 1:1 to admin-facing UI tabs and never need referential integrity.
--   top_scorer, golden_ball, champion, runner_up, third,
--   group_A .. group_L
--
-- (surface, option_kind, option_id) is unique: a surface lists players
-- (top_scorer/golden_ball) OR teams (the rest), never mixed, but the
-- option_kind column is still mandatory to disambiguate the join target
-- downstream (players.api_football_id vs teams.api_football_team_id).
--
-- admin_override is the lock against the Re-fetch button: when true, the
-- fetcher leaves that row alone. Lets admin freeze a manual price the
-- automated re-fetch would otherwise overwrite.

CREATE TABLE IF NOT EXISTS "outright_odds_snapshot" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "surface"        text NOT NULL,
  "option_kind"    text NOT NULL,
  "option_id"      integer NOT NULL,
  "display_name"   text NOT NULL,
  "decimal_odds"   numeric(10, 3) NOT NULL,
  "source"         text NOT NULL,
  "fetched_at"     timestamptz NOT NULL DEFAULT now(),
  "admin_override" boolean NOT NULL DEFAULT false,
  "notes"          text,

  CONSTRAINT "outright_odds_option_kind_chk"
    CHECK ("option_kind" IN ('player', 'team')),
  CONSTRAINT "outright_odds_decimal_odds_chk"
    CHECK ("decimal_odds" > 1.0 AND "decimal_odds" <= 1000.0),
  CONSTRAINT "outright_odds_source_chk"
    CHECK ("source" IN ('oddschecker', 'admin_manual', 'the_odds_api')),
  CONSTRAINT "outright_odds_unique_row"
    UNIQUE ("surface", "option_kind", "option_id")
);

CREATE INDEX IF NOT EXISTS "outright_odds_snapshot_surface_idx"
  ON "outright_odds_snapshot" ("surface");

COMMENT ON TABLE "outright_odds_snapshot" IS
  'Staging area for per-option payout pricing on tournament-outright bets. Admin reviews and publishes into custom_bets.answer_config.';

COMMENT ON COLUMN "outright_odds_snapshot"."admin_override" IS
  'When true, the Re-fetch script leaves this row alone. Lets admin lock in a manual price the fetcher would otherwise overwrite.';

-- user_custom_bet_picks.payout_snapshot — frozen payout per pick.
--
-- Before this column existed, custom_bets.payoutSnapshot (one flat value
-- per bet) was the payout every correct pick got. That's still the
-- fallback. For outright bets with per-option pricing (Top scorer,
-- Champion, Group winners), the picker's chosen MultiChoiceOption now
-- carries its own payoutOverride; we snapshot that override here so a
-- later admin re-publish of the bet does not retro-reprice a pick that
-- was already made.
--
-- Nullable on purpose: existing picks from before this migration have
-- no per-option payout — when grading sees NULL, it falls back to the
-- bet-level payoutSnapshot. New picks always write a value (either the
-- chosen option's payoutOverride or the bet-level default).

ALTER TABLE "user_custom_bet_picks"
  ADD COLUMN IF NOT EXISTS "payout_snapshot" smallint
  CHECK ("payout_snapshot" IS NULL OR ("payout_snapshot" >= 1 AND "payout_snapshot" <= 1000));

COMMENT ON COLUMN "user_custom_bet_picks"."payout_snapshot" IS
  'Frozen payout for THIS pick. Set at pick time from MultiChoiceOption.payoutOverride when present, else from custom_bets.payout_snapshot. NULL means pre-migration row; grader falls back to bet-level payout. 1..1000 sanity range.';
