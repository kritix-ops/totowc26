-- Enforce at most one approved payment per user.
--
-- The pool charges a single fixed entry fee per person, so a user should
-- only ever have one approved payment row. In practice a second one could
-- sneak in (e.g. an admin "mark paid manually" row stacked on top of a real
-- Paybox payment that later got approved too). That double-counts in the
-- pot, and since the prize split runs off the pot, it silently inflates the
-- advertised prizes. The application now sums only each user's latest
-- approved row (src/db/pot.ts) so the displayed number is robust, but the
-- right place to make a duplicate impossible is the database.
--
-- Two steps, in one transaction:
--   1. Collapse any existing duplicates — keep the earliest approved row per
--      user (the original payment), delete the rest. Required before the
--      index can be created, and makes this migration self-healing on any
--      environment that already has duplicates.
--   2. Add a partial unique index so no second approved row can ever land.
--
-- Idempotent: the dedupe is a no-op once clean, and the index uses
-- IF NOT EXISTS.

BEGIN;

DELETE FROM public.payments
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY user_id
             ORDER BY submitted_at ASC, id ASC
           ) AS rn
    FROM public.payments
    WHERE status = 'approved'
  ) ranked
  WHERE rn > 1
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payments_one_approved_per_user"
  ON public.payments ("user_id")
  WHERE status = 'approved';

COMMIT;
