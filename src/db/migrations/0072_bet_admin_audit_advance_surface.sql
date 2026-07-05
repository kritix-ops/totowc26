-- Allow the "who advances?" (מי עולה) surface in bet_admin_audit.
--
-- The admin retroactive-fix screen (_plans/2026-07-05-admin-backdate-all-users-advance.md)
-- now edits three bet surfaces: 1/X/2 score picks ('match'), custom bets
-- ('custom'), and the knockout "who advances?" pick ('advance'). The advance
-- pick lives in match_advance_bets and, like a score pick, is anchored to a
-- match — so its audit row reuses match_id (never custom_bet_id).
--
-- Two constraints from migration 0043 need widening:
--   1. bet_admin_audit_surface_valid — add 'advance' to the allowed set.
--   2. bet_admin_audit_surface_xor    — add the advance branch (match_id set,
--      custom_bet_id null), mirroring the match branch.
--
-- The table's REVOKE UPDATE/DELETE immutability (migration 0043) is unchanged.
-- Idempotent: DROP CONSTRAINT IF EXISTS then ADD, so a re-run is a no-op.

BEGIN;

ALTER TABLE "bet_admin_audit"
  DROP CONSTRAINT IF EXISTS "bet_admin_audit_surface_valid";
--> statement-breakpoint

ALTER TABLE "bet_admin_audit"
  ADD CONSTRAINT "bet_admin_audit_surface_valid"
    CHECK ("surface" IN ('match', 'custom', 'advance'));
--> statement-breakpoint

ALTER TABLE "bet_admin_audit"
  DROP CONSTRAINT IF EXISTS "bet_admin_audit_surface_xor";
--> statement-breakpoint

ALTER TABLE "bet_admin_audit"
  ADD CONSTRAINT "bet_admin_audit_surface_xor"
    CHECK (
      ("surface" = 'match'   AND "match_id"      IS NOT NULL AND "custom_bet_id" IS NULL) OR
      ("surface" = 'custom'  AND "custom_bet_id" IS NOT NULL AND "match_id"      IS NULL) OR
      ("surface" = 'advance' AND "match_id"      IS NOT NULL AND "custom_bet_id" IS NULL)
    );

COMMIT;
