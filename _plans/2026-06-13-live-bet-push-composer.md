# Live-bet push composer

Date: 2026-06-13
Owner: Yoav
Status: approved (scope locked via in-session questions)

## Goal

Let a bet-manager announce freshly-published live bets to the players via
push, from the live view of `/admin/bets`. Select one or many open live
bets and fire a single push whose body is "match name + how many live
bets went up", grouped per anchor.

## Scope decisions (locked by the user)

1. **Audience** — send to every push-opted-in player (`push_opt_in`). No
   new per-user trigger flag.
2. **Day-scoped bets included** — live family is match + day; day bets
   show the date (D.M) instead of a match name.
3. **No auto-on-publish** — the originally-floated "send automatically
   after every publish" mode is dropped (spam risk). Manual / batch
   selection is the only trigger.
4. Available to anyone with the `liveBets` permission (admins included),
   same gate as publish / cancel.

What these decisions remove: no DB migration (no settings flag, no
per-user flag), no change to the publish flow, no settings surface.

## Approach

- Add a `live_bet` value to `NOTIFICATION_KINDS` (the column is `text`,
  not a PG enum — no migration).
- `listOpenLiveBetsForPush()` returns open, match/day custom bets with
  team names (match-scoped) and matchday date (day-scoped) for friendly
  anchor labels.
- Pure module `src/lib/bets/live-bet-push.ts`:
  - `liveBetAnchor(row, locale)` → `{ key, label }` (match → "{home} נגד
    {away}", day → "יום D.M"). One code path for server + client preview.
  - `formatDayLabel` (string math, no Date — avoids an Asia/Jerusalem day
    shift on a pure calendar date).
  - `buildLiveBetPushText(anchors, locale)` → `{ title, body }`: title is
    the total count, body lists each anchor with its per-anchor count
    (single anchor → body is just the name).
  - All three unit-tested.
- Server action `sendLiveBetPush(betIds, locale)` in `admin/bets/actions.ts`:
  gated to `liveBets`; caps the selection at 50; re-reads the canonical
  open-live list and keeps only the selected ids (the authorization
  boundary for WHAT can be pushed); builds the text; fans out via
  `notifyUsers({ kind: "all-opted-in" }, { kind: "live_bet", push: true })`;
  links to `/{locale}/bets/live`.
- Client `LiveBetPushComposer`: a collapsible card at the top of the live
  view. Open live bets grouped by anchor with per-group select-all and a
  live preview of the exact push. Send shows "sent to N players".

## Security (rule 13)

- Action gated by `hasPermission(liveBets)`.
- The selection is validated against the DB's open-live list, so a draft
  / locked / tournament / duel id can never ride into a push.
- Body length bounded (≤50 bets); recipients bounded by `notifyUsers`.
- No PII in the push; `created_by` records the operator on each feed row.

## Observability (rule 14)

- `[live bet push]` log with operator, bet count, recipients, pushSent.
- `[live bet push denied]` on a permission miss.
- `notifyUsers` already logs `[notify insert]` / `[notify sweep]`.

## Testing (rule 18)

- `src/lib/bets/live-bet-push.test.ts`: builder (empty, single, multi-per-
  match, multi-anchor, order, en), `formatDayLabel`, `liveBetAnchor`.
- The action and the React composer are DB/IO + UI — verified by the QA
  pass; intentionally not unit-tested (no seam).

## Settings audit (rule 15)

Nothing to expose: no auto mode, no settings flag, no per-user flag (the
audience is "all push-opted-in" per the user's choice).

## Files

- `src/db/schema.ts` — `live_bet` kind.
- `src/db/admin-queries.ts` — `listOpenLiveBetsForPush`.
- `src/lib/bets/live-bet-push.ts` (+ `.test.ts`).
- `src/app/[lang]/admin/bets/actions.ts` — `sendLiveBetPush`.
- `src/app/[lang]/admin/bets/LiveBetPushComposer.tsx`.
- `src/app/[lang]/admin/bets/page.tsx` — fetch + render on the live view.

## Note

A pre-existing in-flight edit in `BetForm.tsx` (uses `<PricingModeToggle>`
without defining/importing it) breaks the project typecheck. It is
unrelated to this feature and was left untouched.
