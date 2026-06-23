# Performance root cause and permanent fix

Date: 2026-06-17
Status: Tier 1 + T2.2 implemented on sandbox, QA green, pending deploy.
T2.1 deferred with rationale (measure post-deploy first).
Reporter: user ("upgraded Vercel to Pro and Supabase as well, still many
lags, everything feels slow, sometimes loading forever"; screenshot of
/he/admin/bets failing with Next digest "error: 1963731999")

## Goal

Stop the recurring slowness and the intermittent "loading forever" / red
error screen for good. Not another band-aid. The previous three passes
(see below) each fixed a symptom and the problem came back, because the
structural cause was never removed.

## Why the Pro upgrades did not help (the honest headline)

The bottleneck is not capacity. It is configuration and architecture.
Verified facts:

- The whole dataset is tiny: 32 profiles, 1514 match bets, 1559 custom
  picks (diag-db.mjs, 2026-06-17). No query is slow because of data
  volume. Slowness is contention and network round-trips, not size.
- Switching the Supabase billing plan to Pro does NOT raise the pooler
  backend ceiling. That ceiling scales with the compute add-on and a
  separate "Pool Size" slider, neither of which a plan change touches.
- Switching Vercel to Pro adds concurrency and longer timeouts; it does
  nothing for a per-render query waterfall or a cross-region hop.

## What was already tried (and why it did not hold)

- 2026-05-27 perf-overhaul-instant-nav: streaming shell, loading.tsx,
  partial caching. Shipped. Made the shell paint fast but left the
  per-render query fan-out in place.
- 2026-05-29 save-button-hang-fix: usePendingAction so the button stops
  blocking on revalidation. Shipped. Fixed the stuck button UI, not the
  underlying DB contention.
- 2026-06-10 db-pool-saturation-fix: found via live forensics that the
  signed-in dashboard fans out ~20 concurrent queries per render and the
  pooler ceiling is ~20 backends. Added statement_timeout 15s +
  connect_timeout 10s so a saturated pool fails fast instead of hanging.
  Shipped. Explicitly DEFERRED the real fix: "C, raising the Supavisor
  pool size / compute tier ... revisit if A+B don't hold." A+B did not
  hold.

The 2026-06-10 timeouts are why the symptom changed from "hangs forever"
to "sometimes a red error screen": under saturation the admin/bets page
(several heavy sequential queries) now trips the 15s statement_timeout
and throws the Next error digest the user screenshotted. The error page
is the saturation surfacing, not a separate bug.

## Root causes, verified 2026-06-17 (diag-db.mjs read-only probe)

1. Region mismatch. Compute and DB are in different regions.
   - vercel.json pins functions to fra1 (Frankfurt, eu-central-1).
   - DATABASE_URL host is aws-0-eu-west-1.pooler.supabase.com, i.e.
     eu-west-1 (Ireland / Dublin).
   Every query crosses Frankfurt to Dublin and back (~25ms RTT), and the
   pooler backend is held for that whole round-trip, so the cross-region
   hop directly worsens pool saturation. Vercel dub1 IS eu-west-1, the
   same datacenter as the DB, so co-locating is free.

2. Pool size already raised, still slow (correction). The 2026-06-17
   probe read numbackends = 15, but numbackends is the LIVE connection
   count at probe time (the app was quiet: 10 idle + 2 active + 2
   extension + 1 = 15), NOT the ceiling. The actual ceiling is the
   Connection pool size, which the user raised from the Small-compute
   default of 15 to 35 on 2026-06-16. Max client connections is fixed at
   400 for Small. Compute is Small, which is ample for 32 users. The key
   inference: the pool lever was already pulled and the app is still slow,
   so the ceiling was never the cure. The backends are being held too
   LONG (region hop + the advisory lock below), not exhausted in number.
   Do not raise pool size further and do not buy bigger compute.

3. Per-render query fan-out. The signed-in dashboard streams ~10 Suspense
   sections, each its own Promise.all, ~20 concurrent queries per render
   (documented in 2026-06-10). With a 15-backend pool and max:10 per
   serverless instance in src/db/index.ts, two or three concurrent users
   saturate the pool; everything else queues until the function is
   killed. This is the disease. Co-location and pool size only buy
   headroom; they do not remove it.

4. Advisory-lock serialization time bomb (NEW finding). Every bet-save
   path opens db.transaction and immediately calls lockUserForBetting
   (src/lib/bank.ts:287), a transaction-scoped per-user
   pg_advisory_xact_lock held for the WHOLE transaction
   (src/lib/bets/write-core.ts). Probe:
   `select pg_advisory_xact_lock(hashtext($1))` ran 1630 times, mean
   96.4ms, MAX 106046ms (106 seconds). A transaction held one user's lock
   for ~106s, blocking that user's other saves/tabs/retries (and the
   monkey bot's bulk fill, writeCustomPicksBulk, holds the lock across a
   sequential for-loop of writes). Long-lived transactions doing many
   sequential cross-region round-trips while holding a lock is a second,
   independent "loading forever" cause on saves.

5. Connection churn + temp-file spills (secondary). 63,448 calls to the
   postgres type-introspection query and 64,536 pgbouncer.get_auth calls
   indicate constant fresh-connection setup (serverless + small idle
   pools + prepare:false). temp_bytes ~14.5 GB since 2026-05-07 means
   some sorts/aggregations spill to disk on the small compute's work_mem.
   Both amplify the above; neither is the primary cause.

## The fix, in tiers

### Tier 1, configuration, free or near-free, do first

T1.1 Co-locate compute with the DB. vercel.json regions: ["fra1"] to
     ["dub1"]. One line, reversible, redeploys in minutes. Per-query RTT
     drops from ~25ms to ~1ms; backends free ~25ms sooner, easing
     saturation. Operator steps below.
T1.2 DONE 2026-06-16: Pool Size raised 15 to 35 on Small compute (max
     client 400, fixed). No further action; do not raise it more and do
     not buy compute. Kept here for the record because it is part of the
     fix set, but it is not the cure on its own (see root cause 2).
T1.3 In src/db/index.ts, lower postgres-js max from 10 to a small value
     (2 or 3) so many warm Vercel instances cannot collectively
     oversubscribe the pooler. With co-location each query is short, so a
     small per-instance pool is sufficient and far safer.

### Tier 2, architecture, the actual "once and for all"

T2.2 DONE: Shrank the advisory-lock critical section. writeCustomPickTx
     called getOverdraftConfig() on the GLOBAL db while holding the
     per-user advisory lock inside the transaction. Under pool pressure
     that second-connection acquisition stalls with the lock held, which
     is the 106s hold the probe found. Fixed by reading the overdraft
     config ONCE before the lock and passing it into writeCustomPickTx;
     all three callers (writeCustomPick, writeCustomPicksBulk,
     writeCustomPickAdmin) updated. The bulk path now reads it once for
     the whole batch instead of once per item. The duel open/join paths
     already hoisted the read; cancelCustomPickSelf and the match-pick
     paths make no global-db call under a lock. The balance read + guard +
     write stay inside the lock, so the double-spend guarantee is intact.

T2.1 ASSESSED, deferred with rationale (verify, do not guess). The
     original "collapse ~20 queries to <=5" goal turned out to be ~80%
     already done by the 2026-05-27 caching pass and the 2026-06-10 dedup
     pass: the global data is cached (pool, prize, leaderboard, stage,
     settings, lock-minutes, tournament-start, digest), getSettingsRow and
     getLeaderboard dedupe within a request, and getMyRankSummary reuses
     the cached leaderboard rather than recomputing. The remaining
     per-user queries (upcoming, access, bank, trend, last-final) are
     single-row or small and individually 3-5ms. The one real
     concentration, buildSmartHub (~7 queries), runs them in PARALLEL,
     each wrapped in withTimeout precisely so one slow generator cannot
     trap the card; collapsing them into one query would remove that
     resilience for negligible gain at 32 users. With Tier 1 (co-location
     cuts each query's backend-hold ~6x) plus pool size 35 (up from the
     ~15-20 at the 2026-06-10 incident) plus the T2.2 lock fix, the
     saturation is addressed from three sides. Decision: do NOT
     speculatively re-architect a working, already-optimized streaming
     dashboard. Deploy, re-run diag-db.mjs under real load (T3.1), and
     only touch SmartHub if the data shows it still saturates.

T2.3 Verify indexes on the admin/bets hot path. listCustomBets uses a
     leading-wildcard ILIKE across six columns plus a correlated subquery
     for pickCount; at 32 users this is cheap, but confirm it is not the
     consistent (vs intermittent) cause before closing.

### Tier 3, verify, do not guess

T3.1 Re-run scripts/diag-db.mjs against prod after Tier 1 to confirm the
     new pool ceiling and that numbackends headroom exists under load.
T3.2 Confirm in the Vercel dashboard that prod functions actually run in
     dub1 after deploy.
T3.3 Watch the advisory-lock max_exec_time in pg_stat_statements drop
     after T1.1 + T2.2.

## Operator steps (exact)

### Vercel: move functions to Dublin (eu-west-1)

Option A, via repo (preferred, version-controlled):
  1. Edit vercel.json: change "regions": ["fra1"] to "regions": ["dub1"].
  2. Commit and deploy. New deployments run in dub1.
Option B, via dashboard (no code change):
  1. Vercel dashboard, select the project (toto-mundial-2026).
  2. Settings, Functions (older UIs: Settings, General, Function Region).
  3. Set the Function Region to Dublin, dub1 (eu-west-1).
  4. Redeploy so the change takes effect.
Verify: Vercel deployment, Functions tab shows region dub1.

### Supabase: pooler Pool Size (already done, no action)

Project Settings, Database, Connection pooling shows Pool Size = 35 (raised
from the Small default of 15 on 2026-06-16), Max client connections = 400
(fixed for Small). This is correct and sufficient for 32 users. Leave it.
Do not raise it further and do not buy a bigger compute add-on; the cure is
co-location plus Tier 2, not more backends. The connection string uses the
shared regional pooler (aws-0-eu-west-1.pooler.supabase.com), so the
dedicated-pooler IPv4/IPv6 notice in that panel does not apply.

### Optional, heavier: move the DB to Frankfurt (eu-central-1)

Only if you also want the DB physically closer to Israeli users (Frankfurt
is closer than Dublin). Supabase has no in-place region change: you create
a NEW project in eu-central-1, migrate data via the Supabase CLI dump and
restore, then swap the env vars (DATABASE_URL, DIRECT_URL,
NEXT_PUBLIC_SUPABASE_URL, keys) on both Vercel projects and keep Vercel in
fra1. This needs a maintenance window and a careful cutover. Treat it as a
separate, later project, not part of this pass.

## Implementation result (2026-06-17)

Shipped on the sandbox branch, QA green:
- vercel.json: regions fra1 to dub1 (co-located with the eu-west-1 DB).
- src/db/index.ts: postgres-js max 10 to 3 (comment explains the
  serverless + co-location rationale).
- src/lib/bets/write-core.ts: hoisted getOverdraftConfig() out of the
  advisory-locked transaction in all three custom-pick writers (T2.2).
- Supabase pool size already at 35 (user, 2026-06-16); left as-is.

QA: vitest 650 passed / 11 skipped; the only 2 failing suites
(qa-agent/browser-tools, qa-agent/budget) are the documented pre-existing
env gaps (no local Playwright browser, missing @anthropic-ai/sdk) and are
unrelated. eslint clean on changed files. tsc shows 4 errors, all
pre-existing in scripts/qa-agent/agent-loop.mts (missing
@anthropic-ai/sdk), none in changed files.

Not done by deliberate decision: T2.1 fan-out re-architecture (see its
entry above) and the optional DB-to-Frankfurt move. T3 verification waits
on a prod deploy.

## Post-deploy verification (2026-06-17, prod live)

- Probe confirmed the change is live on prod and serving traffic (match
  bets 1514 to 1551, custom picks 1559 to 1616 between baseline and
  re-probe).
- Advisory lock: the ~49 acquisitions since the fix added ~1ms total
  (essentially instant, zero contention) vs the 106s hold in the incident
  history. Live activity showed 1 active query, no queued or lock-waiting
  backends, 0 deadlocks.
- Reset pg_stat_statements (user-approved) so go-forward numbers are
  clean; the advisory-lock row now restarts from 0. The historical 106s
  baseline is preserved in this plan and in the chat record.
- Still outstanding: a peak-load confirmation during the next match-day
  rush, which is the true stress test. Re-run diag-db.mjs then; the
  advisory-lock max should stay in single-digit ms.

## Regression and fix (2026-06-17, same day)

After 3a0c958 reached prod, the homepage (/he) started returning 504
"Task timed out after 300 seconds"; other routes (/he/bets, /he/admin/*,
crons) kept returning 200, which cleared the dub1 region change as the
cause. Root cause: max:3 was too low. The dashboard fans out ~20 queries
concurrently (Suspense sections + SmartHub generators); on a cold Data
Cache (the 5-min cron sync busts the tags) they hit the DB at once, and
postgres-js has no pool-acquisition timeout, so the surplus queries over 3
waited indefinitely and the function died at its 300s limit. Lighter pages
survived because they need fewer connections. The DB itself stayed healthy
throughout (probe: low backends, 0 deadlocks, no lock waits), confirming
the starvation was client-side in the app pool, invisible to Postgres.

Fix: revert max 3 to 10 (the long-proven value) in src/db/index.ts. Keep
co-location (dub1, confirmed good by the 200s) and the lock fix. Lesson:
do not set the per-instance pool below the dashboard's concurrent fan-out.

## Cost (rule 8)

- T1.1 co-location: free.
- T1.2 pool size: free within the current compute's max_connections.
- T1.3 postgres max: free.
- T2 architecture: engineering time only, no new spend, and it reduces
  the pressure to buy compute.
- A bigger compute add-on is the only money item, and Tier 2 is designed
  to make it unnecessary. The honest read is that part of the recent Pro
  spend may be reversible once the architecture is fixed.

## Security (rule 13)

- No new public surface, no data moved client-side. All per-user queries
  stay server-side.
- The advisory lock change only narrows the critical section; it must NOT
  weaken the bank-overdraft guard. The balance read and the stake write
  must stay inside the same locked transaction so two tabs cannot
  double-spend. Covered by write-core.test.ts; keep it green.
- Lowering postgres max does not affect authz; every query still runs
  under the same gated paths.
- Region change moves data between two AWS EU regions inside Supabase /
  Vercel; no third party gains access. GDPR posture unchanged (still EU).

## QA (rule 6)

- After T1.1: cold-load the dashboard and /admin/bets on desktop 1440 and
  mobile 360 / 414; no red error screen, content under ~1s.
- Re-run diag-db.mjs; numbackends has headroom, advisory-lock max drops.
- Save 5+ picks in a row (match + custom), two tabs at once for the same
  user; no stuck button, no double-spend, balance correct.
- Monkey bulk fill while a real user saves; user is not blocked for more
  than a beat.
- Admin payment-approve still flips only the target user.
- Cron sync still runs (it uses its own standalone client, unaffected by
  the postgres max change).

## Rejected alternatives

- Buy more compute / bigger plan. Rejected as the primary move: the data
  is tiny and the bottleneck is round-trips and a locked critical
  section, not CPU or RAM. Capacity hides the problem; it does not fix it.
- Add Redis / external cache. Rejected for friends-pool scale; Next's
  built-in cache plus fewer round-trips is enough.
- Drop the advisory lock entirely. Rejected: it is the overdraft-race
  guard. We narrow it, we do not remove it.

## Open questions / decisions for the user

1. Region: confirm Vercel to dub1 now (recommended), and whether to also
   schedule the DB-to-Frankfurt migration later.
2. Scope: ship Tier 1 immediately, then do Tier 2 as a reviewed follow-up,
   or do both in one pass.
