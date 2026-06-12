"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, AlertCircle, SlidersHorizontal } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../../dictionaries";
import { localePath } from "@/lib/paths";
import { LabelCaps } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import { generateAiSuggestions, type GenerateAiResult } from "./actions";

// "Generate with AI" affordance per fixture. Asks the LLM for a batch of
// live bets, which land as DRAFTS in /admin/bets for the admin to review
// and publish — nothing goes live without a deliberate tap. An optional
// panel lets the admin steer the request (free-text context) and pick how
// many bets to ask for. The result line links straight to the review list.

const DEFAULT_COUNT = 6;

export function GenerateAiButton({
  matchId,
  locale,
}: {
  matchId: string;
  locale: Locale;
}) {
  const router = useRouter();
  const isHebrew = locale === "he";
  const { pending, run } = usePendingAction();
  const [result, setResult] = useState<GenerateAiResult | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [instructions, setInstructions] = useState("");

  const click = () => {
    setResult(null);
    void run(async () => {
      const res = await generateAiSuggestions(matchId, {
        count,
        instructions: instructions.trim() || undefined,
      });
      setResult(res);
      if (res.ok && res.created > 0) router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
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
            : isHebrew ? `צור ${count} הצעות AI` : `Generate ${count} with AI`}
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
        <div className="flex flex-col gap-3 w-full max-w-md rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
          <label className="flex items-center gap-3 flex-wrap">
            <LabelCaps>{isHebrew ? "כמה הצעות" : "How many"}</LabelCaps>
            <input
              type="number"
              min={2}
              max={10}
              value={count}
              disabled={pending}
              onChange={(e) => {
                const n = parseInt(e.target.value || "6", 10);
                setCount(Number.isFinite(n) ? Math.max(2, Math.min(10, n)) : DEFAULT_COUNT);
              }}
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
                  ? "למשל: התמקד בכרטיסים וקרנות, בלי הימורי ואר"
                  : "e.g. focus on cards and corners, no VAR bets"
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
    if (result.created === 0) {
      return (
        <p className="text-xs text-on-surface-variant">
          {isHebrew ? "לא נוצרו טיוטות. נסה שוב." : "No drafts created. Try again."}
        </p>
      );
    }
    return (
      <p className="text-xs text-on-surface-variant">
        {isHebrew
          ? `נוצרו ${result.created} טיוטות${result.failed ? ` (${result.failed} נכשלו)` : ""}. `
          : `Created ${result.created} drafts${result.failed ? ` (${result.failed} failed)` : ""}. `}
        <Link
          href={localePath(locale, "admin/bets")}
          className="font-bold text-primary hover:underline"
        >
          {isHebrew ? "לעיון ופרסום" : "Review & publish"}
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
      return isHebrew ? "המשחק כבר התחיל." : "Match already started.";
    case "llm_failed":
      return isHebrew ? "הייצור נכשל. נסה שוב." : "Generation failed. Try again.";
    case "forbidden":
    case "unauth":
      return isHebrew ? "אין הרשאה." : "Not allowed.";
    default:
      return isHebrew ? "שגיאה. נסה שוב." : "Something went wrong. Try again.";
  }
}
