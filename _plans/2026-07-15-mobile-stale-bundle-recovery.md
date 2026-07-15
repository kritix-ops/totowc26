# Mobile "loads forever" + bets not saving: stale-bundle recovery

Date: 2026-07-15
Status: implemented, pending production confirmation

## Symptom

Players on mobile report the entry screen "loads forever" and never becomes
interactive. Earlier, players reported that placed bets were not saved.
Desktop is unaffected.

## Diagnosis (high confidence, not yet field-confirmed)

Both symptoms are one failure: the client React tree is not hydrating on the
affected mobile clients.

- The `SplashOverlay` is server-rendered as a full-screen opaque poster at
  `z-[200]` with `pointer-events: auto`. It only fades out from its own
  `useEffect`. No hydration means it never lifts, which is the "loads
  forever, can't tap" symptom.
- Auto-save (`useAutosave`, shipped 2026-06-17) is client JS. No hydration
  means edits never persist, which is the "bets not saved" symptom.

Most likely trigger: a returning mobile client (installed PWA or a tab whose
service worker cached an older build) is handed HTML that references
`/_next/static` JS chunks the current deploy has already deleted. Every deploy
rotates all chunk hashes, even the July admin-only deploys. One 404 on a chunk
aborts hydration of the whole root. Desktop looks fine because it fetched the
fresh deploy cleanly.

The definitive confirmation is the 30-second test: open the broken site in a
private/incognito tab on the same phone. Works there but not in the normal
tab/installed app confirms stale cache.

## Approach (chosen)

Three layers, smallest blast radius first:

1. `public/sw.js`: bump `VERSION` v3 -> v4. `activate` deletes every
   `toto-*` cache not matching the current version, so already-stranded
   clients get a clean slate the next time the browser revalidates `sw.js`
   (served `no-store`, so that happens on the next load).

2. `src/components/ChunkRecoveryScript.tsx`: a `beforeInteractive` inline
   script (hoisted to `<head>`, runs before any first-party module) that
   listens for a failed JS-chunk load and for dynamic-import failures, and
   reloads once. This runs even when hydration later dies, which a React
   effect cannot. A 10s sessionStorage time-guard prevents reload loops.
   Narrowed to `<script>` failures only: a missing stylesheet or font does
   not break hydration, so those never trigger a reload.

3. `src/components/ServiceWorkerRegistrar.tsx`: reload once on
   `controllerchange`, completing the `skipWaiting` + `clients.claim`
   pattern the SW already uses, so an open tab that a new SW takes over
   refreshes onto fresh assets instead of running a shell paired with a
   newer SW. Guarded against loops and against the first-visit claim.

## Alternatives rejected

- Drop the custom service worker entirely. Overkill; the SW is a real perf
  win and is correctly network-first for HTML/API. The failure is stale
  build chunks, not the SW strategy.
- Make build assets network-first. Loses the cache-first win on genuinely
  immutable hashed URLs; the chunk-recovery reload covers the stale case.
- A CSS-only splash auto-dismiss (fail-safe against any hydration death, not
  just chunk 404s). Deferred: it fights the existing JS-driven inline
  opacity/transition on the same element and only helps a different,
  unconfirmed failure mode. Revisit if the private-tab test shows a non-chunk
  JS error.

## Security / safety

- No new data paths, no new secrets, no logging changes.
- The inline recovery script depends on CSP staying unset (see
  next.config.ts). When the CSP hardening pass lands, this script needs a
  nonce or a hashed-source allowance. Noted in the component.
- Reload guard is bounded (10s), so a genuinely broken deploy degrades to a
  single reload rather than an infinite loop.

## Open questions

- Confirm the private-tab test result before considering this closed.
- If bets still fail to save with a healthy client, check the `write-core.ts`
  change and migration `0072` from the 2026-07-05 commit on the server side
  (separate from this hydration fix).
```
