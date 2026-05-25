-- Prize-pool split for the top 4 finishers.
--
-- The pot = sum of approved entry-fee payments. Each prize amount is
-- derived dynamically as floor(pot * prize_pct_N / 100), so the admin
-- only has to maintain the percentages — never the cash amounts.
--
-- Defaults: 50 / 30 / 15 / 5 (sums to 100, full pot is distributed).
-- Admin can tune in the scoring settings page; the CHECK enforces the
-- sum stays at or below 100 so payouts never exceed the pot.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "prize_pct_1" smallint NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "prize_pct_2" smallint NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "prize_pct_3" smallint NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "prize_pct_4" smallint NOT NULL DEFAULT 5;
--> statement-breakpoint

ALTER TABLE "settings" ADD CONSTRAINT "prize_pcts_nonneg" CHECK (
  prize_pct_1 >= 0
  AND prize_pct_2 >= 0
  AND prize_pct_3 >= 0
  AND prize_pct_4 >= 0
);
--> statement-breakpoint

ALTER TABLE "settings" ADD CONSTRAINT "prize_pcts_sum_lte_100" CHECK (
  prize_pct_1 + prize_pct_2 + prize_pct_3 + prize_pct_4 <= 100
);
