"use client";

import { Languages, Loader2, TriangleAlert } from "lucide-react";
import { clsx } from "clsx";
import type { AutoTranslateState } from "@/lib/use-auto-translate";

// Tiny status badge that lives directly under the English input next
// to a Hebrew counterpart. Mirrors the auto-translate state from
// useAutoTranslate. Hidden when nothing is happening - never adds
// vertical noise to the form unless something needs surfacing.

export function AutoTranslateHint({
  state,
  isHebrew,
  className,
}: {
  state: AutoTranslateState;
  isHebrew: boolean;
  className?: string;
}) {
  if (state.pending) {
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 text-[11px] text-on-surface-variant",
          className,
        )}
        dir={isHebrew ? "rtl" : "ltr"}
      >
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.25} />
        {isHebrew ? "מתרגם לאנגלית..." : "Translating..."}
      </span>
    );
  }
  if (state.error === "rate_limited") {
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 text-[11px] text-on-surface-variant",
          className,
        )}
        dir={isHebrew ? "rtl" : "ltr"}
      >
        <TriangleAlert className="h-3 w-3" strokeWidth={2.25} />
        {isHebrew
          ? "יותר מדי בקשות תרגום - נסה שוב בעוד דקה"
          : "Too many translations - try again in a minute"}
      </span>
    );
  }
  if (state.error === "api_error" || state.error === "no_key") {
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 text-[11px] text-on-surface-variant",
          className,
        )}
        dir={isHebrew ? "rtl" : "ltr"}
      >
        <Languages className="h-3 w-3" strokeWidth={2.25} />
        {isHebrew ? "תרגום אוטומטי לא זמין - מלא ידנית" : "Auto-translate unavailable - fill manually"}
      </span>
    );
  }
  return null;
}
