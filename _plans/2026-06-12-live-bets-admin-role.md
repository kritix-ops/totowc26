# Live-bets admin role

**Date:** 2026-06-12
**Status:** Approved by user 2026-06-12

## Goal

Allow the main admin to designate certain users as "מנהל הימורי לייב" — a
restricted admin who can only manage live bets (and the small set of pages that
support that workflow). Everything else under `/admin/*` stays admin-only.

## Alignment captured with user

Three explicit choices made by the user in chat:

1. **Scope** — the live-bets admin sees four admin pages:
   - `/admin/bets` (and every sub-path: `new`, `quick-add`, `duplicates`, `[id]`)
   - `/admin/bets-overview`
   - `/admin/live-bets/suggestions` (matchday AI suggestions)
   - `/admin/deadlines` (per-match lock times)
2. **Permissions** — full lifecycle on live bets: create, edit, publish, grade,
   cancel, reverse. The user accepted that grading affects everyone's points;
   they want trusted operators to handle the whole cycle.
3. **Assignment** — a three-way role selector inside the existing user drawer
   (`/admin/users` → drawer): `שחקן` / `מנהל לייב` / `אדמין`. Replaces the
   binary "Make admin / Revoke admin" button.

## Data model

Add `live_bets_admin` to the existing `role` pgEnum. New shape:

```
CREATE TYPE role AS ENUM ('player', 'live_bets_admin', 'admin');
```

Three values, ordered from least to most privileged. The Postgres `is_admin()`
function (used by RLS) is unchanged: it still matches only `role = 'admin'`.
That is correct — the app uses the service-role pooler URL (`DATABASE_URL`),
so RLS is not the security boundary for app code; the application gate is.
RLS keeps `admin`-only semantics for any non-app direct-DB use.

Migration `0053_live_bets_admin_role.sql` adds the enum value. Enum additions
are idempotent in Postgres via `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.

## Authorization model

Two new helpers in `src/lib/admin.ts`:

- `isLiveBetsAdmin(userId)` — true for `admin` OR `live_bets_admin`.
- `requireLiveBetsAdmin(locale)` — redirect-on-deny equivalent.

`isAdmin()` and `requireAdmin()` keep their existing semantics (strict admin).

### Layout gate change

`/admin/layout.tsx` today calls `requireAdmin()`, which blocks live-bets
admins from EVERY admin page. We can't keep that — they need access to the
four whitelisted paths. We also can't simply loosen it, because most pages
rely solely on the layout gate and would suddenly be visible.

Approach: the layout calls a new `requireAnyAdmin()` that allows either role,
then enforces a path whitelist for live-bets admins by reading the
`x-pathname` header (already set by `src/proxy.ts`). If the role is
`live_bets_admin` and the path is not in `LIVE_BETS_ADMIN_PATHS`, we redirect
to `/admin/bets` (their natural home).

Defense in depth: every server action (and any page that already calls
`requireAdmin()` directly) keeps that strict check. Only the four allowed
action files / pages swap in `requireLiveBetsAdmin()`. New admin pages added
later are automatically blocked from live-bets admins until they get
whitelisted in the layout — fail-closed.

## Pages affected

**Allowed pages (relax to `requireLiveBetsAdmin`):**
- `src/app/[lang]/admin/bets/page.tsx` (layout gate is enough)
- `src/app/[lang]/admin/bets/actions.ts` (every server action)
- `src/app/[lang]/admin/bets-overview/page.tsx` (re-checks → `requireLiveBetsAdmin`)
- `src/app/[lang]/admin/bets-overview/actions.ts`
- `src/app/[lang]/admin/live-bets/suggestions/actions.ts`
- `src/app/[lang]/admin/deadlines/actions.ts`

**Admin landing page (`/admin/page.tsx`):**
Conditionally render. For `live_bets_admin`, show only the four tiles that
correspond to allowed pages and a single section header; hide the pot total
card, sandbox tile, signup-requests badge, etc.

**User drawer (`UsersExplorer.tsx`):**
Three-way role selector: tri-state segmented control / chips. Renames the
existing label, updates the role badge to support three values, and threads
the new role through `setUserRole`.

## Security

- New role does NOT pass the Postgres `is_admin()` function, so direct-DB
  access still treats them as players.
- New role does NOT change `getUserAccess.isAdmin` in `src/lib/access.ts` —
  live-bets admins are NOT general admins for purposes of the public app
  (bet placement, duels, etc.). They get player-level privileges everywhere
  outside their four whitelisted admin pages.
- `setUserRole` keeps the existing `last_admin` and `cannot_demote_self`
  guards. Demoting yourself from `admin` → `live_bets_admin` is also blocked
  by the existing self-protection (same as demoting to player).
- Action files for non-whitelisted paths stay on `isAdmin()`. A live-bets
  admin who tries to POST directly to e.g. `/admin/users` server actions
  gets `forbidden`.

## Observability

Per CLAUDE.md rule 14, namespaced logs added:

- `[admin gate]` — layout decisions (which role, allowed/denied path).
- `[role change]` — every `setUserRole` invocation with before/after.
- `[live-bets gate]` — `requireLiveBetsAdmin` denials.

## Settings

Per CLAUDE.md rule 15, no new settings — the role is a per-user attribute,
not a tunable.

## Testing

Per CLAUDE.md rule 18:

- Unit test (or extend `src/lib/bank.test.ts` style) that mocks profile rows
  and asserts:
  - `requireLiveBetsAdmin` permits `admin` and `live_bets_admin`, redirects
    `player`.
  - `isLiveBetsAdmin` returns true for both privileged roles, false for
    player.
  - `setUserRole` rejects self-demotion (any target role) and last-admin
    demotion to either non-admin role.

## Out of scope

- No audit log for live-bets admin actions beyond what `bet_admin_audit`
  already records for grading. Promotion/demotion does not yet have its own
  audit table — same as today's binary admin toggle.
- No quota / time-window limits on a live-bets admin (e.g. "this user can
  only grade matches today"). Future enhancement.
- No "view as" / impersonation support for the new role. Admin keeps
  exclusive use of that path.
