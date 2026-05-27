// Service worker for the טוטו מונדיאל 2026 PWA.
//
// Strategy by request kind:
//
//   1. PWA install assets (`/icons/*`, manifest) — cached at install,
//      served cache-first. They almost never change and we want the
//      install dialog to work offline.
//
//   2. Next.js build-hashed assets (`/_next/static/*`) — cache-first
//      with a runtime cache. The URLs include the build hash, so the
//      cached copy is by definition immutable for that hash. Any new
//      build emits new URLs, so we never need to revalidate. This is
//      the biggest perf win — repeat nav stops touching the network
//      for JS/CSS bundles.
//
//   3. Static images shipped from `/public` (hero PNGs, brand mark)
//      — stale-while-revalidate. We serve the cached copy instantly
//      and quietly refresh it in the background, so a re-deploy is
//      picked up on the next visit without ever showing a blank space.
//
//   4. HTML pages and API responses — pure network-first (no SW
//      caching). The app is live data; we never want stale scores
//      or stale auth state.
//
//   5. Cross-origin — straight to network. Auth tokens, flag CDN,
//      football-data API: all live, never cached here.

const VERSION = "v3";
const STATIC_CACHE = `toto-static-${VERSION}`;
const BUILD_CACHE = `toto-build-${VERSION}`;
const IMG_CACHE = `toto-img-${VERSION}`;

// Files cached at install-time. Keep this list short: the SW won't
// activate if any of these 404, and they need to be served same-origin.
const STATIC_ASSETS = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-icon-512.png",
];

// Image URL patterns served stale-while-revalidate from `/public`. We
// explicitly enumerate the hero/brand images instead of matching every
// `.png` so we never accidentally cache user-content uploads — there
// are none today but the rule is a safety net for the future.
const STATIC_IMAGE_PATTERNS = [
  /^\/hero-(he|en)\.png$/,
  /^\/icons\/.+\.(png|svg|webp)$/,
  /^\/apple-icon\.png$/,
  /^\/favicon\.ico$/,
];

function isBuildAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isStaticImage(url) {
  return STATIC_IMAGE_PATTERNS.some((re) => re.test(url.pathname));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        // Use { cache: 'reload' } so the install never serves a stale
        // icon from the HTTP cache during an SW upgrade.
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
  const KEEP = new Set([STATIC_CACHE, BUILD_CACHE, IMG_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith("toto-") && !KEEP.has(n))
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

  // Same-origin only. Cross-origin (Supabase, flag CDN, football-data)
  // goes straight to network — we never want to serve stale auth tokens
  // or stale scores.
  if (url.origin !== self.location.origin) return;

  // 1) Pre-cached install assets — cache-first.
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request)),
    );
    return;
  }

  // 2) Build-hashed assets — cache-first, populate on first hit. The
  //    hash in the URL guarantees content immutability so revalidation
  //    would be pure waste.
  if (isBuildAsset(url)) {
    event.respondWith(
      caches.open(BUILD_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  // 3) Static images — stale-while-revalidate. Serve the cached copy
  //    if we have one and quietly refresh in the background.
  if (isStaticImage(url)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        const fetchAndStore = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || fetchAndStore;
      }),
    );
    return;
  }

  // 4) Everything else (HTML, API, server actions) — network-first.
  //    On network failure, fall back to whatever the cache has so an
  //    offline tab does not 503, but normal operation never serves
  //    stale data here.
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

// ----- Push notifications (lock reminders, iteration 2) -----
//
// The server sends a JSON payload via web-push:
//   { title, body, url, tag }
// We parse it, render a system notification, and if the user taps it
// we focus an existing tab on `url` or open a new one. `tag` lets two
// reminders for the same bet collapse into one notification instead of
// stacking. See _plans/2026-05-28-lock-reminders.md §5.

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // If the payload isn't JSON, fall back to text. The server only
    // sends JSON so this branch is defensive.
    payload = { title: "טוטו מונדיאל", body: event.data ? event.data.text() : "" };
  }
  const title = typeof payload.title === "string" ? payload.title : "טוטו מונדיאל";
  const body = typeof payload.body === "string" ? payload.body : "";
  const url = typeof payload.url === "string" ? payload.url : "/he";
  const tag = typeof payload.tag === "string" ? payload.tag : undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      badge: "/icons/icon-192.png",
      icon: "/icons/icon-512.png",
      dir: "rtl",
      lang: "he",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/he";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      // If a tab on the same origin is already open, focus it and
      // navigate. Otherwise open a fresh one. This keeps the user's
      // session and avoids piling up duplicate tabs from repeat
      // notifications.
      for (const tab of tabs) {
        try {
          const tabUrl = new URL(tab.url);
          if (tabUrl.origin === self.location.origin) {
            return tab.focus().then((focused) => focused.navigate(url));
          }
        } catch {
          // Ignore tabs with invalid URLs.
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
