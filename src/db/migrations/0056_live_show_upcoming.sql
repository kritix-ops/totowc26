-- Live scoreboard upcoming-matches toggle.
--
-- Adds the live_show_upcoming boolean to settings so the organizer can
-- mute the "upcoming matches of the active matchday" feed on
-- /[lang]/live. The page still shows live matches and the last 90 min
-- of finals when the flag is off — only the scheduled rows disappear.
-- Defaults to TRUE: the feature should be on for everyone unless an
-- admin opts out.

alter table public.settings
  add column if not exists live_show_upcoming boolean
    not null
    default true;
