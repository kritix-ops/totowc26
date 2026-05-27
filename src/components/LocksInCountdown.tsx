"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Lock, Clock } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";

// Live "נסגר בעוד ..." countdown for any bet that has an effective lock
// time. Renders nothing when the lock is more than 24 hours away (the
// page already shows the absolute lock time as a chip — no need for a
// big ticking widget in that case). Inside 24 h, ticks per second; under
// 60 seconds, switches to red. Past the lock, shows a "נעול" badge.
//
// Server is the source of truth — we compute the effective lock at
// render time and pass it down. The client only counts down; it doesn't
// re-resolve. See _plans/2026-05-27-betting-deadlines.md §9.

type Props = {
  locale: Locale;
  // Server-resolved effective lock time (ISO string keeps server-client
  // payloads stable across hydration).
  lockAt: string;
  // Visual variant: full pill (default) or compact inline (smaller, no
  // background) for tight UIs like the bet card header.
  variant?: "pill" | "inline";
  className?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export function LocksInCountdown({
  locale,
  lockAt,
  variant = "pill",
  className,
}: Props) {
  const isHebrew = locale === "he";
  // Reduced-motion users tick once per minute (less flicker) but still
  // see the countdown — this is informational, not decorative.
  const reducedMotion = useReducedMotion();
  const tickMs = reducedMotion ? MINUTE_MS : 1000;
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);

  const lockMs = new Date(lockAt).getTime();
  if (!Number.isFinite(lockMs)) return null;

  const remaining = lockMs - now;
  const passed = remaining <= 0;

  if (passed) {
    return (
      <span
        className={clsx(
          variantClass(variant, "locked"),
          className,
        )}
        aria-label={isHebrew ? "ההימור נעול" : "Bet locked"}
      >
        <Lock className="h-3 w-3" strokeWidth={2.5} aria-hidden />
        <span>{isHebrew ? "נעול" : "Locked"}</span>
      </span>
    );
  }

  // Beyond 24 h, the absolute lock chip on the card is more useful.
  if (remaining > DAY_MS) return null;

  const urgent = remaining <= 60_000;
  const label = formatRemaining(remaining);
  return (
    <span
      className={clsx(
        variantClass(variant, urgent ? "urgent" : "normal"),
        className,
      )}
      aria-live="polite"
      aria-label={isHebrew ? `נסגר בעוד ${label}` : `Locks in ${label}`}
    >
      <Clock className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      <span className="tabular-nums">
        {isHebrew ? `נסגר בעוד ${label}` : `Locks in ${label}`}
      </span>
    </span>
  );
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function variantClass(
  variant: "pill" | "inline",
  state: "normal" | "urgent" | "locked",
): string {
  const base =
    "inline-flex items-center gap-1 font-[family-name:var(--font-label)] text-xs font-bold";
  if (variant === "inline") {
    return clsx(
      base,
      state === "urgent" && "text-error",
      state === "locked" && "text-on-surface-variant",
      state === "normal" && "text-on-surface-variant",
    );
  }
  const tone =
    state === "urgent"
      ? "bg-error-container text-on-error-container border-error"
      : state === "locked"
        ? "bg-surface-variant text-on-surface-variant border-outline-variant"
        : "bg-surface-container text-on-surface border-outline-variant";
  return clsx(base, "px-2 py-1 rounded-full border", tone);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined" || !window.matchMedia) {
        return () => {};
      }
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => {
      if (typeof window === "undefined" || !window.matchMedia) return false;
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    },
    () => false, // SSR: assume motion ok; client takes over after hydration
  );
}
