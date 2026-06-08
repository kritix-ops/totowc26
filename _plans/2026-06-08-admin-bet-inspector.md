# Admin bet inspector + edit-on-behalf

## Goals

Give the admin two capabilities that today don't exist:

1. **See everyone's bets in one place** — a matrix of users × open bets where each cell shows that user's actual answer (not just "yes/no I bet"). Admin-only — regular users never see other people's picks.
2. **Edit a pick on behalf of a user** — when someone calls and asks the admin to fill in for them (memory: friends pool, not a business), the admin should be able to set / change / clear that user's pick from inside admin UI. Every such write is audited and explicit; the admin never "becomes" the user via cookies.

## Constraints

- **User bets are sacred** ([[feedback_user_bets_are_sacred]]). Every admin write on `user_custom_bet_picks` or `match_bets` lands through `write-core` (the single gated path) with a new principal kind, and emits an append-only audit row in the same transaction.
- **Mobile-first** (project CLAUDE.md). Matrix view must collapse to a per-user accordion on `<md`.
- **Jerusalem timezone** for every displayed lock/kickoff ([[feedback_jerusalem_timezone]]).
- **No new sending domains, no new external services** — pure internal feature.
- **WC starts 2026-06-11**. Phase 1 (read) should land before then so admin can chase missing picks in the last 3 days. Phase 2 (edit) can land just after.

## Requirements

Decided in alignment (2026-06-08):

| # | Question | Decision |
|---|---|---|
| 1 | What does admin see per cell? | Full answer (the actual pick), not just status. Admin-only — never exposed to non-admin sessions. |
| 2 | Reason field on admin writes? | Mandatory. Server action rejects empty / whitespace-only reasons. |
| 3 | Bank-insufficient on admin paid-bet edit? | Refuse the write with a clear error. Admin sees `bankBalance` + delta inline and decides. |
| 4 | Lock bypass? | Allowed via a separate explicit checkbox on the edit modal. Audit row carries `lock_bypassed=true` so we can later report "X bypasses last week". |

## Approach (Option B from alignment)

Two new admin pages + one DB table + one new write-core principal kind.

### DB — `bet_admin_audit` (migration `0043_bet_admin_audit.sql`)

```sql
create table bet_admin_audit (
  id              uuid primary key default gen_random_uuid(),
  admin_id        uuid not null references profiles(id) on delete restrict,
  target_user_id  uuid not null references profiles(id) on delete cascade,
  action          text not null check (action in ('set','clear')),
  surface         text not null check (surface in ('match','custom')),
  match_id        uuid references matches(id) on delete set null,
  custom_bet_id   uuid references custom_bets(id) on delete set null,
  before          jsonb,                 -- prior pick, null if there was none
  after           jsonb,                 -- new pick, null on clear
  reason          text not null check (length(trim(reason)) > 0),
  lock_bypassed   boolean not null default false,
  created_at      timestamptz not null default now()
);
-- Append-only: nobody updates or deletes audit rows.
revoke update, delete on bet_admin_audit from public, authenticated, anon, service_role;
create index bet_admin_audit_target_idx on bet_admin_audit (target_user_id, created_at desc);
create index bet_admin_audit_admin_idx on bet_admin_audit (admin_id, created_at desc);
```

### Backend — `write-core` extension

Add a third principal:

```ts
| { kind: "admin_proxy"; adminId: string; userId: string; reason: string; lockBypassed: boolean }
```

Rules:

- `gateAccess` returns true for `admin_proxy`.
- `admin_proxy` writes:
  - **Always** require non-empty `reason`. Server-side trim+check before the tx opens.
  - **Always** check bank — same `lockUserForBetting` path. No special-case refund logic; the user's bank can't go negative.
  - **Always** check status (graded/cancelled refused).
  - **Bypass deadline only if `lockBypassed === true`** — same mechanic as the existing `allowAfterDeadline` on `WriteOpts`, but the flag lives on the principal so the audit row records it.
  - Audit row inserted inside the same tx as the pick mutation. If the audit insert fails, the whole tx aborts.
- `WriteOpts.overwrite` is allowed `true` on admin path. Source-level `bet-immutability.test.ts` is extended to allow `overwrite: true` ONLY when the writer is an admin server action whose name matches `admin*`.

New server actions in `/admin/users/[id]/bets/actions.ts`:

- `adminSetMatchPick(targetUserId, matchId, home, away, reason, lockBypassed)`
- `adminClearMatchPick(targetUserId, matchId, reason)`
- `adminSetCustomBetPick(targetUserId, betId, answer, reason, lockBypassed)`
- `adminClearCustomBetPick(targetUserId, betId, reason)`

Every action starts with `requireAdmin(locale)` from `src/lib/admin.ts`.

### Queries

- `fetchAllUsersBetSnapshot()` — returns `{ users: AdminUser[], bets: BetMeta[], picks: Map<userId, Map<betId, Pick>> }` for the overview matrix. Cached per-request via React `cache()`. One query each for users (already in `admin/users/queries.ts`), bets (open + draft, scope ≠ `draft-test`), match-picks, custom-picks. Flatten in app code, not in SQL — the matrix is small (~30 × ~50).
- `fetchUserBetsForAdmin(userId)` — returns all of that user's picks grouped by surface for the per-user editor. Reuse existing `getMatchPicks(userId)` + `getCustomBetPicks(userId)` from `src/db/queries.ts`.

### Pages

#### `/admin/bets-overview/page.tsx`

- Desktop (≥md): sticky-first-column table. Rows = users (sorted by points desc), columns = bets (grouped by surface: 1/X/2 → Live → Tournament → Group). Each cell is `<answer> · <points|—>` with a tone (filled / empty / locked).
- Mobile (<md): tabs per surface, each tab shows a vertical list of users with their answers in chips. One user expanded at a time.
- Top filters: surface (all / matches / live / tournament / group), status (open / locked / graded), search (user name).
- Empty cells show a faint "—" + (if pre-deadline) a "ערוך עבור" mini button that links straight to `/admin/users/[id]/bets#bet-[id]`.

#### `/admin/users/[id]/bets/page.tsx`

- Same shell pattern as `/admin/users/[id]/bank/page.tsx`: back link → header with the user's name+phone+points → sections.
- Sections (only those with content): "ניחושי 1/X/2", "הימורי לייב", "הימורי טורניר", "הימורי קבוצה".
- Each row reuses the user-facing `CustomBetCard` / `MatchPickRow` in a **read mode** + an "ערוך" pencil button.
- Clicking edit opens `AdminPickEditor` modal:
  - Shows current pick (or "אין ניחוש")
  - Answer input (reuse the user-facing answer component per `answerType`)
  - Mandatory single-line reason input with placeholder examples ("השלמתי טלפונית לעודד")
  - Lock-bypass checkbox — only rendered when `lockAt < now()` AND `status === 'open'`. Red text: "אני עוקף את מועד הסגירה. ירשם נפרד באודיט."
  - Bank balance + delta (e.g. "יתרה: 320 · עלות פיק: 30 · אחרי השמירה: 290")
  - "שמור עבור X" primary button. Disabled until reason is non-empty.

### Entry points

- `AdminTile` in `/admin/page.tsx` "Bets" section: "מצב משתתפים" → `/admin/bets-overview`.
- In `UsersExplorer.tsx`, every user row: additional link "הימורים" next to the existing bank link → `/admin/users/[id]/bets`.

## Alternatives rejected

- **A. Impersonation via cookie** — easier to ship, reuses 100% of existing user UI, but admin can forget they're impersonating and edit by accident. The `view-as` cookie is for READ preview only; using it for write would conflate two different mental models. Hard line: write-on-behalf needs explicit per-click intent.
- **C. Hybrid** — read = dedicated, edit = impersonation. Adds the same impersonation downside for marginal saved code, since the answer-input components are already reusable.

## Security (rule 13)

- Every page guarded by `requireAdmin(locale)` server-side. UI hiding is in addition to, not instead of, server enforcement.
- Every action guarded by `requireAdmin(locale)` even though the page also gates — defence in depth.
- `targetUserId` is always a function parameter; no cookie-derived "current user". Eliminates a class of confused-deputy bugs.
- Reason field validated server-side with `length(trim()) > 0` — also enforced as a DB CHECK on the audit row so even raw SQL inserts can't bypass.
- Audit table revokes UPDATE/DELETE — corrections happen as new rows, not edits.
- No raw user input echoed to logs without the namespaced log function (see Observability).
- No info leak to non-admin: middleware already routes non-admins away from `/admin/*`, and the server actions reject too.

## Observability (rule 14)

Every admin write logs:

```ts
console.info('[admin bet write]', {
  step: 'set_custom' | 'set_match' | 'clear_custom' | 'clear_match',
  adminId, targetUserId, betId, before, after, lockBypassed, reason: reason.slice(0, 80), result,
});
```

Reads also log when an admin view loads:

```ts
console.info('[admin bet read]', { page: 'overview' | 'user_editor', adminId, userCount, betCount });
```

Frontend logs the modal lifecycle:

```ts
console.info('[admin bet ui]', { step: 'open' | 'submit' | 'cancel' | 'bypass_toggled', userId, betId, lockBypassed });
```

## Settings (rule 15)

No new global settings. Admin behavior is a constant. The "should regular players see other players' picks" question was decided as **no**, hardcoded — if we ever change our minds it becomes a setting then.

## Testing (rule 18)

Unit tests:

- `src/lib/bets/write-core.admin.test.ts` — admin_proxy principal:
  - Empty reason rejected
  - Bank insufficient rejected (no partial write)
  - `lockBypassed: false` AND deadline passed → rejected
  - `lockBypassed: true` AND deadline passed → succeeds AND audit row has `lock_bypassed=true`
  - Audit row inserted in same tx (rollback the data write and assert audit row absent)
  - Overwrite of existing pick: refunds old stake, charges new, single audit row with non-null `before`
- `src/lib/bets/bet-immutability.test.ts` — extend (4) and (5):
  - `overwrite: true` is allowed only for files matching `**/admin/**/actions.ts`
  - Every admin action file imports `requireAdmin` and calls it before any `write-core` call (regex on the source)
- `src/lib/admin/audit.test.ts` (new) — DB-level: insert refused when `length(trim(reason))===0`, UPDATE/DELETE refused.

Manual QA checklist appended to `_plans/2026-06-06-manual-qa-checklist.md`:

- [ ] Non-admin user hits `/admin/bets-overview` → redirected
- [ ] Non-admin user POSTs to admin action → rejected
- [ ] Admin sets pick for user A on bet B — A sees the new pick on next refresh, bank moved correctly
- [ ] Admin tries to set pick after deadline without bypass → blocked with clear error
- [ ] Admin sets pick after deadline WITH bypass → succeeds, audit row shows `lock_bypassed=true`
- [ ] Admin clears a paid pick — stake refunded to A's bank
- [ ] Mobile 360px: overview readable, edit modal full-width, save button reachable above keyboard
- [ ] iOS Safari: opening edit modal doesn't trigger zoom; reason input is 16px

## Phasing

This is large. Shipping in two phases, both committable independently:

- **Phase 1 (read-only, no DB changes, ~1 session)**: Pages exist, matrix renders, per-user editor renders, no edit buttons. Admin gets the visibility need solved before the WC kicks off. **THIS SESSION.**
- **Phase 2 (writes + audit, ~1-2 sessions)**: Migration, write-core extension, edit modal, actions, audit, unit tests. Lands within the week.

## Open items (resolve before phase 2)

- "ערוך עבור" feedback to the target user — do we email them ("האדמין מילא בשבילך…") or stay silent? Default: silent unless asked, but the audit row is the durable record.
- Whether `admin_proxy` should be allowed on `cancelled`/`graded` bets at all (probably not). Phase 2 commit will lock this down explicitly.
