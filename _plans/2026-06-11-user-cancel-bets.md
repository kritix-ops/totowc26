# 2026-06-11 — User-facing cancel + clear modify for all bets

## Goal

Until the betting window for a bet is closed, the **owner** of the pick
must be able to:

1. **Modify** their pick (already supported by overwrite-on-save — verify
   the UX makes this obvious end-to-end).
2. **Cancel** their pick — remove it entirely, refunding any stake to
   the bank, with no record left behind from the user's perspective.

Scope, confirmed with the user:

- All bet surfaces: match-score 1/X/2, live custom bets (match + day
  scope), tournament / stage / group free-pick bets.
- Cancellation is **owner-explicit-update only** — only the signed-in
  owner can clear their own pick. This is the carve-out the
  `feedback_user_bets_are_sacred` memory already permits.
- After a cancel, the deadline auto-fill cron is still allowed to fill
  the now-empty slot with a random pick — same behavior as a user who
  never picked in the first place.

## Non-goals

- Cancelling **duels** (they already have their own `cancelled` state
  driven by no-joiner-by-deadline / admin override; out of scope here).
- Admin-side cancel — already exists via `clearMatchPickAdmin` /
  `clearCustomPickAdmin` with audit trail.
- Bet-history / "undo a cancel" — once cancelled, the row is gone and
  the auto-fill cron will treat the user as un-picked from then on.

## Architecture

### Write-core: two new owner-cancel entrypoints

In `src/lib/bets/write-core.ts`, alongside `writeMatchPick` and
`writeCustomPick`:

- `cancelMatchPickSelf(principal, { matchId })`:
  - Accepts only `kind: "self"` principals (mirrors `writeMatchPick`).
  - Re-runs the same lock-resolution as the write path: `status ==
    'scheduled'`, kickoff in future, `effectiveLockAt > now`.
  - Deletes the row from `match_bets` where `(userId, matchId)`.
  - Returns the same `WriteOutcome` discriminator we use everywhere so
    callers can map errors identically.

- `cancelCustomPickSelf(principal, { customBetId })`:
  - Opens the same advisory-locked transaction (`lockUserForBetting`)
    used by `writeCustomPick`.
  - Loads the bet, asserts `status == 'open'` and the resolved
    `effectiveLockAt > now`.
  - Loads the existing pick; if missing or `existing.locked`, skip.
  - Deletes the row. Bank balance is a query-side derivation
    (`bankBalanceSql`) so refund is automatic.

Both functions reuse `gateAccess` (so an admin proxy is _not_ allowed
through this path — admin clear goes through the audited
`clearMatchPickAdmin` / `clearCustomPickAdmin`).

### Transport: server actions + parallel-safe routes

Pattern mirrors the existing save surface:

- `src/lib/bets/cancel-match-pick-core.ts` — shared core
  (`performCancelMatchPick`) callable from both a server action and a
  route handler. Revalidates `bankCacheTag(user.id)` + the same paths
  the save path invalidates.
- `src/app/[lang]/bets/[matchId]/actions.ts` — adds `cancelBet(matchId)`
  server action.
- `src/app/api/bets/cancel/route.ts` — new POST endpoint with the same
  parallel-safe semantics as `/api/bets/save`.
- `src/app/[lang]/play/[date]/actions.ts` — adds `cancelCustomBetPick(id)`
  server action (revalidates the same tags / paths as
  `submitCustomBetPick`).

### UI

Cancel needs a friction step — one tap can destroy a thoughtful pick —
but the friction is light (an inline confirm chip, not a full modal,
keeps it lazy-user friendly per rule 10).

- **`src/app/[lang]/bets/[matchId]/BetForm.tsx`** — when `initialBet`
  is non-null and `editable`, render a secondary "Cancel pick" button
  to the left/right of the save button. Tapping it switches the button
  into a 2-step "Are you sure? Yes / No" confirm strip. Confirm triggers
  the `/api/bets/cancel` POST, then resets `home/away` to 0 and clears
  the saved flash.

- **`src/components/CustomBetCard.tsx`** — when `bet.myAnswer` is
  non-null and `editable`, render a "Cancel pick" tertiary button below
  the submit row. Same 2-step confirm pattern. On success, drop `draft`
  to `null`, clear `chosenStake` to the bet's default, and let
  `router.refresh()` flow new server props back.

- **Dashboard inline savers** (`DashboardPickCard`, `QuickPickRow`) —
  out of scope for V1. Users who placed picks inline can still cancel
  from the dedicated match page. If we discover users actively want
  inline cancel during QA, follow-up.

### Lazy-user UX guarantees

- The confirm strip uses identical positioning on every card so the
  user's thumb never has to rediscover it.
- The destructive button uses the `error` color token + `Trash` icon
  — visually distinct from "Update pick".
- Inline error messages live next to the existing save-error line; no
  new error surface.
- After cancel: success flash "ההימור בוטל / Bet cancelled" on the
  same line the save flash uses, with the bank pill updating from the
  revalidated `bankCacheTag`.

## Security (per rule 13)

- **Owner-only**: every cancel path builds a `self` principal from
  `getUser()`. The route handler returns 401 when unauthenticated and
  the server action returns `{ ok: false, error: "unauth" }`. There is
  no path that accepts a target userId from the request body.
- **Lock gate**: cancel re-runs the exact same `resolveMatchScoreLock`
  / `resolveCustomBetLock` check as the save path, so a user cannot
  cancel a pick after the deadline (this preserves match-grading
  correctness — admin still has the audited bypass).
- **Already-locked picks**: `userCustomBetPicks.locked == true` blocks
  cancel even if the bet status hasn't flipped yet (same defense as
  the write path).
- **Bank invariant**: refund is implicit (bank balance is a derived
  query), so there is no second write to keep in sync with the delete.

## Observability (per rule 14)

Every cancel emits one `console.info` log with namespace `[match-bet
cancel]` or `[custom-bet cancel]`, including `userId`, the bet/match id,
the prior pick we deleted, and `balanceAfter` (where computed). Errors
log via `console.error` with the same namespace.

The route handler logs `[api/bets/cancel] uncaught:` on the defensive
500 net, matching the save handler's shape.

## Settings (per rule 15)

Nothing to expose. Cancel is a baseline owner right, not a tunable
behavior. The deadline-window threshold that gates cancel is the same
one that gates save, already user-tunable via `/admin/deadlines`.

## Testing (per rule 18)

Unit tests (vitest), to land in this PR:

- `src/lib/bets/cancel-core.test.ts` (new):
  - cancelMatchPickSelf rejects when `canEdit=false`.
  - cancelMatchPickSelf rejects when lock has passed.
  - cancelMatchPickSelf returns `skipped/already_filled` when no row.
  - cancelMatchPickSelf deletes the row on the happy path (mock db).
  - Same matrix for cancelCustomPickSelf, plus the `existing.locked`
    rejection branch.
- `src/lib/bets/bet-immutability.test.ts` — extend:
  - The new cancel entrypoints must be guarded by the same `self`
    principal pattern. Source-level assertion that the new transport
    files (action + route) source `userId` from `getUser()` and never
    accept a body-supplied target id.
  - The cancel path must never accept an `admin_proxy` principal (admin
    clear stays on its own audited path).
- `src/app/api/bets/cancel/route.test.ts` (new): validates 401 on
  unauthenticated, 400 on bad payload, 200 on owner clear, 200 with
  `{ ok: false, error: "locked" }` after deadline.

Manual QA matrix to run before declaring done (per rule 6 + rule 18
golden-path + edges):

- Match pick: place, modify, then cancel, then re-place. Verify the
  bank pill updates after each step.
- Live custom bet: place 10-stake pick, cancel, verify bank refunds
  the 10. Re-place at a different stake.
- Tournament / group / stage free-pick: cancel removes the pick, bank
  is unchanged (it was 0-cost anyway).
- Deadline edge: try to cancel at lock-time minus 1s vs. lock-time
  plus 1s; the latter must reject.
- Auto-fill interaction: cancel a pick, then run the auto-fill cron
  past the deadline; the user gets a fresh random pick (rule per the
  user's product decision).
- Sandbox push-from-prod must NOT carry user picks back — the existing
  test guards this; cancel paths do not change the table list.
- Mobile widths 360/414/768: confirm strip fits, no horizontal scroll
  (per CLAUDE.md responsive contract).

## Open questions

None. Scope and product decisions all answered upfront.
