import type { MetadataRoute } from "next";

// PWA manifest. Hebrew name is primary because the app is Hebrew-first; the
// English short_name is the home-screen label, which iOS / Android truncate
// aggressively, so keep it short. The cream / claret palette mirrors the
// in-app surface-container-lowest + primary tokens.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "טוטו מונדיאל 2026",
    short_name: "טוטו מונדיאל",
    description: "טוטו חברים על משחקי המונדיאל 2026",
    lang: "he",
    dir: "rtl",
    start_url: "/he",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FBF6EB",
    theme_color: "#A13217",
    categories: ["sports", "entertainment", "social"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "ההימורים שלי",
        short_name: "הימורים",
        url: "/he/bets",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "טבלת המובילים",
        short_name: "טבלה",
        url: "/he/leaderboard",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
