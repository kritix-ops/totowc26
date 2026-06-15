-- Per-user bet-history toggle.
--
-- Adds the transparency_history_enabled boolean to settings so the
-- organizer can mute the new "Player history" mode on /transparency
-- (one player's complete, all-surfaces betting history + head-to-head
-- compare) without taking the by-question transparency feed down.
-- Defaults to TRUE so the feature is live the moment the migration runs.
--
-- See _plans/2026-06-15-per-user-bet-history.md.

alter table public.settings
  add column if not exists transparency_history_enabled boolean
    not null
    default true;
