-- Adds a scoped admin role for live-bet operators. See
-- _plans/2026-06-12-live-bets-admin-role.md for the full design.
--
-- `live_bets_admin` slots into the existing role enum between `player`
-- and `admin`. The application gate (src/lib/admin.ts) accepts the new
-- value for live-bet pages only; everything else under /admin/* still
-- requires `role = 'admin'`.
--
-- The Postgres `is_admin()` function used by RLS is intentionally
-- unchanged — it still matches only 'admin'. Production app code goes
-- through the service-role pooler URL and bypasses RLS, so the new role
-- gains its powers in application code without widening any RLS policy.
--
-- Enum-value addition is idempotent via IF NOT EXISTS.

ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'live_bets_admin' BEFORE 'admin';
