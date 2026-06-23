-- Add a `backdated` flag to bet_admin_audit.
--
-- The admin self-backdate feature (_plans/2026-06-23-admin-self-backdate-bets.md)
-- lets a full admin correct their OWN bet after a match has already started or
-- finished — the recurring "loading forever" DB hang sometimes drops a save, so
-- the intended pick never persisted. Those writes reuse this audit table, but
-- they are categorically different from a normal pre-deadline admin override:
-- they land AFTER kickoff. `lock_bypassed` already marks deadline-overriding
-- writes, but a self-backdate is the stronger case (the match clock is running
-- or done), so a dedicated flag lets the private audit view single them out.
--
-- Backfills to false for every existing row, which is correct: no prior row was
-- a post-kickoff self-backdate (that path did not exist). The column inherits
-- the table's REVOKE UPDATE/DELETE immutability from migration 0043.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE "bet_admin_audit"
  ADD COLUMN IF NOT EXISTS "backdated" boolean NOT NULL DEFAULT false;
