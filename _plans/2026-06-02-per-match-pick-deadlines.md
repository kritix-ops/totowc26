# Per-match deadlines for score picks (1/X/2)

Date: 2026-06-02
Status: implemented

## Goal

Match-result bets (the 1/X/2 score pick on each fixture) should stay open
per match until shortly before that match's own kickoff, for the entire
World Cup, instead of all locking at one global cutoff the night before
the tournament.

Buffer chosen: **5 minutes before each match's kickoff** (small margin
against API kickoff-time drift; effectively "right before the match").

## Background / why this was non-trivial

Every score pick resolves through `resolveMatchScoreLock` in
`src/lib/deadlines.ts`. Priority:

1. per-match override (`matches.lock_at_override`)
2. **global cap** (`settings.match_picks_global_lock_at`)
3. per-matchday override
4. per-stage default
5. per-type default (`bet_lock_defaults.match_score`)

Migration `0029` seeded the global cap to `2026-06-10 23:59 Asia/Jerusalem`
(one minute before opening day). That single value masked the whole
per-match cascade, which is exactly why all picks locked at once. The cap
had **no admin UI** — it was only ever set from the migration, so an admin
could not clear it from the app.

The `match_score` per-type default was already `5` minutes (seeded in
`0021`; `0029` only bumped `custom_match`/`custom_day` to 60). So once the
global cap is cleared, picks already fall to 5 minutes before kickoff with
no default change required.

## Chosen approach

"Migration + admin toggle" (user-selected from the alternatives below).

1. **Migration `0039_per_match_pick_deadlines.sql`** (data-only):
   - `UPDATE settings SET match_picks_global_lock_at = NULL WHERE id = 1`
   - `UPDATE bet_lock_defaults SET offset_minutes = 5 WHERE bet_type =
     'match_score' AND offset_minutes <> 5` (pins intent explicitly)
   - Registered as journal entry idx 39. Auto-applies on deploy via
     `prebuild` -> `scripts/maybe-migrate.mjs`, to prod and sandbox.
2. **Admin control** on `/admin/deadlines` so the cap can be re-imposed or
   cleared from the UI later without another migration:
   - `saveMatchPicksGlobalLock(isoOrNull)` server action (mirrors
     `saveTournamentStart`), gated by `isAdmin`, logs old/new value.
   - Page reads `settings.match_picks_global_lock_at` and passes it down.
   - `MatchPicksGlobalLockCard` rendered first in `DeadlinesForm`, with a
     live status caption: empty = "per-match mode, each match closes N min
     before its kickoff"; set = "global lock mode, all picks close at X".

No change to the resolver itself — the cascade was already built to fall
back to per-match when the cap is null.

## Alternatives rejected

- **Migration only** — clears the cap + pins the default, but leaves the
  cap with no UI, so re-imposing a global freeze would need another
  migration. Rejected: admin wanted reversibility from the app.
- **Direct DB update** — fastest, but not version-controlled and would
  have to be run twice (prod + sandbox). Rejected for the same reasons we
  use migrations everywhere else.

## Files changed

- `src/db/migrations/0039_per_match_pick_deadlines.sql` (new)
- `src/db/migrations/meta/_journal.json` (idx 39 entry)
- `src/db/schema.ts` (comment on `matchPicksGlobalLockAt` updated)
- `src/app/[lang]/admin/deadlines/actions.ts` (new action)
- `src/app/[lang]/admin/deadlines/page.tsx` (read + pass cap)
- `src/app/[lang]/admin/deadlines/DeadlinesForm.tsx` (new card + wiring)

## Security

- The new action reuses `requireAdminId()` (auth + `isAdmin`) like every
  other deadline action. Input is a single ISO string or null, validated
  with `new Date()` + `NaN` check; bad input returns `invalid`, never
  writes. No new attack surface beyond the existing settings writes.

## Observability

- `console.info("[admin deadlines match-picks-global-lock]", { adminId,
  oldValue, newValue })` on every save, matching the existing
  `[admin deadlines ...]` namespaces. The resolver already logs
  `[deadline resolve]` per pick and `[deadline context load]` per request,
  so a mis-locked pick can be traced end to end.

## Settings audit

The control IS the new setting. Defaults to "off" (per-match) after the
migration. Buffer is editable via the existing `match_score` per-type
default in the same page. Nothing else needs exposing.

## Testing

- `src/lib/deadlines.test.ts` (20 tests) passes unchanged; the case "falls
  back to the per-type default when both overrides are null" is exactly the
  shipped behavior (cap null -> kickoff - 5 min).
- The server action is pure DB I/O with no seam and mirrors the untested
  `saveTournamentStart`; the project does not unit-test DB-bound actions
  (vitest can't reach Postgres). Behavior verified via the resolver tests.
- `tsc --noEmit`: no new errors (two pre-existing errors in
  `admin/sandbox/page.tsx`, unrelated typed-routes manifest issue).
- `eslint` on all changed files: clean.

## Operational note before/after deploy

Verify against the live DB that no stray per-match overrides
(`matches.lock_at_override`), per-matchday overrides
(`matchdays.lock_offset_override_minutes`), or per-stage defaults
(`stage_lock_defaults`) were set for score picks while the global cap was
active — any of those would still win over the 5-minute default and break
the uniform rule. They were pointless under the global cap, so none are
expected, but confirm rather than assume.
