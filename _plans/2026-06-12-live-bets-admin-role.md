# Admin permissions catalog

**Date:** 2026-06-12
**Status:** Revision 2 — approved by user 2026-06-12 (same day)

## Revision history

- **R1 (morning):** Added a single `live_bets_admin` enum role.
  Migration 0053 + first PR.
- **R2 (afternoon):** Pivoted to a per-user permission catalog after
  the user asked for additional scoped roles (tournament bets,
  tournament odds, etc). A single enum value doesn't scale to that
  request without combinatorial explosion. This doc describes R2; R1
  artifacts are migrated forward (the old `live_bets_admin` enum value
  stays in Postgres but is no longer assigned by the app).

## Goal

Let the main admin grant fine-grained scoped powers to specific users
without making them full admins. Today's needs:

- Author / grade live bets and run their tooling.
- Author / grade tournament bets (stage / group / tournament scope).
- Edit tournament outright odds (king scorer, finalists, podium, etc).

Future permissions just add a key — no migration shape change.

## Alignment captured with user

Three explicit choices made by the user:

1. **Architecture** — switch from "one named role" to a JSONB permission
   catalog on `profiles`. role stays binary (`player` / `admin`); the
   scoped powers live next to it.
2. **Initial catalog** — `liveBets`, `tournamentBets`, `tournamentOdds`.
3. **Assignment UI** — checkbox list inside the existing user drawer
   at `/admin/users` (not a dedicated permissions page).

## Data model

`profiles.permissions JSONB NOT NULL DEFAULT '{}'::jsonb` with a CHECK
constraint that the value is a JSON object. Canonical keys:

```
liveBets          — /admin/bets, /admin/bets-overview,
                    /admin/live-bets/*, /admin/deadlines
tournamentBets    — /admin/tournament-suggestions
tournamentOdds    — /admin/tournament-odds
```

The Postgres `is_admin()` function (used by RLS) is unchanged: still
matches only `role = 'admin'`. App code uses the service-role pooler
URL and bypasses RLS — the application gate is authoritative.

Migration `0054_admin_permissions.sql`:

1. Adds the column (default `{}`).
2. Adds the JSONB-object CHECK constraint.
3. Backfills any row with `role = 'live_bets_admin'` (from R1) to
   `role = 'player'`, `permissions = {"liveBets": true}`. The enum
   value still exists; the app stops assigning it. Removing it would
   be a multi-step type-rename dance and is not worth it.

## Authorization model

- `requireAdmin(locale)` — strict full admin only (unchanged).
- `requireAdminAccess(locale)` — full admin OR any scoped permission.
  Bounces unauthenticated / regular players. Used by the admin layout
  and admin landing page.
- `hasPermission(userId, key)` — gate for individual server actions.
  Returns true for full admin (superset) or when the named permission
  is set.
- `getProfileAccess(userId)` — single read that returns
  `{ role, permissions }` with permissions normalised through the
  allowlist.

Layout gate (`src/app/[lang]/admin/layout.tsx`):

1. `requireAdminAccess` — bounces non-operators.
2. For scoped operators (role !== 'admin'), reads `x-pathname` from
   proxy and runs `isPermittedPath(permissions, pathAfterAdmin)`. Fails
   closed for any path not declared in `PERMISSION_PATHS`.

This means a new admin route added later is automatically blocked from
scoped operators until someone adds it to `PERMISSION_PATHS`.

## Action gating

| Path | Permission |
| --- | --- |
| `/admin/bets/actions.ts` | `liveBets` |
| `/admin/bets-overview/actions.ts` | `liveBets` |
| `/admin/deadlines/actions.ts` | `liveBets` |
| `/admin/live-bets/suggestions/actions.ts` | `liveBets` |
| `/admin/tournament-suggestions/actions.ts` | `tournamentBets` |
| `/admin/tournament-odds/actions.ts` | `tournamentOdds` |

`publishSurfaceToBet` in `tournament-odds/actions.ts` is called from
the tournament-suggestions flow. The gate there accepts either
`tournamentBets` or `tournamentOdds` so a `tournamentBets`-only operator
can still publish a templated multi-choice bet without owning the odds
editor.

Full admin always passes; everywhere we check a permission we also
implicitly allow `role = 'admin'`.

## UI

- **User drawer** — `PermissionsEditor` block replaces the binary
  "Make admin" button. Top: a full-width primary button toggles the
  admin role (demoting opens the existing confirm modal). Below: a
  checkbox list, one row per canonical permission, each with a label
  and a one-line help string. Saving a checkbox is one tap (no confirm)
  because the worst case is "operator briefly held a permission they
  shouldn't" — the admin can flip it back without any data loss.
- **User list filter** — adds a "With permissions" chip alongside
  "Admins" so the admin can see every operator at a glance.
- **Role badge** — full admin shows "Admin". Scoped operator shows
  "N permissions" so the badge stays useful as the catalog grows.
- **Admin landing** — full admin sees the full grid. Scoped operator
  sees only the sections matching their granted permissions, plus a
  one-line explainer about who to ask for more.
- **Profile page** — own profile shows the comma-separated list of
  granted permissions so an operator can verify their scope.

## Settings

No new settings. The catalog is hard-coded in TypeScript and DB; the
admin grants per-user from the drawer.

## Observability

- `[admin gate] no access` — `requireAdminAccess` denial.
- `[admin gate] scoped operator bounced from path` — layout bounce.
- `[role change]` — admin↔player flip.
- `[permissions change]` — every `setUserPermissions` write, with
  before/after JSONB.

## Tests

`src/lib/admin.test.ts` covers the pure deterministic surface:

- `normalizePermissions` — allowlist enforcement, type coercion.
- `hasAnyPermission` / `grantedPathsFor` / `isPermittedPath` — full
  matrix of granted-vs-denied permutations across the catalog.
- Fail-closed checks for prefix-collision paths (e.g. `betsx`).
- Sanity check: every catalog key has a non-empty path list.

## Out of scope

- No audit log table for permission changes beyond stdout logs.
- No "view as" / impersonation support for scoped operators.
- No time-bounded or quota-bounded permissions.
- No client-side enforcement — every gate is server-side.

## Migration / rollout notes

- The migration is idempotent: `ADD COLUMN IF NOT EXISTS`, single
  `UPDATE` that's a no-op when no rows match.
- Reverting is single-step: drop the column. CHECK constraint is named
  so the rollback can target it explicitly.
- Any user who held `role = 'live_bets_admin'` between R1 and R2
  retains live-bets access (their permission flag is set during the
  backfill). The role enum value remains in the DB but is no longer
  assigned by app code.
