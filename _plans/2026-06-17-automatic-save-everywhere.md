# Automatic save everywhere + global save feedback

Date: 2026-06-17
Status: Built (all 5 slices landed). Type-clean, lint-clean, production build
compiles, 650 unit tests pass (incl. 8 new toast-store tests), dev server boots
and renders /he + /he/bets with no runtime errors. Live visual QA at the
breakpoints with an authenticated paid player is the one remaining manual check.
Owner decisions captured: auto-save reaches everywhere incl. admin drafts;
staking points stays a deliberate click; irreversible/fan-out admin actions
stay explicit.

## Goal

Remove the manual "Save" tap wherever it is safe to do so, so a user never
has to remember to save, and always gets a clear signal whether the save
worked or failed. The friends-pool surface is mobile-first (people checking
from a phone at a bar), so the felt experience is: change a thing, see it
save itself, and never wonder "did that stick?".

## What "save" means here (the three categories)

1. **Atomic-intent saves** — one field, one meaning, no valid intermediate
   state. Safe to auto-save.
   - Match 1/X/2 score picks (`QuickPickRow.tsx`) — idempotent upsert via the
     parallel Route Handler `/api/bets/save`. Safest possible surface.
   - Free-pick custom bets (tournament/stage/group scope, cost 0) in
     `CustomBetCard.tsx` — `submitCustomBetPick` with no stake.
   - Settings toggles (profile smart-hub flags, page visibility, etc.).

2. **Composed-intent saves** — many interdependent validated fields; every
   keystroke is a half-formed thought. Auto-save the WHOLE FORM as one
   snapshot on blur/navigation, never per-keystroke.
   - Admin bet-builder draft (`BetForm.tsx` → `createCustomBet`/
     `updateCustomBet`), draft-status bets only.

3. **Deliberate commits** — money movement or irreversible/fan-out. Stay an
   explicit click. NOT auto-saved.
   - Placing/raising a STAKE on a priced (match/day) live bet.
   - Cancelling a pick (keep the two-step confirm).
   - Admin: publish, grade, reverse, cancel/refund, send push, broadcast
     email, approve/reject payments, run backup, run data sync.

## Chosen approach

Governing rule (from the council): **atomic intent auto-saves; composed
intent snapshots; deliberate commits stay explicit.** The owner's
"stake stays a click" line sits inside this and is preserved.

### Build slices (each adds exactly one risk dimension)

**Slice 0 — Global feedback primitive (zero DB risk, ship alone).**
- A toast system: one context provider + `toast.success()/error()` API.
  RTL-aware positioning, respects `env(safe-area-inset-*)`, never overlaps
  the bottom nav, `dvh` not `vh`, dismissible, auto-expire on success,
  sticky on error.
- A reusable inline `SaveStatus` indicator: `idle | saving | saved | error`,
  persistent (does NOT flash and vanish), with a "tap to retry" affordance
  on error. This is the per-field signal; toasts are reserved for discrete
  actions and failures.
- No toast library dependency unless justified (evaluate `sonner` vs a small
  in-house component during build; default to in-house to avoid a dep — the
  app already ships a custom `HiddenPageToast`). Cost check: in-house = $0.
- Wire both into the EXISTING match-pick and `CustomBetCard` saves so the
  layer is proven before any behavior changes.

**Slice 1 — `useAutosave` hook + match picks.**
- A small reusable hook: debounced (~800ms), single-flight per entity key,
  aborts the in-flight request on a new edit, returns
  `{ status, lastError, retry }`. Built on the existing `usePendingAction`
  + `withTimeout` + `AbortController` patterns already in the codebase.
- Apply to `QuickPickRow`: on score change, auto-save through the same
  `/api/bets/save` Route Handler. Remove the Save button; keep the inline
  status (Saving… / Saved 2-0 ✓ / couldn't save — retry). Keep the
  `justSaved` ref anti-flicker guard. "Surprise me" routes through the same
  hook.

**Slice 2 — Free-pick custom bets.**
- Apply `useAutosave` to `CustomBetCard` ONLY for free-pick scopes
  (cost 0). On answer change, auto-save. Priced scopes keep the explicit
  "שמור ניחוש / עדכן ניחוש" stake button untouched. Cancel stays two-step.

**Slice 3 — Settings toggles.**
- Toggles already save on tap; route their results through the toast so
  success/failure is consistent and visible.

**Slice 4 — Admin draft snapshot autosave.**
- `BetForm`: debounced snapshot of the whole draft form (one write, not per
  field), only for draft-status bets. Surface a single "טיוטה נשמרה /
  Draft saved" status. Publish/grade/etc. remain explicit buttons.
- Guard: only write when the snapshot differs (dirty), and never block the
  admin's typing on a validation failure — store the draft, show validation
  state separately from save state.

### Must-handle edge cases (council-caught)

- **Lock/grade boundary:** an auto-save that lands after kickoff/lock/grade
  must be rejected server-side (verify the existing lock gates in
  `write-core.ts` and the Route Handler hold for the auto-save path) and the
  client must show "locked — not saved", not a silent success.
- **Concurrent editors:** last-write-wins is acceptable for a user's own
  picks (single owner). For admin drafts, add an `updated_at`/version check
  so a second tab does not silently clobber; show "changed elsewhere".
- **Thundering herd at kickoff:** keep match-pick writes on the parallel
  Route Handler (never one-at-a-time server actions), keep idempotent
  upserts, debounce + single-flight per entity. Consider a lightweight
  server-side guard if load testing shows pressure.
- **Stake-race invariant:** free-pick scopes never carry a stake; priced
  scopes never auto-save. Keep this invariant explicit in code + comment so
  the two write paths can never touch the same pick concurrently.
- **Offline/timeout:** loud, sticky, red "didn't save — tap to retry". Do
  NOT silently buffer + replay (replay + last-write-wins can resurrect a
  stale pick after grading). No offline queue in v1.

## Alternatives considered and rejected

- **Full client mutation queue + offline replay + Supabase Realtime "nervous
  system"** (Expansionist). Rejected for v1: four of five council reviewers
  flagged it as the biggest blind spot — after a DB-pool saturation incident,
  answering fragility with more concurrency and a paid realtime service
  reintroduces the exact failure mode. Revisit only if a concrete need
  (offline stadium use, live odds) is prioritized later.
- **Auto-save the admin form per-keystroke** (literal reading of "everywhere").
  Rejected: persists invalid intermediate states and trains admins to ignore
  the failure toast. Snapshot-on-blur is the safe form of "auto-save admin".
- **Auto-commit staked live bets after a debounce.** Rejected by the owner;
  council agreed money commit stays a deliberate tap.
- **Transient success toast on every field save.** Rejected: noise. Persistent
  inline status for fields; toasts only for discrete actions + failures.

## Security & safety (rule 13)

- **Never trust the client:** all lock/deadline/payment/ownership checks stay
  server-side in `write-core.ts` and the Route Handlers. Auto-save changes the
  trigger, not the authorization. Re-verify each gate still fires on the
  auto-save path.
- **Fail closed:** on any uncertainty (timeout, non-2xx, abort) the UI shows
  "not saved", never an optimistic "saved".
- **No new write path bypasses existing access gates** (`getUserAccess`,
  `is_paid_player`, admin role). Admin draft autosave still requires the same
  admin authz as the explicit save.
- **No PII/credentials in the new logs.** Keep the existing structured
  `console.info`/`warn` shape (userId + betId + amounts), nothing more.
- **Rate/abuse:** debounce + single-flight bounds one tab; idempotent upsert
  bounds duplicates. Note server-side concurrency cap as a follow-up if load
  testing warrants.

## QA checklist (rule 6 + project responsive rules)

- Golden path: change a pick → see Saving… → Saved, reload → value persisted.
- Edge: rapid edits (debounce coalesces to one write, no lost pick); edit
  during in-flight (abort + re-save); save after lock (rejected, clear msg).
- Error: kill network mid-save → loud sticky retry; retry succeeds.
- Money: free-pick auto-saves; priced bet still needs the explicit stake tap;
  cancel still two-step.
- Admin: draft snapshot saves on blur; invalid draft does not spam failures;
  publish/grade/etc still explicit.
- Responsive: verify at 360 / 414 / 768 / 1024 / 1440px. Toast respects safe
  area + bottom nav; inline status does not cause horizontal scroll or clip
  Hebrew. Touch targets ≥44px. Test landscape.

## Open questions

- Toast library: in-house component (default, $0, matches existing
  `HiddenPageToast`) vs `sonner`. Lean in-house.
- Admin draft conflict UX: silent last-write-wins vs `updated_at` guard with a
  "changed elsewhere" prompt. Lean guard for admin only.
- Do match picks need an "undo last change" affordance (Outsider's ask) or is
  the always-visible saved value + reversible-until-lock enough? Lean: the
  visible saved value is enough for v1; revisit if users report accidental
  changes.
