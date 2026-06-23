-- Allow 'reopen' as a bet_grading_audit action.
--
-- reopenCustomBet (admin "reopen for filling") flips a bet that was reversed
-- by mistake back to 'open' so players can keep filling while the match has
-- not started. It records the move as a 'reopen' audit row. The original
-- CHECK from migration 0009 only allowed grade / reverse / cancel, so the
-- insert would fail with 23514 (check_violation) without this.
--
-- Idempotent DROP IF EXISTS + ADD (same dance as 0061) so applying it twice
-- — e.g. after the emergency 2026-06-19 manual prod fix already ran the same
-- statements — is a no-op.
ALTER TABLE "bet_grading_audit"
  DROP CONSTRAINT IF EXISTS "bet_grading_audit_action_valid";
--> statement-breakpoint

ALTER TABLE "bet_grading_audit"
  ADD CONSTRAINT "bet_grading_audit_action_valid"
    CHECK (action IN ('grade', 'reverse', 'cancel', 'reopen'));
