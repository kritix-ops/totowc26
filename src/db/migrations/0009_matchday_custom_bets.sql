-- Matchday + custom-bets system.
--
-- Adds the foundation for admin-authored bets organised by matchday
-- (Asia/Jerusalem calendar date) and by tournament-wide scope. This
-- migration is purely additive: no existing column is dropped here.
-- Legacy BTTS / Over 2.5 / halftime columns on match_bets stay live
-- until call sites have been migrated to read from custom_bets - they
-- will be dropped in a follow-up migration once nothing reads them.
--
-- New objects:
--   1. Enums:        answer_type, bet_scope, bet_status, grading_source
--   2. Settings:     8 columns of default stake / payout per answer type
--   3. Tables:       matchdays, custom_bets, user_custom_bet_picks,
--                    bet_grading_audit
--   4. RLS policies: public read where appropriate, admin-only write,
--                    own-row write on picks with lock-time gate
--   5. Immutability: REVOKE UPDATE / DELETE on bet_grading_audit
--
-- See _plans/2026-05-25-matchday-custom-bets-system.md for the full
-- design rationale.

-- 1) Enums. Each wrapped in a DO block so re-running the migration in
-- dev (where the type may already exist) doesn't error.
DO $$ BEGIN
  CREATE TYPE "answer_type" AS ENUM ('yes_no', 'number', 'multi_choice', 'free_text');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "bet_scope" AS ENUM ('match', 'day', 'stage', 'group', 'tournament');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "bet_status" AS ENUM ('draft', 'open', 'locked', 'graded', 'reversed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "grading_source" AS ENUM ('auto_balldontlie', 'auto_football_data', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- 2) Settings: per-answer-type default stake / payout. Per-bet override
-- happens on custom_bets at creation time (snapshot copy), so a future
-- settings change never retroactively re-prices an existing bet.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "stake_yes_no"         smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "payout_yes_no"        smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "stake_number"         smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "payout_number"        smallint NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS "stake_multi_choice"   smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "payout_multi_choice"  smallint NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "stake_free_text"      smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "payout_free_text"     smallint NOT NULL DEFAULT 10;
--> statement-breakpoint

-- 3a) matchdays: calendar-day container. Server derives the `date`
-- field from kickoff_at AT TIME ZONE 'Asia/Jerusalem' before insert so
-- DST and after-midnight matches land on the right day.
CREATE TABLE IF NOT EXISTS "matchdays" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "date"             date NOT NULL,
  "label"            text,
  "default_lock_at"  timestamptz,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "matchdays_date_uniq" ON "matchdays" ("date");
--> statement-breakpoint

-- 3b) custom_bets: the bet itself. One row per admin-authored bet.
-- The scope CHECK keeps the anchor columns consistent - exactly the
-- subset required by the chosen scope must be non-null.
CREATE TABLE IF NOT EXISTS "custom_bets" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  "scope"            bet_scope NOT NULL,
  "matchday_id"      uuid REFERENCES "matchdays"("id") ON DELETE CASCADE,
  "match_id"         uuid REFERENCES "matches"("id")   ON DELETE CASCADE,
  "stage"            stage,
  "group_id"         varchar(2) REFERENCES "groups"("id"),

  "question_he"      text NOT NULL,
  "question_en"      text NOT NULL,
  "grading_rule_he"  text NOT NULL,
  "grading_rule_en"  text NOT NULL,

  "answer_type"      answer_type NOT NULL,
  "answer_config"    jsonb NOT NULL DEFAULT '{}'::jsonb,

  "stake_snapshot"   smallint NOT NULL,
  "payout_snapshot"  smallint NOT NULL,

  "grading_source"   grading_source NOT NULL,
  "grading_config"   jsonb,
  "resolved_value"   jsonb,

  "status"           bet_status NOT NULL DEFAULT 'draft',
  "lock_at"          timestamptz NOT NULL,
  "published_at"     timestamptz,
  "graded_at"        timestamptz,
  "graded_by"        uuid REFERENCES "profiles"("id") ON DELETE SET NULL,

  "created_by"       uuid NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),

  -- Exactly the right anchor keys must be set per scope.
  CONSTRAINT "custom_bets_scope_keys" CHECK (
    (scope = 'match'      AND match_id    IS NOT NULL AND matchday_id IS NOT NULL) OR
    (scope = 'day'        AND match_id    IS NULL     AND matchday_id IS NOT NULL) OR
    (scope = 'stage'      AND stage       IS NOT NULL AND match_id    IS NULL     AND matchday_id IS NULL AND group_id IS NULL) OR
    (scope = 'group'      AND group_id    IS NOT NULL AND match_id    IS NULL     AND matchday_id IS NULL AND stage    IS NULL) OR
    (scope = 'tournament' AND match_id    IS NULL     AND matchday_id IS NULL     AND stage       IS NULL AND group_id IS NULL)
  ),
  CONSTRAINT "custom_bets_grading_rule_he_non_empty" CHECK (length(grading_rule_he) >= 3),
  CONSTRAINT "custom_bets_grading_rule_en_non_empty" CHECK (length(grading_rule_en) >= 3),
  CONSTRAINT "custom_bets_question_he_non_empty"     CHECK (length(question_he)     >= 1),
  CONSTRAINT "custom_bets_question_en_non_empty"     CHECK (length(question_en)     >= 1),
  CONSTRAINT "custom_bets_stake_nonneg"              CHECK (stake_snapshot  >= 0),
  CONSTRAINT "custom_bets_payout_positive"           CHECK (payout_snapshot >  0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "custom_bets_scope_idx"    ON "custom_bets" ("scope");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_bets_matchday_idx" ON "custom_bets" ("matchday_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_bets_match_idx"    ON "custom_bets" ("match_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_bets_status_idx"   ON "custom_bets" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_bets_lock_idx"     ON "custom_bets" ("lock_at");
--> statement-breakpoint

-- 3c) user_custom_bet_picks: one row per (user, custom_bet). answer is
-- jsonb so all four answer types share one column. stake_paid mirrors
-- custom_bets.stake_snapshot at submit time and is refunded atomically
-- on edit / clear / cancel.
CREATE TABLE IF NOT EXISTS "user_custom_bet_picks" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        uuid NOT NULL REFERENCES "profiles"("id")   ON DELETE CASCADE,
  "custom_bet_id"  uuid NOT NULL REFERENCES "custom_bets"("id") ON DELETE CASCADE,
  "answer"         jsonb NOT NULL,
  "stake_paid"     smallint NOT NULL,
  "points_earned"  smallint,
  "was_correct"    boolean,
  "locked"         boolean NOT NULL DEFAULT false,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_custom_bet_picks_stake_nonneg" CHECK (stake_paid >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "user_custom_bet_picks_uniq"
  ON "user_custom_bet_picks" ("user_id", "custom_bet_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_custom_bet_picks_user_idx"
  ON "user_custom_bet_picks" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_custom_bet_picks_bet_idx"
  ON "user_custom_bet_picks" ("custom_bet_id");
--> statement-breakpoint

-- 3d) bet_grading_audit: append-only log of every grade / reverse /
-- cancel. REVOKEd from client roles below so the trail is physically
-- immutable; corrections happen as new rows.
CREATE TABLE IF NOT EXISTS "bet_grading_audit" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "custom_bet_id"            uuid NOT NULL REFERENCES "custom_bets"("id") ON DELETE CASCADE,
  "action"                   text NOT NULL,
  "previous_status"          bet_status,
  "new_status"               bet_status NOT NULL,
  "previous_resolved_value"  jsonb,
  "new_resolved_value"       jsonb,
  "reason"                   text NOT NULL,
  "performed_by"             uuid NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "performed_at"             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bet_grading_audit_action_valid"
    CHECK (action IN ('grade', 'reverse', 'cancel')),
  CONSTRAINT "bet_grading_audit_reason_non_empty"
    CHECK (length(reason) >= 3)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bet_grading_audit_bet_idx"
  ON "bet_grading_audit" ("custom_bet_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_grading_audit_time_idx"
  ON "bet_grading_audit" ("performed_at" DESC);
--> statement-breakpoint

-- 4) RLS. Every new table gets it on by default. Policies follow the
-- conventions already in 0001_auth_and_rls.sql.

ALTER TABLE "matchdays"             ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_bets"           ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_custom_bet_picks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bet_grading_audit"     ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- matchdays: anyone authenticated may read (so the play index shows
-- which days have bets). Admin-only writes.
CREATE POLICY "matchdays read" ON "matchdays"
  FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
CREATE POLICY "matchdays admin write" ON "matchdays"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- custom_bets: drafts are admin-only. Once published (status != 'draft')
-- every authenticated user can read so they can place picks and see
-- grading history. Players never INSERT / UPDATE / DELETE - the admin
-- owns the lifecycle. Admin has full access.
CREATE POLICY "custom_bets read published" ON "custom_bets"
  FOR SELECT TO authenticated USING (status <> 'draft');
--> statement-breakpoint
CREATE POLICY "custom_bets admin all" ON "custom_bets"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- user_custom_bet_picks: read all (transparency among friends matches
-- the existing match_bets pattern from 0001). Players insert / update
-- their own row only while the bet is open and the lock cut-off hasn't
-- passed. Admin has full access.
CREATE POLICY "user_custom_bet_picks read all" ON "user_custom_bet_picks"
  FOR SELECT TO authenticated USING (true);
--> statement-breakpoint

CREATE POLICY "user_custom_bet_picks insert own" ON "user_custom_bet_picks"
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.custom_bets cb
      WHERE cb.id = user_custom_bet_picks.custom_bet_id
        AND cb.status = 'open'
        AND cb.lock_at > now()
    )
  );
--> statement-breakpoint

CREATE POLICY "user_custom_bet_picks update own unlocked" ON "user_custom_bet_picks"
  FOR UPDATE TO authenticated USING (
    user_id = auth.uid()
    AND locked = false
    AND points_earned IS NULL
    AND EXISTS (
      SELECT 1 FROM public.custom_bets cb
      WHERE cb.id = user_custom_bet_picks.custom_bet_id
        AND cb.status = 'open'
        AND cb.lock_at > now()
    )
  ) WITH CHECK (
    user_id = auth.uid()
    AND locked = false
  );
--> statement-breakpoint

CREATE POLICY "user_custom_bet_picks delete own unlocked" ON "user_custom_bet_picks"
  FOR DELETE TO authenticated USING (
    user_id = auth.uid()
    AND locked = false
    AND points_earned IS NULL
    AND EXISTS (
      SELECT 1 FROM public.custom_bets cb
      WHERE cb.id = user_custom_bet_picks.custom_bet_id
        AND cb.status = 'open'
        AND cb.lock_at > now()
    )
  );
--> statement-breakpoint

CREATE POLICY "user_custom_bet_picks admin all" ON "user_custom_bet_picks"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- bet_grading_audit: admins read all and insert with performed_by set
-- to themselves. Nobody (not even admin via Supabase clients) can
-- UPDATE or DELETE; the REVOKE below makes this physical.
CREATE POLICY "bet_grading_audit admin read" ON "bet_grading_audit"
  FOR SELECT TO authenticated USING (public.is_admin());
--> statement-breakpoint

CREATE POLICY "bet_grading_audit admin insert" ON "bet_grading_audit"
  FOR INSERT TO authenticated WITH CHECK (
    public.is_admin() AND performed_by = auth.uid()
  );
--> statement-breakpoint

-- 5) Immutability of the audit table.
REVOKE UPDATE, DELETE ON "bet_grading_audit" FROM authenticated;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "bet_grading_audit" FROM anon;
