"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trophy, ShieldCheck, Check, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import type { Locale } from "../../dictionaries";
import { saveTournamentResults } from "./actions";

type FinalPen = "yes" | "no" | "";

export function ResultsForm({
  initialTopScorer,
  initialFinalPen,
  locale,
}: {
  initialTopScorer: string;
  initialFinalPen: FinalPen;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [topScorer, setTopScorer] = useState(initialTopScorer);
  const [finalPen, setFinalPen] = useState<FinalPen>(initialFinalPen);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const dirty =
    topScorer !== initialTopScorer || finalPen !== initialFinalPen;

  const onSave = () => {
    setError(null);
    setSavedCount(null);
    startTransition(async () => {
      const res = await saveTournamentResults({
        topScorer,
        finalWentToPenalties: finalPen,
      });
      if (!res.ok) {
        setError(
          res.error === "forbidden"
            ? isHebrew
              ? "אין הרשאה"
              : "Not allowed"
            : isHebrew
              ? "שגיאת שמירה"
              : "Save failed",
        );
        return;
      }
      setSavedCount(res.scored);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Trophy
            className="h-6 w-6 text-tertiary-fixed-dim shrink-0"
            strokeWidth={1.75}
          />
          <SectionHeading as="h2" underline="thin">
            {isHebrew ? "מלך השערים" : "Top scorer"}
          </SectionHeading>
        </div>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "השוואה גמישה: אותיות גדולות/קטנות וניקוד לא משנים. השאר ריק עד שתסתיים תחרות הבקיעי השערים."
            : "Match is case-insensitive and diacritics are ignored. Leave blank until the goal race ends."}
        </p>
        <input
          type="text"
          value={topScorer}
          onChange={(e) => setTopScorer(e.target.value)}
          placeholder={isHebrew ? "שם השחקן" : "Player name"}
          className="w-full h-12 px-4 rounded-full bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base text-on-surface placeholder:text-outline-variant"
        />
      </Card>

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <ShieldCheck
            className="h-6 w-6 text-primary shrink-0"
            strokeWidth={1.75}
          />
          <SectionHeading as="h2" underline="thin">
            {isHebrew ? "האם הגמר ייפסק בפנדלים?" : "Did the final go to penalties?"}
          </SectionHeading>
        </div>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "השאר ריק אם הגמר עוד לא שוחק."
            : "Leave blank if the final has not been played."}
        </p>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              { v: "yes" as const, label: isHebrew ? "כן" : "Yes" },
              { v: "no" as const, label: isHebrew ? "לא" : "No" },
              { v: "" as const, label: isHebrew ? "ריק" : "Clear" },
            ]
          ).map((opt) => {
            const active = finalPen === opt.v;
            return (
              <button
                key={opt.v || "clear"}
                type="button"
                onClick={() => setFinalPen(opt.v)}
                className={clsx(
                  "press-down min-h-[48px] py-3 px-4 rounded-full border text-base font-bold transition-colors",
                  active
                    ? "border-2 border-primary bg-primary-container text-on-primary-container shadow-sm"
                    : "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
        {error && (
          <p className="inline-flex items-center gap-1.5 text-sm text-error">
            <AlertCircle className="h-4 w-4" strokeWidth={2} />
            {error}
          </p>
        )}
        {savedCount !== null && !error && (
          <p className="inline-flex items-center gap-1.5 text-sm text-secondary">
            <Check className="h-4 w-4" strokeWidth={2.5} />
            {isHebrew
              ? `נשמר. נוקדו ${savedCount} הימורים.`
              : `Saved. ${savedCount} picks scored.`}
          </p>
        )}
        <PillButton
          type="button"
          onClick={onSave}
          disabled={pending || !dirty}
          className="px-8 py-3"
        >
          {pending
            ? isHebrew
              ? "שומר..."
              : "Saving..."
            : isHebrew
              ? "שמור ונקד מחדש"
              : "Save and rescore"}
        </PillButton>
      </div>
    </div>
  );
}
