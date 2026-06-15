-- Add 'live_bet' to the user_notifications.kind whitelist.
--
-- The live-bet push composer (sendLiveBetPush → notifyUsers) inserts feed
-- rows with kind = 'live_bet', and NOTIFICATION_KINDS in schema.ts already
-- lists it, but the CHECK constraint set in 0036 was never extended. On any
-- DB still carrying the 0036 whitelist the insert fails with 23514
-- (check_violation), which the action swallows into a generic "send failed"
-- and the operator's push silently never goes out.
--
-- Same DROP/re-ADD dance as 0036. The table is small, so the constraint
-- re-validation is negligible; every existing row already holds a valid
-- kind, so the ADD validates instantly.
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
      'live_bet'
    ));
