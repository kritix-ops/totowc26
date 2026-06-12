-- Lower the live-bet stake ceiling and the overdraft cap to 10.
--
-- Team feedback (Or, Matan): a single live bet should risk at most ~10
-- points, not 30 (the whole starting bank). Lower the overdraft cap to
-- match so one bet can't push the bank past -10 either.
--
-- Plain operational values understood by every code version (no sentinel),
-- so this is safe to apply in any deploy order. The bet card pills filter
-- to <= max_stake automatically (STAKE_STOPS in CustomBetCard), so the row
-- collapses to 1 / 3 / 5 / 10 with no client change.

UPDATE "settings"
  SET "live_odds_max_stake" = 10,
      "max_overdraft" = 10
  WHERE "id" = 1;
