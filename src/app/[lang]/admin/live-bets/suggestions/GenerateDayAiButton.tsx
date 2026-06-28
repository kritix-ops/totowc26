"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, AlertCircle, SlidersHorizontal, CalendarDays } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../../dictionaries";
import { localePath } from "@/lib/paths";
import { LabelCaps } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  clampSuggestionCount,
  DEFAULT_SUGGESTION_COUNT,
} from "@/lib/bets/suggest/count";
import { generateDaySuggestions, type GenerateAiResult } from "./actions";
import { LIVE_GEN_STARTED_EVENT } from "./GenerationLog";

// "Generate for the whole day" affordance, the day-scope sibling of
// GenerateAiButton. Asks the LLM for a batch of matchday bets (cross-fixture
// day markets + per-fixture ideas) seeded with a dossier across every game
// that day. Results land as DRAFTS in /admin/bets for the admin to review and
// publish — nothing goes live without a deliberate tap. Same options panel
// (count + free-text steer) as the per-fixture button.

export function GenerateDayAiButton({
  date,
  locale,
}: {
  date: string;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const { pending, run } = usePendingAction();
  const [result, setResult] = useState<GenerateAiResult | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  // Hold the RAW text and derive the clamped count, so the field can be blank
  // mid-edit (see clampSuggestionCount). Normalized back to a number on blur.
  const [countText, setCountText] = useState(String(DEFAULT_SUGGESTION_COUNT));
  const count = clampSuggestionCount(countText);
  const [instructions, setInstructions] = useState("");

  const click = () => {
    setResult(null);
    void run(async () => {
      const res = await generateDaySuggestions(date, {
        count,
        instructions: instructions.trim() || undefined,
      });
      setResult(res);
      // Nudge the inline log to show the new run immediately.
      if (res.ok) window.dispatchEvent(new Event(LIVE_GEN_STARTED_EVENT));
    });
  };

  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-primary shrink-0" strokeWidth={1.75} />
        <LabelCaps>{isHebrew ? "AI ליום המשחקים" : "AI for the matchday"}</LabelCaps>
      </div>
      <p className="text-xs text-on-surface-variant">
        {isHebrew
          ? "הצעות שמשתרעות על כל משחקי היום — הימורי יום חוצי-משחקים והימורים ספציפיים. נשמרות כטיוטות לאישור."
          : "Bets that span the whole day — cross-match day markets and per-match ideas. Saved as drafts to approve."}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={click}
          disabled={pending}
          className={clsx(
            "press-down inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full border border-primary/40 bg-primary-container text-on-primary-container text-sm font-bold",
            pending && "opacity-60 cursor-not-allowed",
          )}
        >
          <Sparkles
            className={clsx("h-4 w-4 shrink-0", pending && "animate-pulse")}
            strokeWidth={1.75}
          />
          {pending
            ? isHebrew ? "מייצר…" : "Generating…"
            : isHebrew ? `צור ${count} הצעות ליום` : `Generate ${count} for the day`}
        </button>
        <button
          type="button"
          onClick={() => setShowOptions((v) => !v)}
          aria-expanded={showOptions}
          className={clsx(
            "press-down inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full border text-sm font-bold",
            showOptions
              ? "border-primary text-primary"
              : "border-outline text-on-surface-variant hover:bg-surface-container",
          )}
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {isHebrew ? "אפשרויות" : "Options"}
        </button>
      </div>

      {showOptions && (
        <div className="flex flex-col gap-3 w-full max-w-md rounded-xl border border-outline-variant bg-surface-container p-3">
          <label className="flex items-center gap-3 flex-wrap">
            <LabelCaps>{isHebrew ? "כמה הצעות" : "How many"}</LabelCaps>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={countText}
              disabled={pending}
              onChange={(e) =>
                setCountText(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))
              }
              onBlur={() => setCountText(String(count))}
              className="h-11 w-20 px-3 rounded border border-outline bg-surface-container-lowest text-base font-bold tabular-nums text-center focus:outline-none focus:border-primary"
              dir="ltr"
            />
            <span className="text-xs text-on-surface-variant">
              {isHebrew ? "2–10 (יותר = איטי יותר)" : "2–10 (more = slower)"}
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <LabelCaps>{isHebrew ? "בקשה ספציפית ל-AI" : "Custom request"}</LabelCaps>
            <textarea
              value={instructions}
              disabled={pending}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              dir={isHebrew ? "rtl" : "ltr"}
              placeholder={
                isHebrew
                  ? "למשל: התמקד בכמה גולים יהיו היום, ובדרבי הגדול"
                  : "e.g. focus on total goals today and the big derby"
              }
              className="min-h-[64px] px-3 py-2 rounded border border-outline bg-surface-container-lowest text-base resize-y focus:outline-none focus:border-primary"
            />
            <span className="text-[11px] text-on-surface-variant">
              {isHebrew
                ? "ה-AI עדיין מחויב לכללי הפורמט והתמחור — זה רק מכוון את הבחירה."
                : "The AI still follows the format and pricing rules — this only steers the selection."}
            </span>
          </label>
        </div>
      )}

      {result && <ResultLine result={result} locale={locale} />}
    </div>
  );
}

function ResultLine({
  result,
  locale,
}: {
  result: GenerateAiResult;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  if (result.ok) {
    return (
      <p className="text-xs text-on-surface-variant">
        {isHebrew
          ? "התחלנו לייצר ברקע ליום כולו. תקבל התראה כשהטיוטות מוכנות. "
          : "Generating for the whole day in the background. You'll be notified when the drafts are ready. "}
        <Link
          href={localePath(locale, "admin/bets")}
          className="font-bold text-primary hover:underline"
        >
          {isHebrew ? "להימורים" : "Go to bets"}
        </Link>
      </p>
    );
  }
  return (
    <p className="inline-flex items-center gap-1 text-xs text-error">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      {translateGenError(result.error, isHebrew)}
    </p>
  );
}

function translateGenError(error: string, isHebrew: boolean): string {
  switch (error) {
    case "no_key":
      return isHebrew ? "מפתח ה-AI לא מוגדר." : "AI key not configured.";
    case "match_started":
      return isHebrew ? "כל משחקי היום כבר התחילו או נעולים." : "The day's matches have all started or locked.";
    case "llm_failed":
      return isHebrew ? "הייצור נכשל. נסה שוב." : "Generation failed. Try again.";
    case "forbidden":
    case "unauth":
      return isHebrew ? "אין הרשאה." : "Not allowed.";
    default:
      return isHebrew ? "שגיאה. נסה שוב." : "Something went wrong. Try again.";
  }
}
