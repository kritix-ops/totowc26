-- Betting overhaul PR 1: match risk toggle, settings expansion, duels schema.
--
-- This migration is purely additive. No existing column is dropped here.
-- See _plans/2026-05-27-betting-overhaul.md §3-§4 for the full design.
--
-- Highlights:
--   1. Settings: match risk toggle + daily renewal toggle + duel limits +
--      live-odds normalization config + 7-way prize split (king 1/2/3 +
--      matches/live/duels winners + reserve) with sum=100 CHECK.
--   2. Direction-only payout (scoring_outcome) bumped from 3 to 5 per the
--      new plan; only the existing row that still holds the old default
--      is touched so any admin override is preserved.
--   3. Default starting_bank lowered from 100 to 30 for fresh installs
--      (the live row was already updated to 30 manually).
--   4. match_bets.stake_paid_main column for the optional risk-on mode.
--   5. duels table with RLS, scope CHECK, and supporting indexes. The
--      feature itself ships in PR 3 — this PR only adds the schema room.

-- 1) Duel status enum.
DO $$ BEGIN
  CREATE TYPE "duel_status" AS ENUM ('open', 'matched', 'settled', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- 2) Settings: every tunable for the overhaul. All additive; existing
-- columns stay put. Defaults match the plan §3-§4.
ALTER TABLE "settings"
  -- Match-guessing risk toggle. Default OFF — wrong picks earn 0 net.
  -- When ON, scoreFinalMatches() writes -match_risk_penalty for wrong picks.
  ADD COLUMN IF NOT EXISTS "match_risk_enabled"             boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "match_risk_penalty"             smallint NOT NULL DEFAULT 5,

  -- Daily renewal. Default OFF. When ON the cron inserts a point_adjustments
  -- row per active user at 00:00 Asia/Jerusalem with reason "חידוש יומי" so
  -- the audit trail captures it.
  ADD COLUMN IF NOT EXISTS "daily_renewal_enabled"          boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "daily_renewal_amount"           smallint NOT NULL DEFAULT 3,

  -- Duel limits.
  ADD COLUMN IF NOT EXISTS "duel_max_stake"                 smallint NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "duel_default_join_window_hours" smallint NOT NULL DEFAULT 24,

  -- Live-bet odds → stake/payout normalization knobs.
  ADD COLUMN IF NOT EXISTS "live_odds_base_stake"           smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "live_odds_max_payout"           smallint NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS "live_odds_house_edge_pct"       smallint NOT NULL DEFAULT 5,

  -- 7-way prize split. Sum must always be 100 — enforced by the CHECK
  -- added below in its own statement. The ADD COLUMN defaults already
  -- sum to 100 so the existing settings row picks them up cleanly.
  ADD COLUMN IF NOT EXISTS "prize_king_first_pct"           smallint NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "prize_king_second_pct"          smallint NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "prize_king_third_pct"           smallint NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS "prize_matches_winner_pct"       smallint NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "prize_live_winner_pct"          smallint NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "prize_duels_winner_pct"         smallint NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "prize_reserve_pct"              smallint NOT NULL DEFAULT 10;
--> statement-breakpoint

-- Sum-to-100 CHECK on the 7 new prize columns. Wrapped in a DO block so
-- re-running the migration after a prior partial apply is safe.
DO $$ BEGIN
  ALTER TABLE "settings" ADD CONSTRAINT "settings_prize_split_sums_100" CHECK (
    prize_king_first_pct + prize_king_second_pct + prize_king_third_pct
    + prize_matches_winner_pct + prize_live_winner_pct
    + prize_duels_winner_pct + prize_reserve_pct = 100
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- 3) Direction-only payout: bump from 3 to 5 per plan §3. Respect admin
-- overrides by only touching rows that still hold the old default.
UPDATE "settings" SET "scoring_outcome" = 5 WHERE id = 1 AND "scoring_outcome" = 3;
--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "scoring_outcome" SET DEFAULT 5;
--> statement-breakpoint

-- Starting bank default goes from 100 to 30 for fresh installs. The live
-- settings row was already updated to 30 manually so we do not UPDATE it
-- here — that would clobber any value the admin has tuned in between.
ALTER TABLE "settings" ALTER COLUMN "starting_bank" SET DEFAULT 30;
--> statement-breakpoint

-- 4) match_bets.stake_paid_main: optional snapshot of the risk penalty
-- in force at submit time. Null = no risk (default mode). Non-null = the
-- penalty that would apply on a wrong pick. scoreFinalMatches() still
-- writes the net into points_earned; this column is kept for audit and
-- for the bank breakdown display on /me/bank.
ALTER TABLE "match_bets"
  ADD COLUMN IF NOT EXISTS "stake_paid_main" smallint;
--> statement-breakpoint

-- 5) duels: 1v1 binary bet between two pool members. Opener posts a
-- yes/no question + stake + answer; joiner takes the opposite. Stakes
-- are deducted at open + at join (server actions in PR 3 own the
-- accounting via the bank formula extension in src/lib/bank.ts). The
-- feature itself lands in PR 3; this PR only creates the schema so the
-- subsequent PR has nothing to migrate.
CREATE TABLE IF NOT EXISTS "duels" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Opener side
  "opener_id"           uuid NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "opener_answer"       boolean NOT NULL,
  "stake"               smallint NOT NULL,

  -- Question text (both languages, like custom_bets)
  "question_he"         text NOT NULL,
  "question_en"         text NOT NULL,
  "grading_rule_he"     text NOT NULL,
  "grading_rule_en"     text NOT NULL,

  -- Scoping. Only match / day / tournament are supported for duels —
  -- stage / group can be added later if a real use case appears.
  "scope"               bet_scope NOT NULL,
  "match_id"            uuid REFERENCES "matches"("id")   ON DELETE CASCADE,
  "matchday_id"         uuid REFERENCES "matchdays"("id") ON DELETE CASCADE,

  -- Lifecycle
  "status"              duel_status NOT NULL DEFAULT 'open',
  "join_deadline_at"    timestamptz NOT NULL,
  "resolve_at"          timestamptz NOT NULL,

  -- Joiner side (null until matched)
  "joiner_id"           uuid REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "joined_at"           timestamptz,

  -- Settlement
  "resolved_value"      boolean,
  "settled_at"          timestamptz,
  "settled_by"          uuid REFERENCES "profiles"("id") ON DELETE SET NULL,

  "created_at"          timestamptz NOT NULL DEFAULT now(),

  -- Hard upper bound on stake. Actual enforcement against duel_max_stake
  -- happens in the server action; this is a sanity ceiling so a bug
  -- can never write an absurd value.
  CONSTRAINT "duels_stake_range"          CHECK (stake BETWEEN 1 AND 20),
  CONSTRAINT "duels_distinct_users"       CHECK (joiner_id IS NULL OR joiner_id <> opener_id),
  CONSTRAINT "duels_question_he_nonempty" CHECK (length(question_he) >= 1),
  CONSTRAINT "duels_question_en_nonempty" CHECK (length(question_en) >= 1),
  CONSTRAINT "duels_rule_he_nonempty"     CHECK (length(grading_rule_he) >= 3),
  CONSTRAINT "duels_rule_en_nonempty"     CHECK (length(grading_rule_en) >= 3),

  -- Scope-keys consistent: match needs both anchors, day needs matchday
  -- only, tournament has no anchors.
  CONSTRAINT "duels_scope_keys" CHECK (
    (scope = 'match'      AND match_id IS NOT NULL AND matchday_id IS NOT NULL) OR
    (scope = 'day'        AND match_id IS NULL     AND matchday_id IS NOT NULL) OR
    (scope = 'tournament' AND match_id IS NULL     AND matchday_id IS NULL)
  ),

  -- Status-driven invariants. A matched/settled duel must carry its
  -- joiner; a settled duel must carry its resolution + timestamp.
  CONSTRAINT "duels_matched_has_joiner" CHECK (
    status NOT IN ('matched', 'settled') OR (joiner_id IS NOT NULL AND joined_at IS NOT NULL)
  ),
  CONSTRAINT "duels_settled_has_resolution" CHECK (
    status <> 'settled' OR (resolved_value IS NOT NULL AND settled_at IS NOT NULL)
  )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "duels_opener_idx"   ON "duels" ("opener_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duels_joiner_idx"   ON "duels" ("joiner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duels_status_idx"   ON "duels" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duels_deadline_idx" ON "duels" ("join_deadline_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duels_match_idx"    ON "duels" ("match_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duels_matchday_idx" ON "duels" ("matchday_id");
--> statement-breakpoint

-- 6) RLS for duels. All writes flow through server actions running on
-- the admin DB connection (src/db/client.ts uses DATABASE_URL with full
-- access); clients only need read access (rendering the duel feed, the
-- live view, profile stats, transparency page). Admin keeps full access
-- through the is_admin() policy.
ALTER TABLE "duels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "duels read all" ON "duels"
  FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
CREATE POLICY "duels admin all" ON "duels"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint
