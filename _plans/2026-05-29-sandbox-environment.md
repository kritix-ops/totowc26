# Sandbox environment with push-to-production

**Date:** 2026-05-29
**Status:** Approved, executing in-session
**Owner:** Yoav
**Scope:** Stand up a parallel "sandbox" deployment of the app for testing
significant changes (new UI/logic features) without touching production,
and expose three admin-only controls inside the sandbox to promote work
to prod when it's ready.

---

## 1. Goal

Today, every change is built directly against the live DB and the only
deployment is production. There is nowhere safe to try a big UI rework,
a new betting flow, or an experimental scoring rule without risking real
data or surprising the friends who are mid-tournament.

This plan creates a second, fully isolated environment ("sandbox") that
mirrors the production code path but runs on its own Vercel project and
its own Supabase database. From inside the sandbox, the admin gets a
small panel with three buttons:

1. **Push code to production** — merges the `sandbox` git branch into
   `main`, which triggers Vercel to deploy prod automatically (including
   any DB migrations via the existing `prebuild` hook).
2. **Push settings to production** — copies the `settings` table (the
   single-row config table) from sandbox DB to prod DB.
3. **Refresh sandbox data from production** — pulls a fresh snapshot of
   the operational tables (teams, matches, settings) from prod into
   sandbox so testing happens against realistic data.

Crucially: **data flows one way for user/bet tables — prod → sandbox,
never the reverse.** The push-to-prod controls only push *code* and
*config*. User accounts, bets, payments, and grading results in prod are
sacred and are never overwritten by sandbox state.

---

## 2. Architecture

```
GitHub: yoav/toto-mundial (one repo)
├── main branch     ──► Vercel project "toto-mundial"          ──► toto.kritix.io        + Supabase prod project
└── sandbox branch  ──► Vercel project "toto-mundial-sandbox"  ──► sandbox.toto.kritix.io + Supabase sandbox project
```

- **One git repo, two long-lived branches.** `main` is prod, `sandbox`
  is the integration branch for in-flight work. Day-to-day development
  happens on `sandbox` (or feature branches off `sandbox` that PR back
  into it). Promotion to prod = merge `sandbox` → `main`.
- **Two Vercel projects**, each tracking exactly one branch. The prod
  project ignores `sandbox` pushes; the sandbox project ignores `main`
  pushes. This is configured in each project's Settings → Git → Ignored
  Build Step or the simpler "Production Branch" setting.
- **Two Supabase projects**, completely isolated. The sandbox DB starts
  empty and is hydrated either by running `pnpm db:migrate` (schema
  only) or by the "Refresh from production" button (schema + operational
  data, see §4.3).
- **Same drizzle migration history** — both DBs run the exact same set
  of migrations. The existing `prebuild` hook (`scripts/maybe-migrate.mjs`)
  handles this automatically on each Vercel deploy.

### Why this shape (and the rejected alternatives, per CLAUDE.md rule 4)

| Option | Why we picked / rejected it |
|--------|----------------------------|
| **One repo, two branches** (chosen) | One source of history; cherry-picking, hotfixes, and rebases all work as normal git; promotion is a single merge commit; Vercel natively supports per-branch projects. |
| Two separate repos with mirror push | Doubles maintenance, every PR needs to be mirrored, force-push semantics in mirroring destroy prod history if a sandbox rebase happens. Rejected. |
| One Vercel project with preview deployments | Vercel previews are ephemeral and short-lived URLs. A long-lived "sandbox.toto.kritix.io" needs to be a real project so the URL is stable and env vars are durable. |
| Schema-level "is_sandbox" flag in one DB | Massive risk of a forgotten WHERE clause cross-contaminating sandbox into prod queries. Rejected outright. |

---

## 3. Environment variables

### New variables (sandbox project ONLY — never set on prod)

| Var | Purpose | Where it goes |
|-----|---------|---------------|
| `NEXT_PUBLIC_TOTO_ENV` | `"sandbox"` on sandbox, `"production"` (or unset, treated as production) on prod. Drives the visible "SANDBOX" banner and gates the sandbox admin panel. | Sandbox: `sandbox`. Prod: unset or `production`. |
| `PROD_DATABASE_URL` | Pooled connection string to the prod Supabase DB. Used by the "Push settings to prod" action. **Sensitive.** | Sandbox only. |
| `PROD_DIRECT_URL` | Direct (port 5432) connection string to the prod Supabase DB. Used by the "Refresh sandbox from prod" action to do bulk COPY/SELECT. | Sandbox only. |
| `GITHUB_DEPLOY_TOKEN` | Fine-grained PAT scoped to the `toto-mundial` repo with `Contents: read+write`. Used to call the GitHub merge API. | Sandbox only. |
| `GITHUB_DEPLOY_OWNER` | GitHub username/org that owns the repo. | Sandbox only. |
| `GITHUB_DEPLOY_REPO` | `toto-mundial`. | Sandbox only. |

### Existing variables (both projects, with sandbox-specific values)

Every existing var in `.env.example` (Supabase keys, DATABASE_URL,
DIRECT_URL, RESEND_API_KEY, etc.) must be set on the sandbox project
pointing at the **sandbox** Supabase project, sandbox Resend sender, etc.
This is just normal multi-environment setup; no code changes needed.

`ADMIN_NOTIFICATION_EMAIL` on sandbox should probably point to the
admin's own inbox with a "[sandbox]" tag, but that's an env-var
configuration choice, not a code change.

---

## 4. Scope of changes

### 4.1 New env helper — `src/lib/env.ts`

A tiny typed wrapper that exposes:

```ts
export type TotoEnv = "production" | "sandbox";

export function totoEnv(): TotoEnv {
  return process.env.NEXT_PUBLIC_TOTO_ENV === "sandbox" ? "sandbox" : "production";
}

export function isSandbox(): boolean {
  return totoEnv() === "sandbox";
}

export function isProduction(): boolean {
  return totoEnv() === "production";
}
```

This is the *only* place the raw env var is read. Everything else
imports `isSandbox()` so we never get string typos elsewhere.

### 4.2 New prod-DB client — `src/db/prod-db.ts`

A second Drizzle client, mirroring the singleton pattern in
`src/db/index.ts` but pointing at `PROD_DATABASE_URL`. The module
defensively throws if `isSandbox()` is false (defense in depth — a
production deployment that somehow gained `PROD_DATABASE_URL` should
still refuse to use it).

```ts
import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { isSandbox } from "@/lib/env";

let cached: ReturnType<typeof drizzle> | null = null;

export function prodDb() {
  if (!isSandbox()) {
    throw new Error("prodDb() is only available in sandbox env");
  }
  if (!process.env.PROD_DATABASE_URL) {
    throw new Error("PROD_DATABASE_URL is not set");
  }
  if (cached) return cached;
  const client = postgres(process.env.PROD_DATABASE_URL, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
  });
  cached = drizzle(client, { schema, casing: "snake_case" });
  return cached;
}
```

### 4.3 New sandbox admin section — `src/app/[lang]/admin/sandbox/`

- **`page.tsx`** — server component. If `!isSandbox()` → `notFound()`.
  Otherwise renders the page header + `<SandboxPanel>` client component.
  Pre-loads the diff between sandbox and prod `settings` rows so the user
  sees what would change *before* clicking the button.
- **`SandboxPanel.tsx`** — client component with three cards:
  - **Push settings to production** — Shows the diff (rows where
    sandbox value ≠ prod value, with both values). Disabled when diff
    is empty. Clicking opens a confirmation modal listing the exact
    columns about to change. On confirm, calls `pushSettingsToProd`.
  - **Push code to production** — Shows the latest commit on sandbox,
    the latest commit on main, and the commits ahead. Disabled when
    nothing to push. Clicking opens a modal showing the commit list
    and asking for a merge commit message. On confirm, calls
    `pushCodeToProd`. The Vercel deploy that follows is observable in
    the Vercel dashboard; we surface a link to it from the success state.
  - **Refresh sandbox from production** — Lists the tables that will be
    truncated and reloaded (teams, players, matches, matchdays,
    settings, sync_runs — explicitly NOT profiles, bets, payments,
    user_notifications). Clicking opens a "this will destroy all
    sandbox test data in these tables" confirmation. On confirm, calls
    `refreshSandboxFromProd`.
- **`actions.ts`** — three server actions matching the patterns in
  `src/app/[lang]/admin/paybox-actions.ts`:
  - `pushSettingsToProd(): Promise<PushSettingsResult>`
  - `pushCodeToProd({ message }): Promise<PushCodeResult>`
  - `refreshSandboxFromProd(): Promise<RefreshResult>`
  Each one (a) requires admin auth, (b) requires `isSandbox()` true,
  (c) logs the attempt with namespace `[admin sandbox <action>]`, and
  (d) returns a discriminated union (`{ ok: true, ... }` | `{ ok: false, error: ... }`).
- **`diff-helpers.ts`** — pure helpers to compute the column-level diff
  between two `settings` rows and to compute the commits-ahead between
  two branches via the GitHub compare API.

### 4.4 New sandbox banner — `src/components/SandboxBanner.tsx`

A thin red-ish strip at the very top of every page when `isSandbox()`:
"⚠️ סביבת סאנדבוקס — הנתונים כאן זמניים ולא יוצגו למשתתפים".
Mounted in `src/app/[lang]/layout.tsx` above all existing content,
inside the existing locale-aware tree. Hidden entirely in production
(returns `null`).

Rationale (CLAUDE.md rule 10, lazy user): if the admin ever has both
toto.kritix.io and sandbox.toto.kritix.io open in different tabs, they
must be unable to confuse the two. A persistent visible banner makes
that confusion impossible.

### 4.5 Sandbox tile on the admin home — `src/app/[lang]/admin/page.tsx`

Add a new `<AdminTile>` to the "System & ops" section (or its own tiny
section) titled "סאנדבוקס / Sandbox" linking to `/admin/sandbox`.
**Rendered only when `isSandbox()` is true** so the prod admin doesn't
see a dead tile.

### 4.6 Sandbox-aware site title (small polish)

In `src/app/[lang]/layout.tsx`, prefix the `<title>` and any
`apple-mobile-web-app-title` with `[SANDBOX]` when `isSandbox()`. Cheap
visual safety net: the browser tab is unambiguous even if the banner
is scrolled off.

### 4.7 `.env.example` update

Add the six new env vars from §3 with explanatory comments. Critically:
the comments make it explicit that `PROD_*` and `GITHUB_DEPLOY_*`
**belong only on the sandbox project** and must never be set on the
prod project.

### 4.8 No new migrations

Nothing in the DB schema changes for this feature. The sandbox runs the
same schema as prod.

---

## 5. The three actions in detail

### 5.1 `pushSettingsToProd`

```
1. requireAdmin + requireSandbox → forbidden otherwise.
2. Read [sandbox] settings row (id=1) from local db.
3. Read [prod] settings row (id=1) from prodDb().
4. Compute the column diff. If empty: return { ok: true, changed: 0 }.
5. Build an UPDATE statement that sets every column whose value differs.
   Use Drizzle to enforce types. Include updatedAt = now().
6. Execute on prodDb(). If 0 rows affected, error (shouldn't happen,
   id=1 always exists).
7. Log: `[admin sandbox push-settings]` { adminId, changedColumns, prodCommitSha? }
8. Return { ok: true, changed: <count>, columns: [<names>] }.
9. Wrap in try/catch; on error log + return { ok: false, error: "db" }.
```

**Settings audit caveat (rule 15):** Some columns in `settings` are
operationally critical — e.g. `matchPicksGlobalLockAt` controls when all
betting locks for the tournament. Pushing a sandbox test value will
break prod. **Mitigation:** the UI always shows the full diff and
requires explicit confirmation listing exactly the columns about to
change. We do not push silently. If we later find a column should *never*
be pushed (e.g. `mobileNavConfig` if we want it managed only on prod),
add an exclusion list in `diff-helpers.ts`. Phase 1 ships with no
exclusions and a strong confirm UX.

### 5.2 `pushCodeToProd`

```
1. requireAdmin + requireSandbox.
2. Validate commit message (non-empty, < 200 chars). Default if empty:
   `chore: promote sandbox to production (YYYY-MM-DD HH:MM IL)`.
3. Call GitHub Compare API to confirm there are commits ahead.
   GET /repos/:owner/:repo/compare/main...sandbox
   - If ahead_by === 0: return { ok: true, merged: false, reason: "up-to-date" }
4. Call GitHub Merge API:
   POST /repos/:owner/:repo/merges
   { base: "main", head: "sandbox", commit_message }
   - 201: success, capture merge sha
   - 204: nothing to merge (covered above, but log + soft-success)
   - 409: merge conflict → return { ok: false, error: "conflict", details: ... }
   - 401/403: bad token → return { ok: false, error: "auth" }
5. Log: `[admin sandbox push-code]` { adminId, mergeSha, aheadBy }
6. Return { ok: true, merged: true, sha, vercelDashboardUrl }.
```

Vercel auto-redeploys on the new commit on `main`. The `prebuild`
script runs `drizzle-kit` migrations as part of the build, so schema
changes that were tested on sandbox apply to prod automatically when
the build runs. **This is intentional** and matches the user's
preference (see Settings audit decision in this plan: "כן — כמו היום").

### 5.3 `refreshSandboxFromProd`

```
1. requireAdmin + requireSandbox.
2. Define REFRESHABLE = ["groups", "teams", "matches", "matchdays",
   "settings", "sync_runs", "bet_lock_defaults", "stage_lock_defaults",
   "players", "content_overrides"]
   Explicit NON_REFRESHABLE (commented in code): profiles, payments,
   match_bets, custom_bets, user_custom_bet_picks, duels, signup_requests,
   point_adjustments, bet_grading_audit, bet_reminder_sent,
   user_notifications, push_subscriptions, content_override_history.
3. Open a transaction on local (sandbox) db.
4. For each table in REFRESHABLE (in reverse FK order for truncate):
   TRUNCATE TABLE :name RESTART IDENTITY CASCADE;
5. For each table in REFRESHABLE (in FK order for restore):
   SELECT * FROM prod, batch INSERT into sandbox (paginated 1000 rows
   at a time to avoid memory blowup on `matches`).
6. Commit.
7. Log: `[admin sandbox refresh-data]` { adminId, perTable: {...} }
8. Return { ok: true, perTable: {teams: 48, matches: 104, ...} }.
```

If anything fails mid-stream, ROLLBACK the transaction (Postgres ensures
sandbox is left as it was). Log the failure with full error.

**`auth.users` is not copied.** That table is owned by Supabase Auth,
lives in its own schema, and is not in our Drizzle schema. The sandbox
will continue to use its own auth users (the admin and any test users
they manually invite to sandbox via Supabase). Since `profiles` is in
NON_REFRESHABLE, the FK from `profiles.id` → `auth.users.id` is never at
risk during a refresh.

---

## 6. Security

Per CLAUDE.md rule 13, security is first-class:

| Risk | Mitigation |
|------|-----------|
| Sandbox is compromised → attacker reads/writes prod DB | `PROD_DATABASE_URL` is only ever in Vercel env vars (never in client bundles). The connection uses the Supabase `postgres` role which is service-level; treat it like a service-role key. Rotate yearly. |
| Non-admin user discovers `/admin/sandbox` URL | Same `requireAdmin` guard as every other admin page. Layout is `force-dynamic` already. |
| Prod deployment accidentally has `NEXT_PUBLIC_TOTO_ENV=sandbox` | `isSandbox()` defaults to false unless explicitly `"sandbox"`. The Vercel project for prod must never set this var. Documented in `.env.example`. |
| Sandbox panel is rendered on prod due to env var misconfiguration | Defense in depth: `pushSettingsToProd` / `pushCodeToProd` / `refreshSandboxFromProd` each re-check `isSandbox()` server-side and refuse if false, regardless of UI state. |
| GitHub token is over-scoped → attacker pushes arbitrary code | Use a **fine-grained PAT** scoped to a single repo with `Contents: read+write` only. No `Workflows`, no `Actions`, no `Admin`. The token can merge code but cannot rewrite history, create releases, or change repo settings. |
| Force-push from sandbox destroys prod history | The action uses the GitHub Merge API (`POST /repos/.../merges`), which creates a merge commit. It does not force-push. Even with the token, prod history is append-only. |
| Sandbox refresh leaks PII to a developer with sandbox access | `profiles`, `match_bets`, `payments` are explicitly excluded from refresh. Only "public" data (teams, matches, settings, sync metadata) is copied. |
| Settings push overwrites a critical prod value silently | The UI requires the admin to see and confirm the per-column diff. No "yolo push" path. |
| `prebuild` runs a destructive migration on prod when code is pushed | Same risk as today's normal deploy. The mitigation is the same: review the migration before merging to `main`. The sandbox lets us *test* the migration first, which actually *reduces* this risk vs. today. |

**Explicit threat-model assumption:** the admin's account is trusted.
This is a friends pool with one admin (`yoav@kritix.io`). The whole
feature collapses if that account is compromised, but so does every
other admin tool already shipped. Memory `project_stakes` applies —
calmly noted, not catastrophized.

---

## 7. Observability (CLAUDE.md rule 14)

Every action emits one `console.info` on success and one `console.error`
on failure, using the project's `[namespace step]` convention:

| Event | Log |
|-------|-----|
| Settings push success | `[admin sandbox push-settings]` { adminId, changedColumnCount, columns } |
| Settings push denied (not sandbox) | `[admin sandbox push-settings denied]` { reason: "not-sandbox" or "not-admin" } |
| Settings push failure | `console.error("[admin sandbox push-settings] failed:", err)` |
| Code push success | `[admin sandbox push-code]` { adminId, mergeSha, aheadBy } |
| Code push conflict | `console.warn("[admin sandbox push-code] conflict", { adminId, details })` |
| Code push failure | `console.error("[admin sandbox push-code] failed:", err)` |
| Refresh success | `[admin sandbox refresh-data]` { adminId, perTable: {...}, durationMs } |
| Refresh failure | `console.error("[admin sandbox refresh-data] failed:", err)` |

The banner mount, the page render, and the `isSandbox()` guard don't
need logs (state is visible in DevTools).

---

## 8. Settings audit (CLAUDE.md rule 15)

| Surface | User-configurable? | Decision |
|---------|--------------------|----------|
| `NEXT_PUBLIC_TOTO_ENV` | No — deployment config | Correct. Set in Vercel UI per project. |
| `PROD_DATABASE_URL`, `PROD_DIRECT_URL`, `GITHUB_DEPLOY_*` | No — secrets | Correct. Vercel env vars only. |
| What tables get refreshed | Could be configurable in future | **Phase 1: hardcoded `REFRESHABLE` array** in `actions.ts`. If we end up tweaking it often, promote to a settings JSONB column. Not now. |
| Which `settings` columns can be pushed | Could be an exclusion list | **Phase 1: all columns**, with diff+confirm UX as the safety net. Add an exclusion list only when we identify a column that should never sync. |
| Banner copy / color | Could be themeable | No. Banner is a safety feature, not a brand surface. Hardcoded in `SandboxBanner.tsx`. |

No new entries in the `settings` table.

---

## 9. QA plan

After all changes are in:

1. `pnpm lint` clean.
2. `pnpm test` existing suite passes.
3. `pnpm build` succeeds.
4. **Local dev as fake-sandbox**: set `NEXT_PUBLIC_TOTO_ENV=sandbox`
   and `PROD_DATABASE_URL=` (pointing at a throwaway second local DB),
   visit `/he/admin/sandbox`:
   - Banner shows at the top of every page in red.
   - Tab title prefixed with `[SANDBOX]`.
   - Sandbox tile appears on `/admin`.
   - Sandbox page renders three cards.
   - Settings diff is computed correctly (modify a value in one DB and
     refresh; the diff list should show that column).
   - Push settings: confirm modal lists columns, after confirm the
     prod DB shows the new values, logs include changed count.
   - Push code: with `GITHUB_DEPLOY_TOKEN` set on a fork, calling the
     compare API succeeds; with `aheadBy === 0` the button is disabled.
     (Full merge tested on the real sandbox project once it exists.)
   - Refresh: counts in `perTable` match what's in prod for each table.
5. **Without `NEXT_PUBLIC_TOTO_ENV=sandbox`** (i.e. fake-prod mode):
   - Banner is not rendered.
   - Tab title is not prefixed.
   - `/admin/sandbox` returns 404.
   - Sandbox tile is not on `/admin`.
   - Directly calling `pushSettingsToProd` server action fails with
     forbidden.
6. **Responsive (CLAUDE.md project rule)**: open `/admin/sandbox` at
   360px, 414px, 768px, 1024px, 1440px. Confirm:
   - No horizontal scroll
   - Diff table degrades to stacked cards under `md`
   - Confirmation modal is full-width under `md`, max-w-md above
   - Buttons are ≥ 48px tall
7. **i18n**: switch `/en/admin/sandbox` and `/he/admin/sandbox`,
   confirm both render with their respective copy.

---

## 10. Rollout (one-time setup, outside this code change)

This is the manual checklist Yoav executes after the code change lands.
None of these are blockers for the code review itself; they are the
go-live runbook.

1. **GitHub**: create a `sandbox` branch from current `main`. Push.
2. **Supabase**: create a new project "toto-mundial-sandbox" in the same
   region. Note its connection strings + anon key + service-role key.
3. **Resend** (optional): create a separate API key with "sandbox" name,
   or reuse the prod one (sandbox sends very few emails — to the admin
   only).
4. **Vercel**: create a new project "toto-mundial-sandbox", connect to
   the same GitHub repo, set Production Branch = `sandbox`. Set every
   env var from `.env.example` to the sandbox values, plus the six new
   ones from §3.
5. **Vercel prod project**: confirm Production Branch = `main` and that
   `sandbox` is in the "Ignored Build Step" list (or rely on the fact
   that only `main` is the production branch — other branches build but
   don't deploy to the prod domain).
6. **DNS** (optional): point `sandbox.toto.kritix.io` to the sandbox
   Vercel project. Otherwise use the auto-generated `*.vercel.app` URL.
7. **GitHub PAT**: create fine-grained PAT, scope to `toto-mundial`
   repo, `Contents: read+write`. Paste into sandbox Vercel project as
   `GITHUB_DEPLOY_TOKEN`.
8. **Migrate sandbox DB**: locally with sandbox `.env.local`, run
   `pnpm db:migrate` once to apply all 34 migrations to the empty
   sandbox DB.
9. **Smoke test**: log in as admin on sandbox, visit `/admin/sandbox`,
   click "Refresh from production" to seed sandbox with real tournament
   structure data. Verify it appears.
10. **Document for future sessions**: drop a one-liner in `AGENTS.md`
    explaining the two-environment shape so future Claude sessions know.

---

## 11. Out of scope (deferred follow-ups)

| # | Item | Why deferred |
|---|------|--------------|
| A | Per-column exclusion list for settings push | Phase 1 ships with diff+confirm UX. Add exclusion list only after we identify a real column we want to never sync. |
| B | "Snapshot users from prod" feature | Real users + bets are deliberately excluded from refresh. If we ever want to load-test on real-shaped user data, build a separate "anonymize-and-clone" job — not a button. |
| C | "Revert prod settings to previous version" | Right now we have no audit trail of settings changes on prod. Worth adding alongside per-column diff UX. Separate plan. |
| D | "Auto-promote sandbox to prod on green CI" | Eliminates the button, adds automation risk. We have no CI worth gating on yet. Revisit if CI grows. |
| E | Multi-admin sandbox with role separation | One admin today. Not needed. |
| F | Sandbox CSV backup | Sandbox is disposable by definition. Backup is prod-only. |
| G | Visual diff for `mobileNavConfig` (JSONB) in the settings diff UI | Phase 1 shows the raw JSON diff. Pretty visualization is polish. |

---

## 12. Rollback

The feature is fully gated by `NEXT_PUBLIC_TOTO_ENV=sandbox`. Rolling
back means:

- **Code rollback**: revert the PR. The new files have no callers in
  the prod code path (the sandbox page is `notFound()` on prod, the
  banner returns `null`, the admin tile is hidden). Pure dead code on
  prod until activated.
- **Infrastructure rollback**: delete the sandbox Vercel project, delete
  the sandbox Supabase project, delete the GitHub PAT. The prod side is
  untouched.

Zero data risk to prod from this code change itself — the only path
that writes to prod is `pushSettingsToProd`, and it only runs when an
admin explicitly clicks the button inside a sandbox-only page that
prod cannot render.
