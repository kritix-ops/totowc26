-- Betting deadlines: admin-controlled lock cutoffs per bet type, per
-- matchday, and per individual bet/match. See
-- _plans/2026-05-27-betting-deadlines.md.
--
-- Layer 1: bet_lock_defaults table — one offset per bet type.
-- Layer 2: matchdays.lock_offset_override_minutes — per-day override.
-- Layer 3: matches.lock_at_override (1/X/2 bets) and the existing
--          custom_bets.lock_at (custom bets) — per-bet absolute lock.
--
-- settings.tournament_start_at is the explicit anchor for tournament-
-- scope custom bets. Nullable: when null, the resolver falls back to
-- MIN(matches.kickoff_at) so a fresh install behaves sensibly.
--
-- No data backfill needed — defaults preserve the current 5-min cutoff
-- for match bets and the existing per-bet lock_at for custom bets.

CREATE TABLE IF NOT EXISTS "bet_lock_defaults" (
  "bet_type" text PRIMARY KEY,
  "offset_minutes" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  CONSTRAINT "bet_lock_defaults_offset_nonneg"
    CHECK ("offset_minutes" >= 0),
  CONSTRAINT "bet_lock_defaults_bet_type"
    CHECK ("bet_type" IN (
      'match_score',
      'custom_match',
      'custom_day',
      'custom_stage',
      'custom_group',
      'custom_tournament'
    ))
);
--> statement-breakpoint

-- Seed defaults. match_score/custom_match keep the legacy 5-minute
-- cutoff so existing fixtures behave identically post-migration.
-- Stage/group/tournament use 60 minutes so opening a tournament-wide
-- bet without further admin tuning still gives players a known window.
INSERT INTO "bet_lock_defaults" ("bet_type", "offset_minutes") VALUES
  ('match_score',       5),
  ('custom_match',      5),
  ('custom_day',        5),
  ('custom_stage',     60),
  ('custom_group',     60),
  ('custom_tournament', 60)
ON CONFLICT ("bet_type") DO NOTHING;
--> statement-breakpoint

ALTER TABLE "bet_lock_defaults" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Read open to authenticated so the deadline resolver and the player
-- UI (countdown component) can both compute effective lock times.
CREATE POLICY "bet_lock_defaults read auth" ON "bet_lock_defaults"
  FOR SELECT TO authenticated USING (true);
--> statement-breakpoint

CREATE POLICY "bet_lock_defaults admin all" ON "bet_lock_defaults"
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- Tournament anchor. Nullable: when admin hasn't picked an explicit
-- start, the resolver falls back to MIN(matches.kickoff_at) so
-- 'X minutes before the tournament' stays meaningful immediately
-- after the migration runs, before the admin visits /admin/deadlines.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "tournament_start_at" timestamptz;
--> statement-breakpoint

-- Per-matchday override. When non-null, every bet anchored to a match
-- or matchday on this day uses this offset instead of its per-type
-- default. Stage/group/tournament bets are anchored elsewhere and are
-- unaffected by this column.
ALTER TABLE "matchdays"
  ADD COLUMN IF NOT EXISTS "lock_offset_override_minutes" integer;
--> statement-breakpoint

ALTER TABLE "matchdays"
  ADD CONSTRAINT "matchdays_lock_offset_override_nonneg"
    CHECK ("lock_offset_override_minutes" IS NULL OR "lock_offset_override_minutes" >= 0);
--> statement-breakpoint

-- Per-match absolute lock override for 1/X/2 score bets. When non-null,
-- wins over both the matchday override and the type default. Custom
-- bets anchored to this match still use custom_bets.lock_at as their
-- per-bet override.
ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "lock_at_override" timestamptz;
--> statement-breakpoint

-- Helpful index for the auto-lock sweep in src/lib/sync.ts. We scan
-- status='open' rows and compare effective lock vs now(); the lock_at
-- index on custom_bets already exists from migration 0009.
CREATE INDEX IF NOT EXISTS "matches_lock_at_override_idx"
  ON "matches" ("lock_at_override")
  WHERE "lock_at_override" IS NOT NULL;
