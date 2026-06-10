# Fix: production-wide hang — DB pooler backend saturation

Date: 2026-06-10
Status: Implemented (A+B), QA green, pending deploy
Reporter: user ("הימורי טורניר and all other ... users click שומר and it's stuck forever", whole app slow, picks lost)

## Symptom

On production (`toto-mundial-2026`), intermittently the whole app goes
slow / hangs: pages stall, every save button sits on "שומר…" forever,
and the pick is never persisted (lost on refresh). Confirmed across
BOTH save transports (match-score saves via the `/api/bets/save` route
handler AND custom/tournament saves via the `submitCustomBetPick`
server action), so it is not a button or a single-path bug.

## Root cause (verified against the live DB, not guessed)

The signed-in dashboard streams ~10 Suspense sections, each fanning out
its own `Promise.all` of DB queries — roughly **20 concurrent queries
per dashboard render** (SmartHub alone fires 6+, UpcomingSection 5,
plus hero/status/digest/lastbet/trend/leaderboard/community/prize).

Live DB forensics (read-only probe, twice) showed:
- `numbackends ≈ 20` both times — that is the Supabase transaction
  pooler's (Supavisor) backend ceiling for this compute tier.
- **0 deadlocks, 0 lock waits, 0 idle-in-transaction** sessions.
- Every executed app query is fast (leaderboard 3.5ms, fixtures 3.6ms,
  bank fast). The only slow statements are system/dashboard
  introspection (`pg_timezone_names` 720ms, extension introspection),
  never in the user request path.

So a couple of concurrent dashboard loads saturate the ~20 pooler
backends. Every further query — reads and **saves** — then queues at
the pooler. `postgres-js` has NO acquisition timeout, so queries wait
until the Vercel function is killed: pages hang (Vercel logs show
`---` statuses + `[moments timeout] 800ms`), the save query never gets
a backend so the write never runs (pick lost), and the client button
(also no timeout) sits on "שומר…". The DB looks healthy when probed
because queue-wait time is invisible to Postgres.

## Fix (A + B; both additive, reversible, no schema/data changes)

### A — cut the per-render fan-out (reduce backend demand)

Most global queries are ALREADY cached (`getPoolStats`,
`getTournamentStart`, `getCategoryPrizeBreakdown`, `getBetLockMinutes`).
Remaining uncached repeats on the dashboard render:

1. `getTransparencyDigest(locale)` — the one heavy uncached global
   query (2 multi-CTE aggregates). Wrap in `unstable_cache`, key by
   locale, `revalidate: 60`. A social-proof card; 60s staleness is fine
   and it self-heals.
2. The 3 separate inline `settings` reads (scoring row, digest toggle,
   whatsapp url) in three different Suspense sections. Collapse into one
   React-`cache()`-memoized `getSettingsRow()` so they dedupe to ONE
   query per request. Request-scoped → zero cross-request staleness, no
   invalidation wiring needed.

### B — make hangs impossible (free backends + never stick the button)

3. `src/db/index.ts`: add `connect_timeout: 10` and
   `connection: { statement_timeout: 15000 }`. A stuck query frees its
   backend instead of piling up; a stuck connect fails fast. App
   queries are <1.5s so 15s never trips legit traffic; cron syncs use
   their own standalone clients.
4. New `src/lib/with-timeout.ts`: client-safe `withTimeout(promise, ms)`
   + `SAVE_TIMEOUT_MS = 20000`.
5. `QuickPickRow.tsx`: AbortController timeout on the `/api/bets/save`
   fetch in `doSave`; wrap `suggestMatchScore` in `withTimeout`.
6. `CustomBetCard.tsx`: wrap `submitCustomBetPick` in `withTimeout`;
   show a timeout error. Saves are idempotent upserts so a retry after
   a timeout can never double-write.

### Deferred (not in this pass)

- C — raising the Supavisor pool size / compute tier. Real headroom but
  costs money; revisit if A+B don't hold under peak load.

## QA checklist

- `tsc` + lint clean; `vitest run` green.
- Dashboard renders correctly (scoring scenarios, digest card, whatsapp
  card all still show).
- Save a match pick and a tournament pick — both persist; refresh shows
  them.
- Simulate a hang (offline) — button releases with an error, not stuck.
- Re-run `scripts/diag-db.mjs` after deploy; watch `numbackends` under
  load.

## Implementation result (2026-06-10)

Files changed:
- `src/db/index.ts` — added `connect_timeout: 10` + `statement_timeout: 15000`.
- `src/lib/with-timeout.ts` — new client-safe `withTimeout` + `SAVE_TIMEOUT_MS`.
- `src/db/queries.ts` — new `getSettingsRow()` (React `cache()`); wrapped
  `getTransparencyDigest` in `unstable_cache` (revalidate 60).
- `src/app/[lang]/page.tsx` — 3 inline `settings` reads → `getSettingsRow()`;
  dropped now-unused `db`/`settings`/`eq` imports.
- `src/app/[lang]/bets/QuickPickRow.tsx` — AbortController on the save fetch;
  `withTimeout` on `suggestMatchScore`.
- `src/components/CustomBetCard.tsx` — `withTimeout` on `submitCustomBetPick`.

QA: `tsc` 0 real errors (only pre-existing Next-generated `PageProps`/
`LayoutProps` globals that raw tsc can't see); `eslint` clean on all changed
files; `vitest` 250 passed / 11 skipped. The 2 failing suites
(`qa-agent/budget`, `qa-agent/browser-tools`) are pre-existing env gaps
(missing `@anthropic-ai/sdk`, no local Playwright browser) unrelated to this
change.

## Notes

- Branch: changes made on `sandbox`. Confirm `sandbox`→prod deploy
  mapping before merge (prod is `toto-mundial-2026`).
- `scripts/diag-db.mjs` is the read-only probe used to diagnose; kept
  for re-checking.
