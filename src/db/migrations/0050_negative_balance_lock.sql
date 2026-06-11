-- Allow placements to drive bank balance into negative territory (capped),
-- and lock further live-bet / duel placements while balance < 0.
--
-- See _plans/2026-06-11-negative-balance-lock.md for the full design.
--
-- Two new knobs on settings:
--   * max_overdraft (int, default 30): a single bet can push balance to at
--     most -max_overdraft. Same cap for both live bets and duels.
--   * lock_bets_when_negative (bool, default true): kill-switch. When off,
--     the bank reverts to the legacy "balance >= stake" rule with no
--     overdraft and no negative-state lock.
--
-- Both are safe defaults so existing rows do not need backfill.

ALTER TABLE "settings"
  ADD COLUMN "max_overdraft" integer NOT NULL DEFAULT 30,
  ADD COLUMN "lock_bets_when_negative" boolean NOT NULL DEFAULT true;
