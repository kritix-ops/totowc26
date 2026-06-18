# Void a live bet and refund the pickers

Date: 2026-06-18
Branch: sandbox
Status: approved, in progress

## Goal

Give an admin a single, clear action on a live bet that **cancels the bet and
refunds the stake to everyone who picked** — including when the bet has
**already been graded**. The driving case: a live bet on a specific player
("will Mbappé score / assist"). When the player does not play at all, the
`auto_api_football` cron reads 0 goals and grades the bet "no", paying the
"no" pickers and burning the "yes" pickers. The admin needs to undo the whole
thing and make every picker whole, in one click, from the place they are
already looking (the bet detail page).

## Current state (verified in code)

- `cancelCustomBet(id)` (`admin/bets/actions.ts:483`) soft-cancels a bet and
  refunds **ungraded** picks by setting `points_earned = stake_paid` (nets the
  pick to zero in the bank formula `points_earned - stake_paid`). It **refuses
  graded / cancelled** bets. Surfaced only on the bets **list**
  (`BetsTableActions.tsx`) and the duplicates page — **not** on the detail page.
- `reverseCustomBetGrading(id, reason)` (`actions.ts:1028`) undoes a grade
  (graded → reversed), resets picks to NULL (implicit refund), writes a
  `bet_grading_audit` row. It does **not** cancel; the admin would then have to
  go back to the list and click "בטל". Two pages, three steps, easy to miss.

So the gap is: a one-click "cancel + refund" that also works on a **graded**
bet, surfaced on the **detail** page, with an audit trail and a player-facing
notice.

## Decisions (agreed with the user)

1. **Works on already-graded bets too** — one click reverses the grade, refunds
   every pick, and closes the bet as cancelled.
2. **Notify the pickers via the in-app feed only** (no push).
3. **Reason note is required** (mirrors reverse; written to the audit trail).

## Approach

Add a dedicated server action `voidCustomBet(id, reason)` rather than overload
`cancelCustomBet`. The list's quick-cancel keeps its no-reason path for
not-yet-graded bets; the detail page gets the full reason-required void that
also covers the graded case. Both share one refund mechanic so they cannot
drift (per the "grade paths must share payout logic" memory).

### Refund mechanic (the sacred part)

For **every** pick on the bet, set `points_earned = stake_paid`. In the bank
formula each pick contributes `points_earned - stake_paid`, so this nets the
pick to exactly zero: the picker is made whole, win or lose, graded or not.
This is the same mechanic `cancelCustomBet` already uses for ungraded picks,
applied to all picks. Insert-only / owner-neutral: we never delete a user's
pick row, we only zero its net — consistent with "user bets are SACRED".

### Steps

1. **Notification kind** — add `'bet_cancelled'` to `NOTIFICATION_KINDS`
   (`schema.ts`) and ship migration `0061_notification_kind_bet_cancelled.sql`
   that DROPs and re-ADDs the `user_notifications_kind` CHECK with the new value
   (same dance as 0059). Without the constraint migration the insert throws
   23514 and the notify silently fails (the 0059 lesson).

2. **`voidCustomBet(id, reason)`** in `admin/bets/actions.ts`:
   - Gate on `getUser()` + `hasPermission(user.id, "liveBets")`.
   - Require `reason.trim().length >= 3` → `invalid_reason`.
   - Reject `status === 'cancelled'` → `invalid_status` (nothing to void).
   - In one transaction: read the bet (status, resolvedValue, question);
     refund all picks; write a `bet_grading_audit` row with `action='cancel'`,
     `previousStatus`, `newStatus='cancelled'`, `previousResolvedValue`,
     `reason`, `performedBy`; update the bet to `status='cancelled'` and clear
     `resolvedValue / gradedAt / gradedBy`.
   - Capture distinct **non-bot** picker ids inside the txn.
   - **After commit** (best-effort, never blocks the refund): `notifyUsers`
     `{kind:'users', userIds}` with `{kind:'bet_cancelled', push:false}`, a
     Hebrew title/body ("ההימור בוטל / הנקודות הוחזרו"), url to the bets surface.
   - `revalidatePath` the admin list, detail, play layout, leaderboard.

3. **`VoidBetForm`** client component on the detail page: a clearly destructive
   (error-toned) "בטל הימור והחזר נקודות" button, a required reason input, a
   `window.confirm`, success/error states, `router.refresh()`. Rendered for any
   bet whose status is not already `cancelled`. Mobile-first, 48px targets,
   matches the existing `GradeForm` card styling.

4. **Tests** — source-level guard tests (the codebase's sacred-path testing
   style; there is no test DB harness) asserting `voidCustomBet`:
   refunds via `points_earned = stake_paid`, writes a `bet_grading_audit`
   `action: "cancel"` row, requires a reason, is gated by the `liveBets`
   permission, and sets status to `cancelled`.

## Security

- Same `liveBets` permission gate as grade / reverse / cancel. No new surface
  reachable by a non-admin.
- Refund is insert-only on intent: no pick row is deleted; only its net is
  zeroed. Cannot be used to move points between users.
- Reason is mandatory and written to the immutable `bet_grading_audit`
  (migration REVOKEs UPDATE/DELETE), so every void is attributable.

## Observability

- `console.info("[bet void]", { id, prevStatus, picksRefunded, recipients, by })`
  on success; `console.warn("[bet void denied]", …)` on permission fail;
  `console.error("[bet void] failed:", err)` on throw. Notify failure logged
  but swallowed so it never rolls back the refund.

## Settings audit

No new user-tunable setting. This is an admin corrective action, not a
behavior with a sensible per-user toggle. Intentionally not exposed in settings.

## Testing scope

- Unit (source-level guards): as above.
- Manual QA: void an open bet, a locked bet, and a graded bet; confirm each
  picker's bank returns to its pre-bet value, the bet shows "בוטל", the feed
  row lands, and a second void is rejected. Verify on 360px width.
- Out of scope: a live DB integration test (no test-DB harness in this repo;
  flagged per rule 18).

## Rejected alternatives

- **Overload `cancelCustomBet` to handle graded** — would change a working,
  list-relied-upon action's signature (it has no reason arg) and risk the
  quick-cancel path. Keeping a dedicated action is lower risk and clearer.
- **Reverse-then-cancel as the documented flow** — already technically
  possible but it is three steps across two pages and nobody connects them.
  Rejected as the primary UX; the new action collapses it to one click.
