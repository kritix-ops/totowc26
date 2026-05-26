"use client";

import { useEffect } from "react";

// Mount this near the root of the tree exactly once. It registers the PWA
// service worker on supported browsers. Failures are logged but never thrown
// - a broken SW must never break the page.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Dev-only: skip during local dev so HMR isn't trapped behind a cached
    // SW. Production builds get the SW so install-to-home-screen works.
    if (process.env.NODE_ENV !== "production") return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err) => {
        console.warn("[pwa] service worker registration failed:", err);
      });
  }, []);

  return null;
}
