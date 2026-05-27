import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    remotePatterns: [
      { protocol: "https", hostname: "ichef.bbci.co.uk" },
      { protocol: "https", hostname: "images.wcdn.co.il" },
      { protocol: "https", hostname: "**.yit.co.il" },
      { protocol: "https", hostname: "media.api-sports.io" },
    ],
  },
  async headers() {
    return [
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
