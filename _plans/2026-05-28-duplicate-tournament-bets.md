# Duplicate tournament bets: cleanup + prevention

## Goal

Users saw the same question twice on `/bets/tournament` ("מי תזכה במונדיאל
2026?", "מי תזכה במקום השלישי?", "מי תהיה סגנית אלוף..."). Root cause: the
admin "Tournament suggestions" surface inserts a fresh `custom_bets` row on
every Publish click with no guard. Re-clicking a template = duplicate row.

Two outcomes the user asked for:

1. **Clean up the current state** without nuking data — give the admin
   visibility into every active duplicate and let them choose which copy to
   keep.
2. **Stop the next regression** at the source — warn before publishing a
   second copy and require an explicit "Publish anyway" confirmation. Do
   not block outright; the admin might legitimately want two variants.

## Constraints

- No DB schema changes. The cleanup is admin-driven via the existing
  `cancelCustomBet` soft-cancel path (status → 'cancelled') which already
  drops a row out of `/bets/tournament` (filter is `status in ('open','locked')`).
- Stay inside the admin layout's `requireAdmin` guard — no new auth code.
- RTL and Hebrew copy throughout, mobile-first per
  `toto-mundial/CLAUDE.md`.

## Approach

### 1. Detection query (`src/db/admin-queries.ts`)

Two new exports:

- `listDuplicateCustomBets()` — groups active rows
  (draft / open / locked) by `(scope, match_id, matchday_id, stage,
  group_id, question_he)` and returns every row in a group of size ≥ 2.
  Returns the same `AdminCustomBetRow` shape plus `dedupKey` and
  `groupSize` for client grouping.
- `countDuplicateCustomBets()` — same predicate, returns the integer count
  so `/admin/bets` can render a banner cheaply.

### 2. Admin duplicates page (`/[lang]/admin/bets/duplicates`)

Server component that calls `listDuplicateCustomBets()` and groups rows
client-side by `dedupKey`. Each group renders as a Card with the shared
question + scope chip, and each row inside shows:

- "Copy #N" label, status chip, pick count chip (only when > 0)
- Lock time, created time, stake, payout
- The bet UUID (so the admin can match it against logs if needed)
- A "Details" link (to the existing `/admin/bets/[id]` page) and a
  "Cancel this copy" button that calls `cancelCustomBet` from the existing
  `admin/bets/actions.ts`.

The cancel button double-confirms when the row already has picks (refund
is real, so the admin should be deliberate). After cancel the row drops
out of the duplicates view on next refresh.

### 3. Banner on `/admin/bets`

When `countDuplicateCustomBets() > 0`, render a tertiary-toned `Card` link
above the FilterBar pointing at `/admin/bets/duplicates`. Hidden when
count is 0.

### 4. Publish guard
(`src/app/[lang]/admin/tournament-suggestions/actions.ts`)

Extend `publishTournamentTemplate`:

- New `force?: boolean` field on `TournamentTemplateInput`.
- New result variant: `{ ok: false; error: 'duplicate_exists'; existingId }`.
- Pre-insert SELECT: if a row exists with `scope='tournament'`, identical
  `question_he`, and status in (draft, open, locked), return the duplicate
  error with the existing id. Skipped when `force === true`.

### 5. Confirmation UI
(`src/app/[lang]/admin/tournament-suggestions/TournamentTemplateCard.tsx`)

On `duplicate_exists`, stash `existingId` in state. Render a warning panel
inside the card:

- "כבר קיים הימור פעיל עם השאלה הזו." with a short explanation that
  republishing creates a second copy.
- "Open existing" link → `/admin/bets/[existingId]`
- "Publish anyway" → re-calls `publishTournamentTemplate({ ..., force: true })`
- "Dismiss" → clears the warning, no insert.

## Files

Created
- `src/app/[lang]/admin/bets/duplicates/page.tsx`
- `src/app/[lang]/admin/bets/duplicates/DuplicateRowActions.tsx`

Modified
- `src/db/admin-queries.ts` — added `listDuplicateCustomBets`,
  `countDuplicateCustomBets`, type `AdminDuplicateBetRow`.
- `src/app/[lang]/admin/bets/page.tsx` — duplicate-count banner.
- `src/app/[lang]/admin/tournament-suggestions/actions.ts` — force flag +
  duplicate-exists error.
- `src/app/[lang]/admin/tournament-suggestions/TournamentTemplateCard.tsx`
  — warning panel + "Publish anyway" path.

## Alternatives rejected

- **Hard delete dupes instead of soft-cancel.** Loses the audit trail and
  any picks attached to the row. The existing soft-cancel already makes
  the row invisible to players; that is enough.
- **Block second publish outright.** The admin sometimes wants two
  templates (e.g. "Champion" both with EU-only payout and global). A hard
  block forces them to edit the template question text just to bypass the
  check, which corrupts data more than it helps.
- **Dedup via a DB unique index.** Same problem as a hard block, plus it
  ties the data model to one specific policy. Application-level guard +
  visibility lets us evolve the rule later.

## Security / observability

- All four mutations stay behind `isAdmin` checks (no new write path).
- `[tournament publish blocked: duplicate]` log line lets us trace
  attempted re-publishes.
- Cancel reuses the existing `[bet cancel]` log, so no new instrumentation
  needed.

## Settings audit

No new user-facing toggles. Whether to surface a "duplicate guard
on/off" admin toggle was considered and rejected — the only path that
needs it (publish anyway) is already controllable per-call.

## Open questions

- Should the `/admin/bets` banner ever auto-resolve dupes? No — every
  cancel is one-way and the admin must own the keep/drop call.
