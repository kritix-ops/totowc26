import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tree-shake icon and SDK imports per-file instead of pulling the
  // whole module into the client bundle. Cuts ~20-30KB on the first
  // paint, especially on routes that only use 2-3 lucide icons.
  experimental: {
    optimizePackageImports: ["lucide-react", "@supabase/ssr"],
  },
  images: {
    // News thumbnails are pulled from RSS feeds whose CDN hostnames are
    // stable. Pinning here so next/image can serve them optimised, and
    // so we never accept thumbnails from arbitrary hosts.
    remotePatterns: [
      { protocol: "https", hostname: "ichef.bbci.co.uk" },
      { protocol: "https", hostname: "images.wcdn.co.il" },
      { protocol: "https", hostname: "**.yit.co.il" },
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
