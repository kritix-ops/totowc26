# Fix: save buttons stuck on "שומר…" after the first save

Date: 2026-05-29
Status: In progress
Reporter: user ("עבד רק עבור העדכון הראשון" — worked only for the first update)

## Symptom

On `/bets` (and every other inline-save surface) the first save flips
the button to "נשמר" correctly. Every subsequent save on the same page
sits on "שומר…" forever and never completes, even though the write
reaches the DB.

## Root cause (verified, not guessed)

Two facts combine:

1. **No Suspense on the heavy pages.** `src/app/[lang]/bets/page.tsx`
   awaits `loadEditableMatches` (up to 200 rows, 2 joins) +
   `getUserAccess` directly in the page component. A `revalidatePath`
   of that route forces a full re-fetch + re-render of all rows.

2. **`useTransition` couples the button to that re-render, and actions
   dispatch one at a time.** The Next docs
   (`node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`,
   line 206) state: "The client currently dispatches and awaits Server
   Functions one at a time." A server action wrapped in
   `startTransition` keeps `isPending` true until the revalidation it
   triggered has re-rendered the page. So:

   - Save #1 dispatches, the action returns, but the transition stays
     *pending* while the whole-page refetch is in flight.
   - Save #2's action is *queued behind* the still-pending first
     transition and never runs.
   - Button #2 shows "שומר…" indefinitely.

That is precisely "only the first one worked".

## Fix

Replace `useTransition` on every inline-save button with the official
event-handler pattern from the same docs (the `incrementLike`
example, lines 296-306): `await action()` directly, drive UI from the
return value, clear the pending flag in a `finally`. The `await`
resolves on the action's *response*, decoupled from revalidation.

Encapsulated once in `src/lib/use-pending-action.ts` (`usePendingAction`)
so the guarantee lives in a single place and every button behaves
identically. Guarantees: pending always clears (success / throw /
reject), re-entrant clicks ignored, unmount-safe.

Server-side `revalidatePath` / `updateTag` calls stay — data still
refreshes in the background; the button just no longer blocks on it.

## Files

New:
- `src/lib/use-pending-action.ts`

Refactored to `usePendingAction` (player-facing, the actual complaint):
- `src/app/[lang]/bets/QuickPickRow.tsx`
- `src/components/DashboardPickCard.tsx`
- `src/app/[lang]/bets/[matchId]/BetForm.tsx`
- `src/components/CustomBetCard.tsx`
- `src/app/[lang]/duels/[id]/DuelActions.tsx`
- `src/app/[lang]/pay/PayPanel.tsx`
- `src/app/[lang]/onboarding/OnboardingForm.tsx`

Refactored (admin inline-save panels, same failure mode):
- `src/app/[lang]/admin/PayboxSettingsPanel.tsx`
- `src/app/[lang]/admin/WhatsAppSettingsPanel.tsx`
- `src/app/[lang]/admin/SignupSettingsPanel.tsx`

## Full system sweep (round 2)

After the player-facing fix shipped, the same primitive was applied to
EVERY remaining inline-save surface that revalidates in place, so the
class of bug cannot recur anywhere:

- admin: PaymentsPanel, SignupRequestsList, PlayerReviewRow,
  ViewAsPanel, ViewAsBanner, BetsTableActions, DuplicateRow, GradeForm,
  PublishRow, RefreshFixtureButton, TournamentTemplateCard,
  AdjustmentForm, ScoringForm, DeadlinesForm (6 sub-sections),
  PageVisibilityForm, MobileNavForm, RulesEditor, UsersExplorer
  (3 sub-sections), SyncPanel (3 sub-sections), BackupPanel,
  SandboxPanel (3 sub-sections), BroadcastForm, email TestForm,
  PushTestForm
- player/profile: PushOptInToggle, WhatsAppInviteCard

`router.refresh()` is intentionally KEPT in the converted admin forms:
with usePendingAction (no startTransition) it is fire-and-forget — it
returns void synchronously, so the button releases on the action
response and the refresh runs in the background. Same data-refresh
behaviour, no hang.

## Intentionally left on `useTransition`

Navigating forms (they navigate away after the action, so the
transition settles on navigation, not an in-place revalidation — no
hang):
- `src/app/[lang]/login/LoginForm.tsx`
- `src/app/[lang]/set-password/SetPasswordForm.tsx`
- `src/app/[lang]/signup/SignupForm.tsx`
- `src/app/[lang]/duels/new/NewDuelForm.tsx`
- `src/app/[lang]/admin/bets/BetForm.tsx`
- `src/components/LanguageToggle.tsx`
- `src/components/ProfileMenu.tsx`

ContentEditor: one shared transition drives many independently-saving
rows and discards `pending` (no visible "Saving…" button). Converting
it to the single-flight usePendingAction would wrongly serialise row
saves, and it has no stuck-button symptom — so it stays.

## QA checklist

- Save 5+ different match rows in a row on `/bets` — each flips to
  "נשמר" within a beat, none stick.
- Save the same row twice (change score, save again).
- Custom bet pick: submit several different bets on `/play/[date]`.
- Duel join, then settle, then a second duel action.
- Admin: save Paybox URL twice in a row.
- Offline / server error: button returns to "שמור" with an error line,
  not stuck on "שומר…".
- tsc + lint clean.
