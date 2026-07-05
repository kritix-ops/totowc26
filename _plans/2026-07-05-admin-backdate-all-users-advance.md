# Admin retroactive fix — all users + "who advances?" surface

Date: 2026-07-05
Owner: aporia2026
Status: approved, in progress

## Goal

Two changes to the admin "תיקון בדיעבד" (retroactive fix) screen, requested by
the product owner:

1. Let a full admin apply retroactive fixes to **any user's** bets, not only
   their own.
2. Add the **"who advances?" (מי עולה)** knockout bet type to the retroactive
   editor, alongside the existing score (1/X/2) and custom-bet surfaces.

## Background (current state)

Two separate admin editing paths exist today:

- **Self-backdate** (`/admin/my-bets`): a full admin fixes their OWN bets, even
  after kickoff, with automatic re-grading. Every edit lands in a private audit
  log. Hard-gated to self at the action layer AND inside `write-core`
  (`isSelfBackdate`: `adminId === userId`). Guarded by source-level tests in
  `src/lib/bets/bet-immutability.test.ts`.
- **Proxy edit** (`/admin/users/[id]/bets`): edits ANOTHER user's pick but
  REFUSES started/finished matches and never re-grades — not a retroactive fix.

Neither path supports "who advances?" — that bet lives in `match_advance_bets`,
is saved via `POST /api/bets/advance`, and is graded in `sync.ts`
(`scoreAdvanceBets`) against `matches.advancing_team` for `settings.scoring_advance`
points. No admin/audit/backdate plumbing exists for it.

## Chosen approach

One unified retroactive-fix screen with a user picker (default: the acting
admin). Rejected alternative: keep `my-bets` self-only and bolt advance +
retroactive editing onto the per-user proxy page — fragments UX and duplicates
the backdate plumbing anyway.

### Security note (deliberate expansion)

The self-only restriction was a deliberate design choice. Expanding retroactive,
post-lock, re-grading edits to every user is a real increase in admin power. It
is acceptable because: (a) admins can already edit other users' bets via the
proxy path, and (b) every fix remains in the immutable `bet_admin_audit` trail
(`admin_id`, `target_user_id`, `reason`, `backdated=true`). The self-vs-other
distinction is preserved in the data (`admin_id == target_user_id`). The screen
stays full-admin only (never a scoped operator) — `my-bets` remains absent from
`PERMISSION_PATHS`.

## Steps

1. **Migration `0072_bet_admin_audit_advance_surface.sql`** — extend the
   `bet_admin_audit` surface CHECK to allow `'advance'`; update the surface/id
   XOR constraint so `'advance'` uses `match_id` (like `'match'`). Register in
   `_journal.json` (idx 72). Immutability (REVOKE UPDATE/DELETE) is inherited.

2. **write-core** — generalize the four self-backdate writers to target any
   user: rename `backdateOwn*`/`clearOwn*` → `backdateMatchPick`,
   `clearMatchPick`, `backdateCustomPick`, `clearCustomPick`; drop the
   `isSelfBackdate` refusal (keep it as a computed `isSelf` flag for logging).
   Keep `backdated=true`, lock-bypass, and re-grade. Add `backdateAdvancePick` /
   `clearAdvancePick` (surface `'advance'`, validate team is one of the two
   fixture teams, reset grading so `scoreAdvanceBets` re-grades). Rename the log
   namespace to `[admin backdate]`.

3. **Queries** — add `fetchUserAdvancePicksForAdmin(userId)` (knockout matches +
   the user's advance pick + graded state) and `fetchSelectableUsers()` (id +
   name for the picker).

4. **AdminPickEditor** — add a `surface: "advance"` mode (home/away team choice),
   plus optional `setAdvance`/`clearAdvance` in `AdminPickActions`.

5. **Backdate screen** — user picker (`?user=<id>` search param, default self);
   loads the selected user's score/custom/advance bets into the filter browser;
   new "מי עולה" section + bet-type filter option. Audit log shows all of this
   admin's backdated fixes, labeled with the target user's name and the advance
   surface.

6. **Actions** — `my-bets/actions.ts` honors `args.targetUserId` (full-admin
   gated, reasoned, audited); advance actions call the new write-core fns and
   `scoreAdvanceBets()` after a fill.

## Security

- Full-admin only; `my-bets` never enters `PERMISSION_PATHS` (asserted in test).
- Every write requires a non-empty reason and lands an immutable audit row.
- `targetUserId` is honored but the acting `adminId` always comes from
  `getUser()` (never the request body).
- Advance team input validated server-side against the actual fixture teams.

## Observability

- `[admin backdate]` namespaced logs at each write step (set/clear × match/
  custom/advance) with adminId, targetUserId, isSelf, before/after, reason.
- `[admin pick editor]` client logs already cover save/clear; extend for advance.

## Testing

- Rewrite the `bet-immutability.test.ts` self-backdate block to the NEW contract:
  generalized writers are full-admin gated, reasoned, audited, stamp
  `backdated=true` — no longer self-only. Keep every other sacred-invariant
  guard intact (automated writers never overwrite, owner-cancel self-only,
  proxy path unchanged, sandbox exclusions, `my-bets` not in whitelist).
- Add source-level guards for the new advance writers + advance actions.
- Run the full Vitest suite green.

## Settings

No new user-facing settings — this is an admin-only tool. `scoring_advance`
already exists.

## Deploy

Local branch `sandbox`. No push/merge/deploy without a separate explicit
go-ahead. Migration must run against the DB (`npm run db:migrate`) before the
advance audit writes will pass the CHECK — flag this at handoff.
