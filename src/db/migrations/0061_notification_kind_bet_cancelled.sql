-- Add 'bet_cancelled' to the user_notifications.kind whitelist.
--
-- voidCustomBet (admin "cancel live bet + refund pickers") inserts one feed
-- row per picker with kind = 'bet_cancelled'. NOTIFICATION_KINDS in schema.ts
-- already lists it, but the CHECK constraint must be extended in lockstep or
-- the insert fails with 23514 (check_violation), which notifyUsers would
-- surface as a silent feed miss while the refund itself still committed.
--
-- Same DROP/re-ADD dance as 0059. The table is small, every existing row
-- already holds a valid kind, so the ADD validates instantly.
ALTER TABLE "user_notifications"
  DROP CONSTRAINT IF EXISTS "user_notifications_kind";
--> statement-breakpoint

ALTER TABLE "user_notifications"
  ADD CONSTRAINT "user_notifications_kind"
    CHECK ("kind" IN (
      'announcement',
      'bet_graded',
      'match_final',
      'custom',
      'lock_reminder',
      'duel_received',
      'live_bet',
      'bet_cancelled'
    ));
