"use client";

import { useEffect, useState } from "react";

// Full-screen poster shown during the first paint of a cold load. Server-
// rendered so it lands on screen alongside the initial HTML - on Android,
// where the OS splash can't be customised, this covers the gap between
// the OS splash dismissing and the app becoming interactive. On iOS,
// `apple-touch-startup-image` (configured in the root layout) already
// presents the same poster as the OS splash, so this layer is just a
// cohesive handoff.
//
// Lifecycle: shown → fading → removed. We wait for `window.load` (full
// page + assets) before starting the fade, but cap the wait at 1.5s so a
// slow asset never strands the user behind the overlay. Once removed, the
// node is unmounted entirely, so it can't intercept taps or layout.

type Stage = "shown" | "fading" | "removed";

const FADE_DURATION_MS = 400;
const MAX_WAIT_MS = 1500;

export function SplashOverlay({ locale }: { locale: "he" | "en" }) {
  const [stage, setStage] = useState<Stage>("shown");

  useEffect(() => {
    let fadeTimer: number | undefined;
    let removeTimer: number | undefined;
    let safetyTimer: number | undefined;
    let loadListenerAttached = false;

    function beginFade() {
      console.info("[splash overlay] begin fade", { stage: "fading" });
      setStage("fading");
      removeTimer = window.setTimeout(() => {
        console.info("[splash overlay] removed");
        setStage("removed");
      }, FADE_DURATION_MS);
    }

    function onLoad() {
      // Defer one frame so the new page paints under the overlay before we
      // start fading - avoids a flash of "empty app" between overlay and
      // content.
      fadeTimer = window.requestAnimationFrame(() => {
        fadeTimer = window.setTimeout(beginFade, 50);
      });
    }

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      loadListenerAttached = true;
      // Safety net: if `load` is delayed (slow image, broken script, etc.)
      // the user must not be trapped behind the overlay.
      safetyTimer = window.setTimeout(() => {
        console.info("[splash overlay] safety timeout fired", { ms: MAX_WAIT_MS });
        beginFade();
      }, MAX_WAIT_MS);
    }

    return () => {
      if (loadListenerAttached) window.removeEventListener("load", onLoad);
      if (typeof fadeTimer === "number") {
        window.clearTimeout(fadeTimer);
        window.cancelAnimationFrame(fadeTimer);
      }
      if (removeTimer) window.clearTimeout(removeTimer);
      if (safetyTimer) window.clearTimeout(safetyTimer);
    };
  }, []);

  if (stage === "removed") return null;

  const src = `/splash/overlay-${locale}.png`;

  return (
    <div
      role="presentation"
      aria-hidden
      className="fixed inset-0 z-[200] flex items-center justify-center transition-opacity"
      style={{
        backgroundColor: "#FBF6EB",
        opacity: stage === "fading" ? 0 : 1,
        transitionDuration: `${FADE_DURATION_MS}ms`,
        pointerEvents: stage === "fading" ? "none" : "auto",
      }}
    >
      {/* Use a plain img so the asset starts loading with the first HTML
          chunk and the browser doesn't wait on Next/Image's optimisation
          pipeline. `object-contain` keeps the full poster - including the
          brand strip - visible inside any viewport (tall phones letterbox
          with cream above/below, tablets letterbox on the sides). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        decoding="async"
        fetchPriority="high"
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}
