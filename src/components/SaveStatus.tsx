"use client";

import { AlertCircle, Check, Loader2, RotateCcw } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";

// Persistent inline save indicator for auto-saving controls. Unlike a toast
// it does NOT flash and vanish — once a value is saved the "נשמר" line stays
// put so a user who looks up a beat late still sees that their change stuck
// (the council's core ask). Errors render loud with a tap-to-retry button,
// since an auto-saved field has no Save button to re-press.
//
// Driven by the useAutosave hook's status. Pure presentational — all timing,
// debouncing and the actual write live in the hook.

export type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveStatus({
  state,
  locale,
  savedLabel,
  onRetry,
  onUndo,
  className,
}: {
  state: SaveState;
  locale: Locale;
  // Optional richer confirmation, e.g. "נשמר 2-0" so the user sees exactly
  // what was persisted, not just that something saved. Falls back to "נשמר".
  savedLabel?: string;
  onRetry?: () => void;
  // Optional inline "undo" shown on the saved state — reverts to the value
  // before the last auto-save. Used where a per-save toast would be noisy
  // (e.g. a long list of match rows).
  onUndo?: () => void;
  className?: string;
}) {
  const isHebrew = locale === "he";

  if (state === "idle") return null;

  if (state === "saving") {
    return (
      <span
        role="status"
        aria-live="polite"
        className={clsx(
          "inline-flex items-center gap-1.5 text-xs font-bold text-on-surface-variant",
          className,
        )}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
        {isHebrew ? "שומר…" : "Saving…"}
      </span>
    );
  }

  if (state === "saved") {
    return (
      <span
        role="status"
        aria-live="polite"
        className={clsx(
          "inline-flex items-center gap-1.5 text-xs font-bold text-secondary",
          className,
        )}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        {savedLabel ?? (isHebrew ? "נשמר" : "Saved")}
        {onUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="press-down inline-flex items-center min-h-11 px-2 -my-2 rounded-full font-bold text-on-surface-variant underline hover:text-on-surface"
          >
            {isHebrew ? "בטל" : "Undo"}
          </button>
        )}
      </span>
    );
  }

  // error
  return (
    <span
      role="status"
      aria-live="assertive"
      className={clsx("inline-flex items-center gap-1.5 text-xs", className)}
    >
      <span className="inline-flex items-center gap-1 font-bold text-error">
        <AlertCircle className="h-3.5 w-3.5" strokeWidth={2.5} />
        {isHebrew ? "לא נשמר" : "Not saved"}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="press-down inline-flex items-center gap-1 min-h-11 px-2.5 -my-1 rounded-full font-bold text-error border border-error/40 hover:bg-error-container"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.5} />
          {isHebrew ? "נסה שוב" : "Retry"}
        </button>
      )}
    </span>
  );
}
