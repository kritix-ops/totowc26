-- Add 'match_canceled' to the user_notifications.kind whitelist.
--
-- scoreCanceledMatch (settling a canceled match's 1/X/2 guesses) inserts one
-- feed row per affected picker with kind = 'match_canceled' telling them how
-- their guess was resolved (refunded / graded vs technical score / split).
-- NOTIFICATION_KINDS in schema.ts already lists it, but the CHECK constraint
-- must be extended in lockstep or the insert fails with 23514 (check_violation)
-- — which notifyUsers swallows into a silent feed miss while the scoring
-- itself still commits.
--
-- Same DROP/re-ADD dance as 0061. The table is small and every existing row
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
      'bet_cancelled',
      'match_canceled'
    ));
