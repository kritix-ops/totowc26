-- Rename the `auto_balldontlie` value of the `grading_source` enum to
-- `auto_api_football`. The balldontlie integration was a stub that was
-- never wired up; we're going with API-Football Pro instead because it
-- covers all national-team competitions (friendlies, qualifiers,
-- Nations League, Copa, Euros) at half the price of balldontlie GOAT.
--
-- Safe because zero rows in custom_bets reference the old value (the
-- enum existed but no bet was ever authored with it as grading_source).
-- A single ALTER TYPE ... RENAME VALUE is atomic in Postgres and does
-- not require touching any row.

ALTER TYPE "grading_source" RENAME VALUE 'auto_balldontlie' TO 'auto_api_football';
