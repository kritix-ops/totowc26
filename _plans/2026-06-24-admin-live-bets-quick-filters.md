# Admin live-bets management: quick filters + remembered state

Date: 2026-06-24
Surface: `/[lang]/admin/bets` (the "ניהול הימורים" screen, live view)

## Goal

Make managing live bets far faster for the admin. Two concrete pains:

1. **Filters are forgotten on round-trip.** Editing a bet ("פרטים") and going
   back ("חזרה לרשימה") drops every filter and dumps the admin back on the full
   list. Root cause: the detail link and the back link are hardcoded to
   `/admin/bets` with no query string. Filter state already lives entirely in
   the URL — the links just throw it away.
2. **No fast matchday/match filter.** Match is a dropdown only; there is no
   "filter by matchday (date)" at all (`custom_bets.matchday_id` exists for both
   match- and day-scoped bets but is never exposed as a filter).

## Decisions (confirmed with user)

- Quick-filter layout: **drill-down — יום → משחק**. A horizontal strip of
  matchday pills; picking a day reveals only that day's match pills. Keeps the
  pill count tiny even with a full World Cup schedule.
- Persistence: **auto-restore last filter on a fresh visit**, plus a fast,
  tasteful **"נקה הכל"** clear control with an active-filters summary.

## Approach

### Data layer — `src/db/admin-queries.ts`
- `listCustomBets(opts)`: add `matchdayDate?: string | null`. New WHERE clause
  `(${day}::date is null or md.date = ${day}::date)`. The `matchdays` join
  already exists, so this captures both day-scoped and match-scoped bets anchored
  to that date.
- `listCustomBetMatches()`: add `matchdayDate` (`md.date::text`) to select +
  group-by so the client can bucket match pills under their day.
- New `listCustomBetMatchdays()` → `AdminBetMatchdayOption[] = { date, betCount }`,
  distinct live-family matchday dates with bet counts, newest first.

### Page — `src/app/[lang]/admin/bets/page.tsx`
- Parse `?day=` with `parseDayFilter` (strict `YYYY-MM-DD`); honor only on the
  live view (mirrors how `?match=` is gated).
- Fetch matchdays in the existing `Promise.all` (live only). Pass `day` to
  `listCustomBets`.
- Replace the `BetsMatchFilter` dropdown with the drill-down pill strips:
  - `MatchdayQuickFilter`: server-rendered `<Link>` pills, horizontal
    `snap-x` scroll. Selecting a day sets `?day=` and **clears** `?match=`.
  - `MatchQuickFilter`: shown only when a day is selected; pills for that day's
    matches, set `?match=` and keep `?day=`.
- Carry `day` through every existing chip rebuild (`FilterChip` carries it;
  `TypeChip` resets it along with match). Add `day` to the diagnostic log line.

### Persistence + clear — new client islands
- `BetsFilterMemory.tsx`: on mount, if the URL has no filter params, restore the
  last saved query string from `localStorage` (`admin-bets-filters-v1`) via
  `router.replace`; on every filter change, save the current query string. Fires
  the restore once (ref-guarded) and only when params are empty, so no loop.
- `BetsActiveFilters.tsx`: a summary row of the active narrowing filters
  (status / scope / day / match / search) as removable chips, plus a single
  **"נקה הכל"** that resets to `?` and wipes the saved value. Hidden when nothing
  is active.

### Round-trip carry — exact back-button UX
- `BetsTableActions.tsx`: append the current list query string as
  `?return=<encoded>` on the "פרטים"/"תקן תוצאה"/"ערוך" links (reads live
  `useSearchParams`).
- `[id]/page.tsx`: read `searchParams.return`, **sanitize** by re-parsing only
  whitelisted keys (`type,status,scope,match,day,q`) and rebuild the query —
  never reflect the raw string — then use it for the "חזרה לרשימה" link. Pass it
  on to the edit link too. (localStorage is the safety net for any deeper path.)

## Security (rule 13)
- `?day=` accepted only as strict `YYYY-MM-DD`; bound as a `::date` parameter,
  never interpolated. A junk value falls through to "no day filter".
- `return` is never used as a raw href. Only known filter keys are extracted and
  re-encoded onto the fixed `/admin/bets` path — no open-redirect, no injection.
- `localStorage` holds only a filter query string (no PII, no secrets).

## Observability (rule 14)
- Existing `[admin bets] list` log gains `day`.
- `BetsFilterMemory` logs `[admin bets memory] restore` / `save` with the value.

## Testing (rule 18)
- Unit-test `parseDayFilter` (valid date, junk, array, empty) and the `return`
  sanitizer (whitelist only, drops unknown/By-path keys) — pure functions,
  exported for test. Run the affected suite green before done.

## Settings audit (rule 15)
- Auto-restore is the chosen default; the "נקה הכל" control is the opt-out per
  use. No global setting added — a toggle would be one knob too many for a
  single-admin tool. Revisit if a second admin disagrees.

## Out of scope
- Duels/tournament views keep their current filters (no matchday concept there).
- No schema/migration changes — `matchday_id` + `matchdays.date` already exist.
