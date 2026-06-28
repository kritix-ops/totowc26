# Incident: production hang — leaked pooler backends (active/ClientRead)

Date: 2026-06-12 (~13:20–13:45 UTC, first match-day traffic)
Status: Mitigated live + durable server-side guard applied
Reporter: user ("sandbox loads fine, production never loads, endless refreshes")

## Symptom

Production (`toto-mundial-2026`) intermittently hangs: some requests 200 in
<1s, others sit 30s+ and time out. Sandbox (same code, own Supabase, no real
traffic) is fine. Vercel deploys all Ready, static shell serves normally.

## Root cause (verified against the live DB)

Follow-on failure mode to `2026-06-10-db-pool-saturation-fix.md`. That fix
added `statement_timeout: 15000` app-side, but today's stuck backends were
NOT executing statements:

- `pg_stat_activity` showed backends `state='active'`,
  `wait_event='ClientRead'`, open transaction, runtime up to **9 minutes**
  (queries: bank-balance sum, matches select).
- `ClientRead` + open xact = the backend finished/paused mid extended-protocol
  and is waiting for the next client message. The client (a Vercel function)
  was killed mid-query — by maxDuration or user refresh-abort — and Supavisor
  left the server connection checked out forever.
- No statement runs in that state, so neither the app's 15s nor the server's
  120s `statement_timeout` can fire. The slot is pinned until terminated.
- Pool math: `max_connections=60`, Supavisor transaction-pool ~15-20 slots,
  `query_wait_timeout=80s`. A few pinned slots + match-day concurrency →
  new queries queue at the pooler → renders slow → more functions killed →
  more leaked slots. Endless user refreshes amplify the leak (each abandoned
  request can kill a function mid-query). Death spiral; sandbox immune
  because it has no traffic.

## Mitigation (live, immediate)

`pg_terminate_backend()` on all backends stuck >90s in active/ClientRead.
Site recovered instantly (all pages 200 in <1s). Script kept at
`scripts/one-off/kill-stuck-backends-2026-06-12.mjs`.

## Durable fix (applied)

PG 17.6 supports `transaction_timeout` (kills a transaction by total age,
regardless of state — exactly this leak). Applied role-level:

    alter role postgres set transaction_timeout = '120s';

- 120s matches the server's existing `statement_timeout`, so no legit app
  work is affected (app queries are <1.5s).
- Recycled idle pooled backends so Supavisor re-logins picked it up
  immediately (`scripts/one-off/recycle-and-verify-2026-06-12.mjs`
  confirmed `show transaction_timeout` = `2min` on a fresh pooled conn).
- From now on a leaked backend frees its slot within 2 minutes — the spiral
  can't build.

**Caveat for future ops**: any manual migration whose single transaction
needs >120s must `SET transaction_timeout = 0` for that session first.

## Verification

- Before: `/he/login` timed out 30s+ (2 of 5 tries). After: `/he/login`,
  `/he`, `/he/bets/live/2026-06-12`, `/he/leaderboard`, `/he/duels` all
  200 in 250–710ms.
- `pg_stat_activity` clean: no active/ClientRead backends >60s.

## Open follow-ups (deferred, flag before next peak)

1. **Sandbox parity**: apply the same `alter role` on the sandbox DB so the
   environments don't drift (zero urgency — no traffic there).
2. **Compute/pool headroom** (deferred item C from 06-10): one match-day of
   light traffic produced enough concurrency to queue the pooler. Bigger
   Supabase compute or larger pool size costs money — decide before the
   knockout rounds when everyone is online at once.
3. **`maxDuration` on user-facing pages**: only cron routes set it (60s).
   Consider an explicit value on the dashboard route so slow renders are
   killed predictably (with the txn-timeout reaper, severity is now low).
4. **Diagnostics kept**: `scripts/one-off/check-prod-db-2026-06-12.mjs`
   (conn states, long-running, old xacts) and
   `scripts/one-off/check-pg-timeouts-2026-06-12.mjs` (GUC audit) for the
   next time prod feels slow.
