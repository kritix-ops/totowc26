"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../../dictionaries";
import { localePath } from "@/lib/paths";
import { usePendingAction } from "@/lib/use-pending-action";
import { generateAiSuggestions, type GenerateAiResult } from "./actions";

// "Generate with AI" affordance per fixture. Asks the LLM for a batch of
// live bets, which land as DRAFTS in /admin/bets for the admin to review
// and publish — nothing goes live without a deliberate tap. The result
// line links straight to the review list.

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

  const click = () => {
    setResult(null);
    void run(async () => {
      const res = await generateAiSuggestions(matchId);
      setResult(res);
      if (res.ok && res.created > 0) router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
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
          : isHebrew ? "צור הצעות AI" : "Generate with AI"}
      </button>
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
