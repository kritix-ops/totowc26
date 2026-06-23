# Live-bet day page — 504 timeout under matchday load

Date: 2026-06-17
Status: implemented (sandbox)

## Trigger

Vercel anomaly alert (medium severity): `504 Gateway Timeouts on live
bets route` — `/[lang]/bets/live/[date]`, path `/he/bets/live/2026-06-18`,
12 failed requests at 22:45 Israel time, `FUNCTION_INVOCATION_TIMEOUT`
(`Vercel Runtime Timeout Error: Task timed out after 300 seconds`). Both
GET (render) and POST (bet-placement Server Actions) failed. External API
panel showed cache hits (26/41ms) — not an upstream dependency. Resolved
on its own ~40 min later.

## Root cause

Not a logic bug. Connection/CPU saturation on the hot live surface during
a prime-time matchday burst:

- `statement_timeout` is 15s at runtime (`src/db/index.ts`), so a single
  query cannot run 300s — it is cancelled and the page's `try/catch`
  returns a safe default. The 300s is therefore a wait to *acquire* a
  connection/backend, which no `statement_timeout` bounds.
- The day page was the heaviest uncached surface: ~7 sequential round
  trips per render, including two separate reads of the same `settings`
  row (`getLiveStakeConfig` + `getOverdraftConfig`) and an uncached
  6-subquery bank recompute (`getBankBalance`).
- Supabase is a **Small** compute instance (2 vCPU / 2GB), pooler size
  35. Under a betting burst the per-request DB demand across Vercel Fluid
  instances exceeds the pool / saturates the 2 cores; requests queue
  waiting for a backend and sit until the 300s function ceiling → 504.

The date `2026-06-18` was incidental — it is the next matchday everyone
loaded/bet on at once, not bad data on that date.

Confidence: high that this is saturation, not a bug; medium on the exact
queue mechanism (full proof needs `pg_stat_activity` / Supavisor metrics
from the incident window). Consistent with the prior pooler-backend-leak
work (`_plans/2026-06-12-prod-hang-leaked-pooler-backends.md`).

## Goal

Cut the per-request DB cost of the hot page and stop a stalled request
from squatting a function slot + connections for 5 minutes, without
changing any bet/balance semantics or spending money.

## Constraints

- No cross-request caching of admin-editable pricing knobs (live-odds /
  overdraft) without guaranteed invalidation — staleness on those would
  misprice the bet card. Per-request memo only.
- Bet placement must keep re-checking the live balance inside its own
  transaction (user bets are sacred — display caching must not affect the
  authoritative guard).
- Code-only; no Supabase compute upgrade (held as the paid fallback).

## Chosen approach (Layer 1 + Layer 2)

1. **Collapse the two settings reads → one per-request pooler checkout.**
   New `loadSettingsConfigRow` wraps a single `select` of both the
   overdraft and live-stake columns in React `cache()` (the same
   `getSettingsRow` pattern in `db/queries.ts`). `getOverdraftConfig` and
   `getLiveStakeConfig` now derive from it via pure, unit-tested mappers
   (`overdraftConfigFromRow`, `liveStakeConfigFromRow`). Per-request only
   → an admin settings edit still shows on the very next render.

2. **Read the bank from the cross-request Data Cache.** The page now uses
   `getBankBreakdown(userId).balance` (cached, tag `bankCacheTag`, busted
   by every bet/duel mutation) instead of the uncached `getBankBalance`.
   Algebraically identical value; the number is advisory for the board's
   display + negative-lock, and placement re-checks the live balance in
   its own txn.

3. **`export const maxDuration = 60` on the page.** Caps both the render
   and every Server Action invoked from it (verified in the Next 16
   route-segment-config docs). A stalled request fails fast at 60s and
   frees its slot + connections instead of 504-ing at 300s. 60s leaves
   headroom over the heaviest legit action (a full-matchday "Surprise me"
   bulk fill).

Net warm-render DB cost: ~7 round trips → ~4 (the irreducible
`getPlayDayDetail` 3 queries + one settings read; access + bank are cache
hits).

## Alternatives rejected

- **Cross-request cache the settings configs** (like `getBetLockMinutes`):
  faster, but risks serving stale live-odds/overdraft after an admin edit
  unless every settings-write path is proven to invalidate. Per-request
  memo gives most of the benefit with zero staleness risk.
- **Upgrade Supabase Small → Medium** (~$50/mo net): real fix for
  capacity but recurring cost; correct only if the code fixes do not hold
  through the knockout-stage peak. Kept as the documented fallback.
- **Raise the pooler size above 35**: more backends on 2 cores worsens
  context-switching. Not without a compute upgrade.

## Security / safety

No new surface. No data exposed. The balance shown can be up to 120s
stale on display, but the authoritative overdraft/negative-lock guard
still runs fresh inside the placement transaction, so caching cannot let
a user overspend.

## Observability

Error logs on every dependency kept; the bank catch was renamed to
`[bets/live/date] getBankBreakdown threw`. A recurrence now surfaces as a
fast 60s `FUNCTION_INVOCATION_TIMEOUT` rather than a 5-minute hang, which
is itself the signal to escalate to the compute upgrade.

## Testing

- `overdraftConfigFromRow` / `liveStakeConfigFromRow`: present-row
  mapping, missing-row defaults (migrations 0050 / 0047), and no column
  bleed between the two configs. Added to `src/lib/bank.test.ts`.
- Full suite: 647/647 pass. `tsc --noEmit` clean, eslint clean.
- The DB round trip + `cache()` memoization are out of unit scope (the
  test db-stub throws on access); exercised in integration.

## Follow-up if it recurs

Watch the live route for 60s timeouts during knockout matchdays. If they
return, bump Supabase compute Small → Medium from the dashboard (~$50/mo
net) for the high-traffic window.
