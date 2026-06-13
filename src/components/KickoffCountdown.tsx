"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Clock, Radio } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { MS_PER_HOUR, MS_PER_MINUTE } from "@/lib/time";

// Counts down to a match kickoff on the /[lang]/live scoreboard.
// Mirrors the LocksInCountdown shape (server-resolved ISO instant, client
// just ticks) so behaviour is predictable: no hydration drift, no second
// network call to "now()". Under 60 minutes flips to red; under 10 minutes
// adds a pulse to signal "this is about to start". Once the kickoff time
// has passed but the API-Football sync hasn't promoted status='live' yet,
// shows a neutral "kicking off" label so the row doesn't look stale.
//
// Lives next to LocksInCountdown but is purpose-built for kickoff timing
// — different threshold colours, never auto-hides, and an explicit
// "kicking off" terminal state — so we don't shoehorn one widget into
// two jobs.

type Props = {
  locale: Locale;
  kickoffAt: string;
  className?: string;
};

const REDUCED_MOTION_TICK_MS = 5000;
const URGENT_THRESHOLD_MS = 10 * MS_PER_MINUTE;
const WARN_THRESHOLD_MS = MS_PER_HOUR;

export function KickoffCountdown({ locale, kickoffAt, className }: Props) {
  const isHebrew = locale === "he";
  const reducedMotion = useReducedMotion();
  const tickMs = reducedMotion ? REDUCED_MOTION_TICK_MS : 1000;
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);

  const kickoffMs = new Date(kickoffAt).getTime();
  if (!Number.isFinite(kickoffMs)) return null;

  const remaining = kickoffMs - now;

  if (remaining <= 0) {
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-[family-name:var(--font-label)] text-xs font-bold",
          "bg-error-container text-on-error-container border-error animate-pulse",
          className,
        )}
        aria-live="polite"
      >
        <Radio className="h-3 w-3" strokeWidth={2.5} aria-hidden />
        <span>{isHebrew ? "מתחיל..." : "Kicking off..."}</span>
      </span>
    );
  }

  const urgent = remaining <= URGENT_THRESHOLD_MS;
  const warn = remaining <= WARN_THRESHOLD_MS;
  const label = formatKickoffRemaining(remaining);
  const prefix = isHebrew ? "מתחיל בעוד" : "Starts in";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-[family-name:var(--font-label)] text-xs font-bold",
        urgent
          ? "bg-error-container text-on-error-container border-error animate-pulse"
          : warn
            ? "bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-fixed-dim"
            : "bg-surface-container text-on-surface border-outline-variant",
        className,
      )}
      aria-live="polite"
      aria-label={`${prefix} ${label}`}
    >
      <Clock className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      <span className="tabular-nums">
        {prefix} {label}
      </span>
    </span>
  );
}

// Format a remaining-ms duration. Over 24 h → "Nd HH:MM" (days + hms);
// over 1 h → "H:MM:SS"; under 1 h → "MM:SS". Always tabular so the badge
// doesn't shimmy as digits cycle.
export function formatKickoffRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(minutes)}`;
  }
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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
    () => false,
  );
}
