// Minimal service worker for the טוטו מונדיאל 2026 PWA.
// Goals:
//   1. Satisfy install criteria so Chrome shows "Add to Home Screen".
//   2. Cache the app shell (icons + offline fallback) so the install screen
//      and an offline tab don't show a generic dinosaur.
//   3. NEVER cache HTML pages or API responses — this app is live data
//      (real-time scores, bet status). Stale UI would be worse than a
//      network error.

const VERSION = "v1";
const STATIC_CACHE = `toto-static-${VERSION}`;

// Files cached at install-time. Keep this list short: the SW won't activate
// if any of these 404, and they need to be served same-origin.
const STATIC_ASSETS = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        // Use { cache: 'reload' } so the install never serves a stale icon
        // from the HTTP cache during an SW upgrade.
        Promise.all(
          STATIC_ASSETS.map((url) =>
            cache.add(new Request(url, { cache: "reload" })),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith("toto-") && n !== STATIC_CACHE)
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin only. Cross-origin (Supabase, flag CDN, football-data) goes
  // straight to network — we never want to serve stale auth tokens or stale
  // scores.
  if (url.origin !== self.location.origin) return;

  // Cache-first for static assets we precached.
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request)),
    );
    return;
  }

  // Network-first for everything else. On failure, fall back to whatever the
  // cache has (rarely useful here since we don't precache HTML, but it
  // covers the case where the user revisits a page they previously loaded
  // and we have it via the runtime cache below).
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return new Response("Offline", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }),
    ),
  );
});
