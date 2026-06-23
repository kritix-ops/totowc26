# Prod "falls" / loading-forever — the once-and-for-all reliability fix

Date: 2026-06-23
Status: PROPOSED — awaiting approval before any code
Reporter: user ("there are too many falls again; Supabase and Vercel are both
paid and over-provisioned, why does it keep falling?"); peak load is **30
users max**.

## The honest headline

It is not capacity, and no upgrade fixes it. Three prior passes (06-10, 06-12,
06-17) were correct-direction band-aids that made the failure happen *faster*
but never removed the structural cause. The recurrence is the proof. This plan
removes the cause, not another symptom.

## Goals

1. Eliminate the "loading forever" / red-error experience during matchday peaks.
2. Make any future overload degrade into a fast, retryable error (seconds, not
   5 minutes), never an app-wide freeze.
3. Do it with zero new spend, and document what the over-provisioning can be
   walked back to once stable.

## Constraints / requirements (verified today)

- Peak concurrency: ~30 users. Tiny.
- DB is healthy under a live probe: every query <130 ms, 0 deadlocks, 17/90
  backends, pooler size 35, data tiny. The DB is NOT the bottleneck.
- This is a modified Next.js build (see AGENTS.md). Any route-segment config
  (`maxDuration`, `dynamic`, `revalidate`) MUST be checked against
  `node_modules/next/dist/docs/` before implementation, not assumed from
  training data.
- Manual-override and bank-overdraft guarantees must not weaken (rule 13).

## Root cause (verified 2026-06-23, three evidence layers)

Live DB probe + Vercel runtime logs + code read all converge on one mechanism,
client-side and invisible to Postgres:

1. **No `maxDuration` on the hot routes.** Verified: dashboard
   `src/app/[lang]/page.tsx`, `leaderboard/page.tsx`, `bets/page.tsx`,
   `duels/page.tsx`, and `[lang]/layout.tsx` export **no** `maxDuration`, so
   they default to Vercel's **300 s**. Only `bets/live/[date]/page.tsx` has
   `maxDuration = 60` (added in 91dc507). A request that stalls therefore squats
   for five minutes behind a spinner before Vercel kills it. That is the "fall".
2. **No pool-acquisition timeout.** `src/db/index.ts` uses postgres-js
   `max: 10`. postgres-js has no option to bound the wait to *acquire* a pool
   slot; `connect_timeout` (TCP) and `statement_timeout` (query execution) do
   not cover it. Surplus queries queue inside Node indefinitely.
3. **Heavy per-render fan-out.** The signed-in dashboard streams many Suspense
   sections (SmartHub, TodaysBets, PoolDigest, Leaderboard, LastBet, News, hero
   stats), ~20 concurrent queries per render (documented 06-10/06-17).

Failure chain: matchday peak -> the ~30 users hit the dashboard/leaderboard at
once -> each render fires ~20 concurrent queries through a 10-slot pool ->
surplus queues with no acquire timeout -> the route has no `maxDuration` so
Vercel waits the full 300 s -> infinite spinner -> user refreshes -> the refresh
aborts the function mid-flight (historically leaking a pooler backend, 06-12).
The DB stays idle throughout because the queries never reach it — which is
exactly why every DB probe looks clean.

### Ruled out (verified, not assumed)

- Capacity / compute / plan tier: data is tiny, queries are fast, 30 users.
- `sync` cron cold-busting the cache every 5 min: **false** — `src/lib/sync.ts`
  calls no `revalidateTag`/`revalidatePath`. (Side effect: a real *staleness*
  gap exists — DB updates are not pushed into Next's Data Cache — but it is a
  data-freshness issue, not a cause of the falls. Tracked separately below.)

## Chosen approach — two tiers

### Tier 1 — fail fast (near-zero risk, deploy first, ideally tonight)

T1.1 Add a short `maxDuration` to every hot route segment (dashboard,
     leaderboard, bets, duels). Candidate value 25 s: long enough for the
     slowest legitimate cold render, short enough that a stuck request returns a
     retryable error fast instead of squatting 300 s. Prefer setting it once on
     `[lang]/layout.tsx` if the bundled Next docs confirm it cascades to child
     segments; otherwise set per page. **Read the bundled Next docs first.**
T1.2 Confirm the page's `try/catch` + `loading.tsx` render a clean, branded
     "couldn't load, tap to retry" state when the cap trips, on mobile 360 too
     (rule: responsive). If the current fallback is a raw error, fix it — a
     lazy user must see a retry affordance, not a stack trace (rule 10/16).

Tier 1 alone converts every "loading forever" into "error in <30 s you can
retry". It does not remove the saturation; it removes the worst symptom safely.

### Tier 2 — remove the starvation (the actual root fix)

T2.1 Raise postgres-js `max` from 10 to ~20 in `src/db/index.ts` so a single
     render's fan-out never queues against itself. Headroom check: ~30 users is
     a few warm Fluid instances; even 5 instances x 20 = 100 client connections
     < the pooler's 400 client-connection ceiling, and the 35 server backends
     cycle in sub-ms. (History: `max: 3` was too low and caused the 300 s death
     on 06-17; this moves further in the proven direction.)
T2.2 Bound the acquire wait. postgres-js gives no native acquire timeout, so
     wrap the per-section dashboard reads (and the other hot pages' top-level
     reads) in the existing `withTimeout` (`src/lib/with-timeout.ts`, already
     used by SmartHub) at e.g. 8 s, returning a safe default on timeout. This
     turns starvation into a fast caught error per section instead of a
     whole-page 300 s hang — defense in depth on top of T1.

Recommendation: ship T1 first as its own deploy, then T2 as a reviewed
follow-up the same night or next morning. T2.1 is one line; T2.2 is surgical and
test-covered.

### Deferred by deliberate decision (do NOT speculatively build)

- Full fan-out re-architecture (collapse ~20 queries to <=5): assessed 80% done
  in 06-17; re-evaluate only if post-deploy probes still show queuing.
- Pushing sync updates into the Data Cache (revalidateTag on settle/score) to
  fix the staleness gap: real, but a separate freshness workstream, not part of
  the falls fix.

## Alternatives considered and rejected

- **Buy bigger compute / keep the Pro tiers as the fix.** Rejected: the data is
  tiny and the bottleneck is in-process pool starvation, not CPU/RAM. Capacity
  hides it; it has hidden it three times and it came back. Part of the current
  spend is likely reversible once T1+T2 hold.
- **Drop the advisory lock / the fan-out resilience.** Rejected: the lock is the
  overdraft guard; the per-section `withTimeout` is resilience we want to keep.
- **Single mega-query for the dashboard.** Rejected for now: removes the
  per-section timeout isolation for negligible gain at 30 users.

## Security (rule 13)

- No new public surface. All per-user reads stay server-side and gated.
- `withTimeout` returning a safe default must never bypass the bank/overdraft
  guard on the *write* path — it wraps display reads only. The balance read +
  stake write stay inside the same locked transaction (write-core.test.ts).
- `maxDuration` is a ceiling, not auth; every query still runs under gated paths.

## Observability (rule 14)

- Add a `console.warn('[db pool] acquire-timeout', { route, section, ms })` when
  a `withTimeout` trips, so the next peak leaves grep-able evidence of *which*
  section starved — today the falls leave almost no app-side trace.
- Keep the existing diagnostics (`scripts/one-off/diag-slow-queries-*.mjs`,
  `check-prod-db-*.mjs`). Re-run during the next matchday peak (the real test).
- Confirm we can pull Vercel runtime logs on demand (done today via CLI token).

## Testing (rule 18)

- Unit: `withTimeout` wrapper returns the safe default on timeout and the real
  value otherwise (extend existing with-timeout tests).
- Unit: the shared-settings / bank read mappers unchanged and green.
- Regression: full vitest suite green (current baseline ~647-650 pass, the 2
  qa-agent env-gap suites excluded as documented).
- Manual QA: cold-load dashboard + leaderboard + bets + duels at 360 / 414 /
  768 / 1024 / 1440; verify retry state renders when forced to time out; place
  5 picks in a row and in two tabs (no double-spend, balance correct).

## Settings (rule 15)

- No user-facing setting. The timeout values (`maxDuration`, `withTimeout` ms,
  pool `max`) are operational constants with documented rationale in code
  comments, deliberately not exposed.

## Cost (rule 8)

- All changes are free (config + a few lines). They reduce, not increase, spend,
  and make a future downgrade of the Supabase compute / Vercel tier assessable
  once stable.

## Open decision for the user (one only)

Scope/urgency: **(recommended)** ship Tier 1 tonight as a standalone deploy,
then Tier 2 as a reviewed follow-up — vs do both in one combined pass. Tier 1 is
near-zero risk and stops the visible bleeding before the knockout-round crowds.

## Implementation result — Tier 1 (2026-06-23)

Shipped on the `sandbox` branch:
- `export const maxDuration = 25` added to the four hot routes that had none:
  `[lang]/page.tsx`, `[lang]/leaderboard/page.tsx`, `[lang]/bets/page.tsx`,
  `[lang]/duels/page.tsx`. Each carries a comment pointing here. Verified
  against the bundled Next v16 docs (`maxDuration` is page/layout/route level
  and governs Server Actions when set at page level; not among the configs
  removed under Cache Components). Set per-page to match the existing
  `bets/live/[date]` pattern and to cover those pages' Server Actions.
- UX on cap-trip: client-side navigations are caught by the existing branded
  `[lang]/error.tsx` retry boundary; every hot route already has a
  `loading.tsx` skeleton. A cold *initial* load that trips the cap still shows
  Vercel's own 504 (a refresh hits a warm path); the always-branded path is
  Tier 2's job (sections return 200 with safe defaults).
- QA: `vitest run` 725/725 pass (51 files); `eslint` clean on changed files;
  `tsc --noEmit` clean (only the pre-existing qa-agent/agent-loop env-gap
  errors remain, unchanged).

Tier 2 (pool `max` 10->20 + `withTimeout` on the hot reads) is the next pass,
per the user's chosen staging (Tier 1 tonight, Tier 2 after).

## Implementation result — Tier 2 (2026-06-23)

Shipped on the `sandbox` branch:
- T2.1: `src/db/index.ts` postgres-js `max` 10 -> 20, so one render's ~20-query
  fan-out fits without self-queuing. Verified against the installed postgres
  v3.4.9 README that there is NO native pool-acquire timeout (only max /
  idle_timeout / connect_timeout / max_lifetime), so the wait had to be bounded
  in app code. Client-connection math checked: ~30 users x a few warm instances
  x 20 stays far under the pooler's 400 client ceiling. Comment updated so it is
  not stale.
- T2.2: wrapped the three uncached, per-user dashboard section reads —
  `getUpcomingFixtures`, `getLatestFinalForUser`, `getPointsTrend` — in the
  existing server `withTimeout` (`@/lib/moments/timeout`) at an 8s budget
  (`DASH_SECTION_TIMEOUT_MS`), resolving to `[]` / `null` / `[]`. A starved
  section now degrades to its empty state (refresh refills it) instead of
  holding the function open to the 25s page cap. Fallback shapes are the same
  ones `mockDashboard()` already renders, so they are proven safe.
- Deliberately NOT wrapped: the cached aggregates (leaderboard, pool digest,
  news, hero stats, rank). They rarely touch the DB and an empty fallback would
  mislead; maxDuration (T1) is their backstop.
- Honest behavior change: `withTimeout` resolves the fallback on a query *error*
  too, not only on timeout. For these three non-critical display sections that
  means a query error now degrades that one card (logged via
  `[moments generator failed]`) instead of bubbling to `[lang]/error.tsx` and
  blanking the page — which is exactly the "degrade one card, not the page" goal
  that boundary's own comment states. Bank / auth / write paths are untouched.
- QA: `vitest run` 725/725 pass; `eslint` + `tsc --noEmit` clean on changed
  files. The wrapped behavior's core logic (value / timeout-fallback /
  error-fallback) is covered by `src/lib/moments/timeout.test.ts`.

## Verification after deploy (rule 6)

1. During the next matchday peak, re-run the DB + slow-query probes; confirm no
   queuing and the new `[db pool]` warn line is quiet.
2. Vercel logs: zero `FUNCTION_INVOCATION_TIMEOUT` on the hot routes.
3. If queuing still appears, escalate to the deferred fan-out collapse (T2.1
   deferred item) — but only then, with data.
