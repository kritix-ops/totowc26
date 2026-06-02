"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dices, Sparkles } from "lucide-react";
import { Card, PillButton } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  fillRandomPicks,
  type FillRandomResult,
  type FillTarget,
} from "@/app/[lang]/bets/random-actions";
import type { Locale } from "@/app/[lang]/dictionaries";

// Per-surface "Surprise me" bulk fill. One tap fills every OPEN bet on the
// current surface that the player has not picked yet, with odds-weighted
// random picks. It never touches a pick they already made, and every filled
// pick stays editable afterwards (that is the undo). A confirm step guards the
// tap so it can't fire by accident. See
// _plans/2026-06-01-monkey-bot-and-random-fill.md §Phase 3.

export function SurpriseMeButton({
  locale,
  target,
}: {
  locale: Locale;
  target: FillTarget;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const { pending, run } = usePendingAction();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<FillRandomResult | null>(null);

  const onFill = () => {
    void run(async () => {
      const res = await fillRandomPicks(target);
      setResult(res);
      setConfirming(false);
      if (res.ok && res.filled > 0) router.refresh();
    });
  };

  // Result banner — shown after a fill until the player dismisses it.
  if (result) {
    return (
      <Card className="p-4 flex flex-col gap-3 bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
        <p className="text-sm inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{resultMessage(result, isHebrew)}</span>
        </p>
        <PillButton
          type="button"
          variant="ghost"
          className="self-start min-h-11"
          onClick={() => setResult(null)}
        >
          {isHebrew ? "סגור" : "Dismiss"}
        </PillButton>
      </Card>
    );
  }

  // Confirm step.
  if (confirming) {
    return (
      <Card className="p-4 flex flex-col gap-3">
        <p className="text-sm font-bold text-on-surface">
          {isHebrew ? "למלא את ההימורים הריקים שלך?" : "Fill your empty bets?"}
        </p>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "נמלא בחירות אקראיות (משוקללות לפי הסיכויים) רק להימורים שעוד לא מילאת. מה שכבר בחרת לא ישתנה, ותוכל לשנות כל בחירה אחר כך."
            : "We'll fill random picks (weighted by the odds) only for bets you haven't made yet. Picks you already made stay untouched, and you can change any of them after."}
        </p>
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <PillButton
            type="button"
            variant="ghost"
            className="min-h-12 sm:flex-1"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            {isHebrew ? "ביטול" : "Cancel"}
          </PillButton>
          <PillButton
            type="button"
            variant="primary"
            className="min-h-12 sm:flex-1"
            onClick={onFill}
            disabled={pending}
          >
            <Dices className="h-5 w-5" strokeWidth={1.75} />
            {pending
              ? isHebrew
                ? "ממלא…"
                : "Filling…"
              : isHebrew
                ? "מלא"
                : "Fill"}
          </PillButton>
        </div>
      </Card>
    );
  }

  // Trigger.
  return (
    <PillButton
      type="button"
      variant="secondary"
      className="self-start min-h-12"
      onClick={() => setConfirming(true)}
    >
      <Dices className="h-5 w-5" strokeWidth={1.75} />
      {isHebrew ? "תפתיע אותי" : "Surprise me"}
    </PillButton>
  );
}

function resultMessage(res: FillRandomResult, isHebrew: boolean): string {
  if (!res.ok) {
    if (res.error === "not_paid") {
      return isHebrew
        ? "צריך להיות משתתף משלם כדי להמר."
        : "You need to be a paid player to bet.";
    }
    return isHebrew ? "משהו השתבש, נסה שוב." : "Something went wrong, try again.";
  }
  if (res.filled === 0 && res.skipped === 0) {
    return isHebrew ? "אין הימורים ריקים למלא 👌" : "No empty bets to fill 👌";
  }
  if (res.filled === 0) {
    return isHebrew
      ? "לא נמצאו הימורים שאפשר למלא אקראית כאן."
      : "Nothing here could be auto-filled.";
  }
  const base = isHebrew
    ? `מילאנו ${res.filled} הימורים אקראית.`
    : `Filled ${res.filled} ${res.filled === 1 ? "bet" : "bets"} at random.`;
  if (res.skipped > 0) {
    return isHebrew ? `${base} (${res.skipped} דולגו)` : `${base} (${res.skipped} skipped)`;
  }
  return base;
}
