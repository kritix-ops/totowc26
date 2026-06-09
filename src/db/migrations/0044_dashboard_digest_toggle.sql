-- Dashboard pool-digest toggle.
--
-- Adds the dashboard_digest_enabled boolean to settings so the
-- organizer can mute the new "What the pool picked today" card on
-- the home dashboard without taking the /transparency page itself
-- down. Defaults to TRUE so existing deployments start showing the
-- widget the first matchday after the migration runs.
--
-- See _plans/2026-06-09-transparency-coverage-and-dashboard-digest.md.

alter table public.settings
  add column if not exists dashboard_digest_enabled boolean
    not null
    default true;
