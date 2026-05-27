-- Admin setup-overhead deduction.
--
-- A fixed ILS amount that the admin pulls from the pot to cover setup
-- costs (paybox fees, hosting, design). The pot used for prize math
-- becomes max(0, sum(approved payments) - admin_overhead_ils), so the
-- whole 7-way category split scales down by the overhead before the
-- per-category percentage is applied.
--
-- Default 100 matches the current real-world cost. Admin can tune in
-- the scoring settings page; CHECK enforces non-negative.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "admin_overhead_ils" integer NOT NULL DEFAULT 100;
--> statement-breakpoint

ALTER TABLE "settings"
  ADD CONSTRAINT "admin_overhead_ils_nonneg" CHECK (admin_overhead_ils >= 0);
