-- Bump entry fee from 100 to 120 ILS.
--
-- Paybox group is configured to collect 120 ILS per player, but the app
-- still recorded 100 in:
--   - settings.entry_fee_ils (admin stats / pot math)
--   - payments.amount_ils inserts (recordPayment + manualMarkPaid)
--   - the UI label dictionaries
--
-- Front-end constants and the two server actions now read from
-- ENTRY_FEE_ILS = 120. This migration syncs the persisted state:
--   1) Update the column default so future installs land on 120.
--   2) Update the singleton settings row so admin pot math is correct.
--   3) Update existing pending payments so the recorded amount matches
--      what users were actually charged. Approved/rejected rows are
--      historical and stay untouched.

ALTER TABLE "settings"
  ALTER COLUMN "entry_fee_ils" SET DEFAULT 120;
--> statement-breakpoint

UPDATE "settings" SET "entry_fee_ils" = 120 WHERE "id" = 1;
--> statement-breakpoint

UPDATE "payments" SET "amount_ils" = 120
  WHERE "amount_ils" = 100 AND "status" = 'pending';
