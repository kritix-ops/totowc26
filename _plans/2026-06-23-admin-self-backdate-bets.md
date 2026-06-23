# Admin self-backdate bets

Date: 2026-06-23
Owner: info@flexelent.com (full admin)
Status: approved, in build

## Goal

Let a full admin edit / add **their own** bets retroactively, including after a
match has started or finished, so a bet that failed to save (the recurring prod
"loading forever" DB hang — see memory `prod-falls-root-cause`) can be corrected.
Every such edit is recorded in a **private** audit trail that only the admin can
see and show. To every other user the app looks completely normal.

This is explicitly the thing the system was designed to forbid:
- `writeMatchPickAdmin` (write-core.ts:712) refuses to write a score for a match
  that has already kicked off, even with `lockBypassed`.
- The proxy actions (`admin/users/[id]/bets/actions.ts`) block `self_target` so an
  admin can never proxy-edit their own pick.

We do **not** weaken either guard. The general proxy path (editing *other*
players) keeps both guards intact. We add a **separate, narrow, self-only,
full-admin-only** backdate path that is the deliberate exception, fully audited.

## Constraints / decisions

- Surfaces: both 1/X/2 match-score picks and custom/live bets (day, stage,
  group, tournament, match-live). User chose both.
- Self-only: the acting admin can only ever target their own `userId`
  (`adminId === userId`). Blast radius cannot touch another player's bet.
- Full-admin-only: gated by `requireAdmin` (role === 'admin'), NOT the scoped
  `liveBets` operator permission. The new path is intentionally absent from
  `PERMISSION_PATHS`, so a scoped operator's path whitelist excludes it.
- Audited: reuse the immutable `bet_admin_audit` table; add a `backdated`
  boolean so a post-kickoff self-backdate is distinguishable from a normal
  pre-deadline admin override. The audit read is gated by `is_admin()` RLS +
  the action filters to `admin_id = self`.
- Make it actually count:
  - Match score: insert leaves `points_earned` NULL; the idempotent
    `scoreFinalMatches()` grades any ungraded row. For an already-final match we
    call `scoreFinalMatches()` right after the write so points land immediately.
  - Custom bet: if the bet is still open/locked/reversed the pick is in place
    before grading, so the normal auto/manual grade credits it. If the bet is
    already `graded`, we surgically grade just this one pick from the stored
    `resolved_value` (no reverse+regrade of everyone — no churn for others).

## Changes

1. **Migration 0066** + `schema.ts`: add `backdated boolean NOT NULL DEFAULT
   false` to `bet_admin_audit` (idempotent `ADD COLUMN IF NOT EXISTS`).
2. **`src/lib/bets/grade-pick.ts`** (new): extract `isPickCorrect` (and
   `validateResolvedValue`) from `admin/bets/actions.ts` into a shared module;
   re-import there. No behavior change.
3. **`write-core.ts`**:
   - `WriteOpts.backdate?: boolean` (internal; only the self-backdate writer
     sets it). When set, `writeCustomPickTx` accepts status
     open/locked/reversed/graded and skips the lock + existing-locked gates.
   - `backdateOwnMatchPick(principal, input)`: self-only, reason-required,
     allows any match status, upserts `match_bets` with `points_earned` left to
     re-grade, writes `bet_admin_audit` (`backdated: true`).
   - `backdateOwnCustomPick(principal, input)`: self-only, reason-required,
     `writeCustomPickTx({overwrite:true, backdate:true})`; if the bet is
     `graded`, grade the single pick from `resolved_value`; writes audit.
   - `backdated: true` on the relevant audit inserts.
4. **`src/lib/sync.ts`**: export `scoreFinalMatches` so the self-backdate match
   action can grade a finished match immediately.
5. **`admin/my-bets/`** (new full-admin page):
   - `actions.ts`: `selfBackdateMatchPick`, `selfBackdateCustomBetPick`,
     `selfClearMatchPick`, `selfClearCustomBetPick`, `fetchMyBackdateAudit`.
     Gate = `requireAdmin` + assert `targetUserId === session.user.id`.
     Build `admin_proxy` principal with `adminId === userId === user.id`.
   - `page.tsx`: lists own bets via the existing `fetchUserBetsForAdmin(self)` /
     `fetchUserMatchPicksForAdmin(self)`; renders the editor for every bet incl.
     started/final; shows the private audit log.
   - `MyBetsEditor.tsx` (client): injects the self actions into the shared
     `AdminPickEditor` via a new optional `actions` prop.
   - `MyBackdateAuditLog.tsx`: private trail (date, surface, before→after,
     reason, backdated badge).
6. **`AdminPickEditor.tsx`**: add optional `actions` prop (DI); default to the
   existing proxy actions so the per-user page is unchanged.
7. **Admin landing**: add a full-admin tile → `admin/my-bets`.

## Security

- Self-only + full-admin-only, enforced in the action gate AND in write-core
  (`adminId === userId` check). Server-side, not just UI.
- Reason mandatory (DB CHECK + assertAdminReason).
- Audit immutable (REVOKE UPDATE/DELETE already in 0043); new column inherits it.
- No new public surface; nothing rendered to non-admins. The audit read is
  admin-RLS gated and the action filters to the caller's own id.
- We do NOT bypass the bank guard for live picks — an unaffordable backdate is
  rejected the same as a normal save.

## Observability

- `[admin self-backdate]` namespaced logs at each step (action entry, write
  outcome, regrade trigger), mirroring `[admin bet write]`.
- Audit rows carry who/when/before/after/reason/backdated.

## Testing

- Extend `bet-immutability.test.ts`: source-level guards on the new path —
  self-only (`adminId === userId` / `self`-target assertion), reason required,
  audit inserted, `backdated` stamped, full-admin gate present, and the new
  page absent from the scoped `PERMISSION_PATHS`.
- `grade-pick.test.ts`: cover the extracted `isPickCorrect` for all answer types.
- Run the full vitest suite + `tsc`.

## Out of scope

- No reverse+regrade-everyone for graded custom bets (we grade the single late
  pick instead).
- No change to the general proxy (other-user) edit path.
