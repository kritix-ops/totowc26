-- Backfill approved/rejected payments to 120 ILS.
--
-- Migration 0031 bumped the entry fee from 100 to 120 but intentionally
-- left status='approved' and status='rejected' rows untouched, treating
-- them as historical. In practice the live Paybox group was already
-- collecting 120 from day one — only the DB row value lagged because
-- recordPayment/manualMarkPaid wrote a hardcoded 100 before the constant
-- was fixed. Result: the pot UI summed amount_ils across approved rows
-- and showed 100 ILS per player instead of 120 (e.g. 2 players = 200
-- in the prize-split panel, should be 240).
--
-- This migration backfills the remaining 100-amount rows to 120. Scoped
-- to status<>'pending' so 0031 doesn't get double-applied; scoped to
-- amount_ils=100 so any future explicit overrides are left alone.
--
-- Note: the prize-split query is wrapped in unstable_cache with a 600s
-- revalidate window and CACHE_TAG_POOL. After this migration runs the
-- panel will keep showing the old number until the next admin payment
-- action (which calls updateTag(CACHE_TAG_POOL)) OR up to 10 minutes
-- have passed.

UPDATE "payments" SET "amount_ils" = 120
  WHERE "amount_ils" = 100 AND "status" <> 'pending';
