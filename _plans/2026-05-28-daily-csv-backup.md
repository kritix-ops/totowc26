# Daily CSV backup to private GitHub repo

**Date**: 2026-05-28
**Status**: approved, building

## Goal

Daily automatic CSV export of every meaningful table in the Toto Mundial
Postgres, pushed to a private GitHub repo as a single commit per day. The
backup must be:

- **Human-readable** — admin can open the repo and read the CSVs in a
  browser.
- **Machine-readable** — a future Claude session, given the repo, can
  reconstruct the database without external context.
- **Diff-friendly** — same filenames overwritten daily so the git history
  is the change log.
- **Independent of Supabase** — survives loss of Supabase account access.

## Constraints

- Runs on Vercel cron. One cron entry already exists (`/api/cron/sync`
  at 06:00 UTC). Hobby plan caps function duration at 60s; Pro caps at
  300s. Current data volume fits well under either, but the route must
  not allocate unbounded memory.
- Push to GitHub via REST API only — no `git` binary in the Vercel
  runtime. Use the tree+commit API for a single atomic commit.
- Resend, S3, Cloudflare, etc. are NOT used here. GitHub-only flow.
- Authorization mirrors `/api/cron/sync`: header-only `Bearer
  CRON_SECRET` check, no `?secret=` query fallback.

## Chosen approach

A new route `src/app/api/cron/backup/route.ts` that:

1. Verifies `Authorization: Bearer ${CRON_SECRET}`.
2. Queries every backed-up table with `db.execute(sql.raw(...))` to get
   raw row objects (avoids per-table Drizzle types).
3. Serializes each table to CSV (RFC 4180 quoting, UTF-8 with BOM so
   Excel renders Hebrew correctly).
4. Generates `README.md` (schema overview + restore instructions),
   `manifest.json` (timestamp, row counts, sha256 per file), and
   `schema.snapshot.sql` (current Drizzle-generated schema as of this
   backup) at the repo root.
5. Builds a single git commit via the GitHub REST API:
   - `GET /repos/{owner}/{repo}/git/ref/heads/main` → base SHA
   - `POST /repos/{owner}/{repo}/git/blobs` × N (one per file)
   - `POST /repos/{owner}/{repo}/git/trees` (flat, root + `tables/`)
   - `POST /repos/{owner}/{repo}/git/commits`
   - `PATCH /repos/{owner}/{repo}/git/refs/heads/main`
6. Inserts a row into `sync_runs` so /admin/sync surfaces the run.

### File layout in the backup repo

```
README.md
manifest.json
schema.snapshot.sql
tables/profiles.csv
tables/groups.csv
tables/teams.csv
... (22 files)
```

Same paths overwritten each day. The git log IS the daily history; to
get any past day, `git checkout <sha>` or browse by commit. No
date-named folders — that would explode the repo without giving better
information than git already provides.

### Tables backed up (22)

In FK dependency order for restoration:

1. `groups`
2. `teams`
3. `profiles`
4. `players`
5. `matches`
6. `settings`
7. `matchdays`
8. `match_bets`
9. `payments`
10. `signup_requests`
11. `point_adjustments`
12. `custom_bets`
13. `user_custom_bet_picks`
14. `bet_grading_audit`
15. `duels`
16. `sync_runs`
17. `bet_lock_defaults`
18. `stage_lock_defaults`
19. `bet_reminder_sent`
20. `user_notifications`
21. `content_overrides`
22. `content_override_history`

### Excluded

- `push_subscriptions` — contains web-push endpoint + p256dh + auth
  keys. Sensitive, recoverable per device by re-subscribing.
- `auth.users` — owned by Supabase Auth, not Drizzle-managed. Restoring
  needs Supabase Auth admin API, out of scope here. Documented in the
  README so a restorer knows to recreate users via Supabase Auth before
  importing `profiles`.

## Alternatives considered (and rejected)

- **Daily admin email** — Resend max attachment is 40MB. Convenient but
  inbox-bound, no diffs, harder to inspect later.
- **Cloudflare R2** — properly isolated, but requires an extra account
  to manage and the artifact isn't browsable without download.
- **Supabase native backups only** — Supabase already does PITR daily.
  Doesn't satisfy "independent of Supabase" or "human-readable."

## Security

- **Repo MUST be private**. Admin verifies on GitHub before the first
  run. The route checks the repo's visibility on each run (via `GET
  /repos/{owner}/{repo}`) and aborts with a 500 if it's public, logged
  loudly. Defense in depth.
- **Token**: fine-grained PAT scoped to the backup repo only, with
  Contents: read+write. Stored as `GITHUB_BACKUP_TOKEN` in Vercel env.
- **No payment proof image bodies**. `payments.note` may reference a
  proof URL but never embeds the image — that's stored externally in
  Supabase Storage and is out of scope for this backup.
- **No `push_subscriptions`** (sensitive web-push keys, as above).
- **No bypass auth**. Only callable with `Authorization: Bearer
  CRON_SECRET`. Same standard as the existing sync cron.
- Repo URL and owner are also configurable via env (`GITHUB_BACKUP_OWNER`,
  `GITHUB_BACKUP_REPO`) so they aren't hardcoded.

## Observability

Namespaced logs per rule 14. Every step emits a `[cron backup ...]`
line with the relevant values so a silent failure is debuggable from
the Vercel function log:

- `[cron backup start]` — timestamp, IL date
- `[cron backup query]` — table name, row count
- `[cron backup serialize]` — table name, csv byte length
- `[cron backup github verify]` — repo visibility (must be private)
- `[cron backup github blobs]` — count of blobs created
- `[cron backup github commit]` — commit SHA, parent SHA
- `[cron backup done]` — total duration ms, total rows, total bytes
- `[cron backup error]` — error message + stack

Also writes a row into `sync_runs` (existing audit table) with
`source = 'cron-backup'` so the /admin/sync panel shows a green/red
status. `errorMessage` and `errorStack` populated on failure.

## Settings audit (rule 15)

This is admin-only infrastructure with no player-facing surface. The
following could in theory be settings, but are intentionally env-only
(operational, not user-tunable):

- Token (`GITHUB_BACKUP_TOKEN`) — secret, env-only by definition.
- Owner / repo names — change rarely, low-risk in env.
- Schedule (cron expression in `vercel.json`) — operational, not a
  player choice.

A future toggle to **disable** the backup from /admin/settings could be
worth adding later; not in this PR.

## Cron schedule

`vercel.json`: `0 0 * * *` (midnight UTC = 03:00 Asia/Jerusalem). Runs
3 hours before the existing 06:00 IL sync, so a backup snapshots the
DB before the sync's writes hit. Both fit within Vercel's 2-daily-cron
Hobby tier limit.

## Env vars (add to Vercel + .env.local)

- `GITHUB_BACKUP_TOKEN` — fine-grained PAT, Contents r/w on the backup
  repo only.
- `GITHUB_BACKUP_OWNER` — GitHub username/org that owns the repo.
- `GITHUB_BACKUP_REPO` — repo name (e.g. `toto-mundial-backups`).
- `GITHUB_BACKUP_BRANCH` — optional, defaults to `main`.

## Restore procedure (documented in the generated README)

1. Provision a fresh Supabase project. Apply Drizzle migrations
   (`pnpm db:migrate`) so the schema exists.
2. Recreate auth users via Supabase Auth admin API (CSV does not back
   up `auth.users`). Their UUIDs must match `profiles.id`.
3. Disable triggers / RLS for the import session.
4. Import each CSV in the order listed above (FK dependencies). Use
   `COPY ... FROM STDIN WITH (FORMAT csv, HEADER true, FREEZE false)`.
5. Re-enable triggers / RLS. Verify row counts against `manifest.json`.
6. Players re-subscribe to push from their devices (push_subscriptions
   wasn't backed up).

## Open questions

- Should the route also include `auth.users` via the Supabase Auth
  admin API? Decided NO for the first pass — adds a new failure mode
  (Supabase Auth API rate limits, separate token) for data we can
  recreate via existing invite flow. Revisit if a real disaster
  recovery drill shows it's needed.

## Test plan

- Manual smoke run: hit the route locally with `CRON_SECRET` and a
  test repo, verify all files land with expected row counts.
- Inspect first production commit by opening the repo in the browser
  and confirming `manifest.json` row counts match
  `select count(*) from <table>` for each.
- Verify the route gracefully degrades when the env vars are missing
  (returns 500 with a clear message, doesn't crash the deployment).
