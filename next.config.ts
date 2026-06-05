import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The /api/cron/backup route reads the migration SQL files at runtime
  // and ships them inside the daily backup commit as `schema.snapshot.sql`.
  // Next.js's static tracer can't follow the dynamic readdir + readFile
  // calls, so we explicitly include the folder here. Narrow pattern to
  // avoid bloating other routes' traces.
  outputFileTracingIncludes: {
    "/api/cron/backup": ["src/db/migrations/**/*.sql"],
  },
  experimental: {
    // Tree-shake icon and SDK imports per-file instead of pulling the
    // whole module into the client bundle. Cuts ~20-30KB on the first
    // paint, especially on routes that only use 2-3 lucide icons.
    optimizePackageImports: ["lucide-react", "@supabase/ssr"],
    // Client-cache TTLs for prefetched page segments. Default `dynamic`
    // is 0 (no client cache) in Next.js 15+, which means every nav to a
    // signed-in page goes back to the server even if the user clicked
    // back-and-forth within seconds. 30s is the sweet spot: the bank
    // pill / leaderboard staleness window is tolerable for a friends
    // pool, and the perceived speed-up on back-nav + tab-flipping is
    // huge. `static` 300s keeps the older default for explicitly
    // prefetched (prefetch={true}) routes.
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
    // Our only root layout is at app/[lang]/layout.tsx (a dynamic
    // segment). When a URL doesn't match ANY route - e.g. /foo or
    // /he/this-route-does-not-exist - there is no layout to compose
    // a 404 from, so Next.js falls back to its bare default. The
    // experimental global-not-found flag lets us ship a branded
    // global-not-found.tsx that includes its own <html>/<body> shell.
    globalNotFound: true,
  },
  images: {
    // News thumbnails are pulled from RSS feeds whose CDN hostnames are
    // stable. Pinning here so next/image can serve them optimised, and
    // so we never accept thumbnails from arbitrary hosts.
    //
    // Player photos come from API-Football's media CDN (media.api-
    // sports.io). Hot-linked via next/image rather than mirrored to
    // Supabase Storage — see _plans/2026-05-27-hebrew-tournament-bets-
    // and-translations.md §8.3. If API-Sports ever blocks hot-linking
    // we revisit and add a sync-to-Storage step in the squads script.
    //
    // Country flags come from the HatScripts/circle-flags set on
    // jsDelivr (SVG vectors, no per-size variants needed). Used by
    // <Flag> for every team chip across the app.
    remotePatterns: [
      { protocol: "https", hostname: "ichef.bbci.co.uk" },
      { protocol: "https", hostname: "images.wcdn.co.il" },
      { protocol: "https", hostname: "**.yit.co.il" },
      { protocol: "https", hostname: "media.api-sports.io" },
      { protocol: "https", hostname: "cdn.jsdelivr.net" },
    ],
  },
  async headers() {
    return [
      {
        // Baseline security headers applied to every response. CSP is
        // deliberately not set here: a tight policy needs a full
        // inventory of Supabase/Resend/inline-script origins and lands
        // in its own pass. See _plans/2026-05-28-security-hardening.md.
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
      {
        // The service worker file must never be cached by the browser —
        // otherwise an upgraded SW won't pick up until the old cache
        // entry expires.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      {
        // PWA manifest. Cache aggressively but allow revalidation.
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Content-Type",
            value: "application/manifest+json; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "public, max-age=300, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
