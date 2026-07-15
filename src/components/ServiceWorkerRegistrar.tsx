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

    // The SW calls skipWaiting + clients.claim, so a freshly deployed
    // version takes control of this already-open page mid-session. Pair
    // that with a one-time reload here: when control passes to the new SW
    // (which has just purged the stale build cache on activate), reload so
    // the tab runs the fresh app instead of the shell it booted with. The
    // `refreshing` guard prevents a reload loop; skipping the case where no
    // SW controlled the page at load avoids a needless reload on a first
    // visit (the initial claim is not an upgrade).
    let refreshing = false;
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (refreshing || !hadController) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err) => {
        console.warn("[pwa] service worker registration failed:", err);
      });

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  return null;
}
