# Reopen a reversed live bet for filling

Date: 2026-06-19
Status: Implemented + prod hotfix applied

## Problem

An admin opened the grade form on the MEX vs KOR live bet
(`האם שתי הקבוצות יבקיעו במשחק?`), clicked an answer and graded it, then hit
"החזר דירוג" (reverse). That left the bet at `status='reversed'`. Every player
fill surface filters on `status='open'` (`src/lib/bets/fillable.ts`,
`src/app/[lang]/bets/live/[date]/page.tsx:117`), so the bet vanished from the
players' view even though the match had not started. There was no action to
move a bet `reversed -> open`, so the admin was stuck.

## Goal

A durable, one-click way for a `liveBets` admin to reopen a reversed bet for
filling, **as long as there is still time** (lock_at in the future).

## Approach (chosen)

- Pure rule `reopenBlockedReason(status, lockAt, now)` in
  `src/lib/bets/reopen.ts` — allows only `reversed` + `lock_at > now`. Shared by
  the server action and the UI gate; fully unit-tested (`reopen.test.ts`).
- Server action `reopenCustomBet(id)` in `src/app/[lang]/admin/bets/actions.ts`
  — permission-gated (`liveBets`), atomic txn: re-check via the pure rule,
  write a `reopen` audit row, flip `status -> open`. A reverse already reset
  every pick to ungraded, so the flip is clean (existing picks kept, new
  players can fill). Logs `[bet reopen]`. Revalidates the admin + play + live +
  leaderboard surfaces.
- Migration `0062_reopen_audit_action.sql` — extends the
  `bet_grading_audit_action_valid` CHECK to allow `'reopen'` (was
  grade/reverse/cancel only, from 0009). Idempotent DROP IF EXISTS + ADD.
- UI `ReopenBetCard.tsx` on the admin bet detail page, rendered only when
  `canReopen(...)` is true, above the grade form. One click + confirm, no reason
  input (the audit reason is a fixed system string).

## Alternatives rejected

- **Extend `publishCustomBet` (draft->open) to also accept reversed.** Mixes two
  distinct intents (first publish vs recovery) and muddies its audit-free path.
  A dedicated action with its own audit row is clearer.
- **Allow reopening `locked`/`graded` too.** `graded` already has reverse;
  `locked` only happens once time has passed (so reopening can't help without a
  separate lock-extension feature). Kept scope to the reported case.
- **Add a lock-extension knob to reopen.** Out of scope — "as long as there is
  time" means gate on time, not extend it. Can be a follow-up if needed.

## Security / observability / testing

- Security: `liveBets` permission gate, status + time re-checked server-side
  inside the txn (never trust the client/UI gate). Append-only audit row.
- Observability: `[bet reopen]` info log on success, `[bet reopen denied]` warn
  on permission fail, `[bet reopen] failed` error on throw.
- Tests: `src/lib/bets/reopen.test.ts` covers golden path, lock-passed,
  boundary (lock == now), every non-reversed status, and status-before-time
  ordering. Full suite green (683 tests).

## Prod hotfix (applied before deploy)

- `scripts/one-off/list-reversed-live-bets-2026-06-19.mjs` — found the one stuck
  bet (`5be5cf9f-...`, 13 picks, time left).
- `scripts/one-off/reopen-mex-kor-bet-2026-06-19.mjs` — ran the same CHECK
  extension (idempotent, == migration 0062) + reopened the bet in a txn with a
  `reopen` audit row attributed to the admin who reversed it.
- `scripts/one-off/verify-reopen-mex-kor-2026-06-19.mjs` — confirmed
  `status=open`, time left, audit chain `open->graded->reversed->open`.

Because the hotfix ran 0062's exact idempotent SQL on prod, the migrator
re-running 0062 on deploy is a no-op.
