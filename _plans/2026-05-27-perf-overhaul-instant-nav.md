# Performance overhaul: instant navigation, streaming, caching

Date: 2026-05-27
Status: Approved (user picked "חבילה C" — the full overhaul)
Scope: A + B + PWA snappy

## Goal

Make every click feel instant on both mobile and desktop. The user
reported that every link/action feels slow and "not smooth". This is
the highest-priority UX concern for a friends pool app that lives on
phones at bars and couches.

Target: navigation shell paints in <100ms. Per-user data streams in
under 300ms behind a skeleton, with no layout shift. Animation/touch
feedback feels "tap-immediate" (≤80ms).

## Root causes found in audit

1. **AppShell is a Server Component that blocks every navigation on
   4-5 DB queries** (`src/components/AppShell.tsx:39-67`):
   - `getUser()` (Supabase auth)
   - `getMyRankSummary(user.id)`
   - `getUserAccess(user.id)` (1-2 sub-queries)
   - `getBankBreakdown(user.id)` (complex SQL)
   - Profile lookup
   Every navigation in Next.js re-renders the layout chain, so nothing
   paints until ALL of these resolve.

2. **`proxy.ts` calls `supabase.auth.getUser()` on every request**
   (`src/proxy.ts:104`) — and then AppShell calls it AGAIN
   (`getUser()` is React-cached per request, but `proxy` is a
   separate boundary). That's 2 Supabase auth roundtrips per nav.

3. **Home page runs 11 DB queries on every visit**
   (`src/app/[lang]/page.tsx:68-78` + `loadDashboard:146-153`).

4. **No `loading.tsx` files anywhere**, no `Suspense` usage anywhere
   (`grep` confirms 0 hits). So even partial prefetching cannot show
   a skeleton — the user stares at the old page.

5. **No `prefetch` hint anywhere** (`grep` confirms 0 hits). Default
   Next.js prefetch is viewport-only and may not fire on mobile.

6. **4 Google Fonts loaded synchronously** in
   `src/app/[lang]/layout.tsx`: Heebo, Space Grotesk, Assistant, Inter.
   ~80KB+ of font CSS+WOFF2 per page.

7. **`revalidatePath("/", "layout")` is used in 20+ server actions**
   (admin/payment/duels/onboarding/play/users/etc.). This nukes the
   entire layout cache on every mutation — every user's bank pill,
   leaderboard widget, everything. Defeats any caching.

8. **`transition-colors` / no specific properties** in interactive
   elements. Combined with re-layout on every nav, taps feel mushy.

## Plan (5 phases, sequential)

### Phase 1 — Streaming AppShell (BIGGEST WIN)

The shell paints instantly. User-specific data streams behind
`<Suspense>` fallbacks. This is what makes the app feel snappy on
EVERY click, not just specific pages.

Files:
- `src/components/AppShell.tsx` — split into `AppShell` (static
  shell, no awaits) + child Server Components for user data sections,
  each wrapped in `<Suspense>` with a skeleton fallback.
- New: `src/components/HeaderUserSection.tsx` — Bank pill + rank
  pill + profile menu. Server Component that awaits the user/access
  queries. Wrapped in Suspense at the parent.
- New: `src/components/HeaderUserSkeleton.tsx` — static skeleton
  matching the size of the real content (no layout shift).
- New: `src/components/NavSection.tsx` — desktop + mobile nav.
  Doesn't need user data; just signed-in flag. Stays in the static
  shell.

Note: signed-in vs signed-out branching is needed for the static
shell (different nav layout). Use the `cookies()` of `sb-*` to gate
client-side, or pass a `signedIn` boolean computed cheaply from the
proxy (which already has `getUser()`). To avoid double Supabase
roundtrip, set a custom header `x-toto-user-id` in the proxy and
read it via `headers()` in AppShell. That keeps the shell paint
cheap (no DB call needed).

### Phase 2 — `loading.tsx` everywhere

Every route that does data fetching gets a `loading.tsx`. This
unlocks partial prefetching — Next.js can prefetch the skeleton
ahead of the click. Combined with Phase 1, nav becomes literally
instant.

Files (add):
- `src/app/[lang]/loading.tsx` (home — most important)
- `src/app/[lang]/bets/loading.tsx`
- `src/app/[lang]/play/loading.tsx`
- `src/app/[lang]/play/[date]/loading.tsx`
- `src/app/[lang]/duels/loading.tsx`
- `src/app/[lang]/leaderboard/loading.tsx`
- `src/app/[lang]/tournament/loading.tsx`
- `src/app/[lang]/live/loading.tsx`
- `src/app/[lang]/me/loading.tsx`
- `src/app/[lang]/profile/loading.tsx`
- `src/app/[lang]/admin/loading.tsx`
- `src/app/[lang]/admin/*/loading.tsx` (each admin subroute)
- `src/app/[lang]/rules/loading.tsx`
- `src/app/[lang]/transparency/loading.tsx`
- `src/app/[lang]/teams/loading.tsx`
- `src/app/[lang]/standings/loading.tsx`
- `src/app/[lang]/club/loading.tsx`
- `src/app/[lang]/login/loading.tsx`
- `src/app/[lang]/signup/loading.tsx`
- `src/app/[lang]/onboarding/loading.tsx`
- `src/app/[lang]/pay/loading.tsx`
- `src/app/[lang]/set-password/loading.tsx`
- `src/app/[lang]/match/[id]/loading.tsx`

Each one is a static skeleton matching the page's heading area + a
shimmering card-grid placeholder. No JS, no client component, no
data.

### Phase 3 — Page-level streaming

The pages themselves use `<Suspense>` for heavy sections.

Files:
- `src/app/[lang]/page.tsx` — split `loadDashboard()` into 5
  independent Suspense boundaries (upcoming, last-final, rank,
  trend, leaderboard). Today they all sit behind one `Promise.all`
  but render in totally different cards; streaming each makes the
  page feel "always something visible".
- `src/app/[lang]/leaderboard/page.tsx` — same treatment for the
  table.
- `src/app/[lang]/bets/page.tsx` — date sections in their own
  Suspense.
- `src/app/[lang]/play/[date]/page.tsx` — match cards in own
  Suspense.

### Phase 4 — Caching layer (`use cache` + tags)

Today every page re-runs every query. Cache the slow-changing data
with `use cache` + `cacheTag`, then invalidate with `revalidateTag`
on the specific mutations. Stops `revalidatePath("/", "layout")`
from nuking everything.

Files:
- `src/db/queries.ts` — convert these to cached functions:
  - `getPoolStats` → tag `pool-stats` — invalidated by
    payment.approve, payment.reject, user.delete.
  - `getTournamentStart` → tag `settings` — invalidated by admin
    settings update.
  - `getPrizeBreakdown` → tag `pool-stats` (depends on participants
    + payments).
  - `getLeaderboard` → tag `leaderboard` + per-user tag — invalidated
    by score-matches, point-adjustments, custom-bet-settle.
- `src/lib/bank.ts` — `getBankBreakdown(userId)` → `use cache` with
  tag `bank:${userId}`. Invalidated when this user's
  bets/duels/custom-bets/adjustments change.
- `src/lib/access.ts` — `getUserAccess(userId)` → `use cache` with
  tag `access:${userId}`. Invalidated on payment.approve and
  profile.role-change.
- All `revalidatePath("/", "layout")` calls in
  `src/app/[lang]/**/actions.ts` replaced with specific
  `revalidateTag(...)` calls. Inventory:
  - `admin/payment-actions.ts` → `payments`, `pool-stats`,
    `access:${userId}`, `bank:${userId}`.
  - `admin/bets/actions.ts` → already uses `revalidatePath` for
    bets/play/leaderboard; switch to `revalidateTag("leaderboard")`
    + per-match tag.
  - `play/[date]/actions.ts` → bet placement → tag
    `bank:${userId}` + `leaderboard`.
  - `duels/actions.ts` → tag `bank:${userId}` + `bank:${other}` +
    `leaderboard`.
  - `bets/[matchId]/actions.ts` → tag `bank:${userId}` +
    `leaderboard`.
  - `onboarding/actions.ts` → tag `access:${userId}` +
    `profile:${userId}`.
  - `admin/view-as-actions.ts` → tag `access:${adminId}`.
  - `admin/users/actions.ts` → per-affected-user tags.
  - `admin/sync-actions.ts` → tag `fixtures` + `leaderboard`.
  - `admin/paybox-actions.ts` → tag `settings`.
  - `admin/signup-settings-actions.ts` → tag `settings`.
  - `admin/signup-requests/actions.ts` → tag `signup-requests`.
  - `admin/settings/scoring/actions.ts` → tag `settings` +
    `leaderboard` (scoring changes affect points).
  - `admin/live-bets/suggestions/actions.ts` → narrower than today.

### Phase 5 — Bundle, fonts, animation polish

1. **Fonts** — drop `Inter` (use `Space_Grotesk` for English labels;
   it already loads). Move `Assistant` to `display: optional` and
   subset only needed weights. Net: -1 font, ~25-30KB saved.
2. **Icons** — `lucide-react@1.16.0` is small per-import but ensure
   we tree-shake. Already imported individually, that's fine. Add
   `optimizePackageImports: ["lucide-react"]` to `next.config.ts`.
3. **Lazy-load** `MobileMoreSheet` (only the sheet itself; the
   trigger stays in the nav).
4. **CSS** — replace `transition-colors` / `transition-all` with
   explicit `transition-[background-color,color] duration-150`. Add
   `will-change: transform` on `.press-down` class. Use
   `touch-action: manipulation` on interactive elements (drops the
   300ms iOS tap delay; already partial on Safari but still applies
   here).
5. **`useLinkStatus` hook** — a thin `<NavLoadingHint />` client
   component used inside each NavLink that pulses an underline while
   nav is pending. Gives instant tap feedback.
6. **View Transitions API** — add a tiny client-only enhancement
   that calls `document.startViewTransition()` around navigation.
   Browser-only, no library, no-op on Safari (Safari Tech Preview
   has it; older versions just navigate as before).
7. **Service Worker** — already registered. Extend it to
   stale-while-revalidate static `/icons/*`, `/hero-*.png`, and font
   files. Don't touch API/page responses (Next handles those).
8. **`unstable_instant`** — export `unstable_instant = { prefetch:
   'static' }` from `[lang]/page.tsx`, `[lang]/bets/page.tsx`,
   `[lang]/leaderboard/page.tsx`, `[lang]/play/page.tsx` once
   `cacheComponents` is on. This validates at build time that those
   pages have correct Suspense placement. (Optional; only enable
   `cacheComponents: true` in `next.config.ts` if Phase 4 caching
   covers all uncached awaits — we'll evaluate after Phase 4.)
9. **`optimizePackageImports`** — add `lucide-react`,
   `@supabase/ssr` to `next.config.ts`.

## Security plan (rule 13)

- No data is moved client-side. All per-user queries stay
  server-side; we just stream them via Suspense.
- The `x-toto-user-id` header trick: only used as an OPTIONAL
  optimization for the AppShell's "signed in or not" branch. NOT
  used for authorization. Every authenticated query still calls
  `getUser()` server-side. If the header is missing or forged, the
  worst case is a flash of the wrong nav layout — DB queries are
  still gated on the real Supabase session.
- Cache keys for per-user data always include the userId. The Next.js
  cache is server-side, so no cross-user data leak risk from the
  cache itself.
- The `revalidateTag` calls are checked: every mutation that affects
  a user's data invalidates the user-scoped tag, so a malicious
  client cannot get stale data after their own action.
- No new external dependencies introduced.
- No new public surfaces opened (no new Route Handlers).

## Observability plan (rule 14)

Every step of the new flow logs to console with bracketed namespace:
- `[shell render]` already exists; extend with `cachedStatus`,
  `streamingSections`, and TTFB markers.
- `[suspense:HeaderUserSection]` — log start/end with duration.
- `[suspense:Leaderboard]`, `[suspense:Upcoming]`, etc.
- `[cache hit pool-stats]` / `[cache miss pool-stats]` after
  `getPoolStats`.
- `[revalidate tag=...]` from each action.
- `[nav prefetch] route=... type=static|dynamic`.
- `[sw cache] url=... hit=true|false`.

Logs use `console.info` to stay visible in production with
`NEXT_PUBLIC_VERBOSE_LOGS=1` and silenced otherwise via a tiny
wrapper.

## Settings audit (rule 15)

No new user settings are introduced. The perf changes are global
and not opt-in. Existing settings unaffected.

## Rejected alternatives

- **Switch entirely to a SPA / client-rendered model.** Rejected:
  it would re-introduce auth roundtrips per nav, double-bundle
  React, and lose SEO on the public pages.
- **Add Redis cache layer.** Rejected for now: Next.js' built-in
  cache (memory + ISR) is enough for friends-pool scale and we
  don't want a new ops dep.
- **Replace Supabase auth with our own JWT cookie.** Rejected: not
  the problem; we just need to dedupe the proxy/layout calls.

## QA checklist (rule 6)

Before declaring done, walk through every flow on:
- desktop 1440px in Chrome
- mobile 360px in DevTools mobile mode (Safari iOS UA)
- mobile 414px

For each:
- Cold load: TTFB → first paint of shell ≤100ms? (dev only — prod
  is faster.)
- Click nav: shell stays, only the page area shows skeleton then
  content? No full-page blink?
- Tap interactive element: visual press-down feedback ≤80ms?
- After signing in: header user section appears as a streamed
  fallback, then real data swaps in?
- After placing a bet: only the bank pill + leaderboard refresh,
  not the whole layout?
- After admin payment-approve: target user's access flips, others
  unaffected?
- Form input on iOS-sized viewport: no zoom on focus?

## Open questions

None — proceeding.
