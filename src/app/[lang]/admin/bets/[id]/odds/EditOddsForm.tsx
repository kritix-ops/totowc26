"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Check } from "lucide-react";
import { Card, Chip, LabelCaps, PillButton } from "@/components/ui";
import { formatLiveRatio } from "@/lib/bets/price-options";
import { usePendingAction } from "@/lib/use-pending-action";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { OddsEditRow } from "@/lib/bets/edit-odds";
import type { PricingMode } from "@/lib/bets/types";
import { repriceLiveBetOdds } from "../../actions";

// Two-step odds editor for a PUBLISHED live bet. Step 1: one input per outcome
// (pre-filled with the current ×N) + a required reason. Step 2: a review that
// spells out before → after for every changed outcome and how many picks get
// recomputed, so the admin confirms a money-affecting change on purpose. The
// server re-prices and re-grades; this component only collects + previews.
export function EditOddsForm({
  locale,
  betId,
  answerType,
  rows,
  pricingMode,
  pickCount,
  backHref,
}: {
  locale: Locale;
  betId: string;
  answerType: "multi_choice" | "yes_no";
  rows: OddsEditRow[];
  pricingMode: PricingMode;
  pickCount: number;
  backHref: string;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const { pending, run } = usePendingAction();

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rows.map((r) => [r.value, r.currentOdds != null ? String(r.currentOdds) : ""]),
    ),
  );
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () =>
      rows.map((r) => {
        const next = Number(values[r.value]);
        const valid = Number.isFinite(next) && next > 1;
        const changed =
          r.currentOdds == null ||
          Math.round(next * 100) / 100 !== Math.round(r.currentOdds * 100) / 100;
        return { ...r, next, valid, changed };
      }),
    [rows, values],
  );

  const allValid = parsed.every((p) => p.valid);
  const changedRows = parsed.filter((p) => p.changed && p.valid);
  const reasonValid = reason.trim().length >= 3;

  const goReview = () => {
    setError(null);
    if (!allValid) {
      setError(isHebrew ? "כל יחס חייב להיות מספר גדול מ-1" : "Every ratio must be a number > 1");
      return;
    }
    if (changedRows.length === 0) {
      setError(isHebrew ? "לא שינית אף יחס" : "No ratios changed");
      return;
    }
    if (!reasonValid) {
      setError(isHebrew ? "צריך לכתוב סיבה (3 תווים לפחות)" : "A reason is required (min 3 chars)");
      return;
    }
    setStep("review");
  };

  const submit = () => {
    setError(null);
    const input =
      answerType === "multi_choice"
        ? { decimalOddsByValue: Object.fromEntries(parsed.map((p) => [p.value, p.next])) }
        : {
            decimalOddsYes: parsed.find((p) => p.value === "yes")?.next,
            decimalOddsNo: parsed.find((p) => p.value === "no")?.next,
          };
    void run(async () => {
      const res = await repriceLiveBetOdds(betId, input, reason.trim());
      if (!res.ok) {
        setError(errorLabel(res.error, isHebrew));
        setStep("edit");
        return;
      }
      // Re-priced. Back to the bet; the refreshed server tree shows the new ×N.
      router.replace(backHref);
      router.refresh();
    });
  };

  const modeHint = isHebrew
    ? pricingMode === "ratio"
      ? "במצב ידני ה-×N הוא בדיוק המכפיל שהשחקן מקבל (סכום × יחס)."
      : "ה-×N הוא היחס ההוגן שלפיו מחושב התשלום."
    : pricingMode === "ratio"
      ? "In manual mode ×N is exactly the multiplier the player wins (stake × ratio)."
      : "×N is the fair odds the payout is derived from.";

  return (
    <Card className="p-5 md:p-8 flex flex-col gap-6">
      {error && (
        <div className="flex items-center gap-2 text-sm text-error bg-error-container/40 rounded-2xl px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span>{error}</span>
        </div>
      )}

      {step === "edit" ? (
        <>
          <div className="flex flex-col gap-1">
            <LabelCaps>{isHebrew ? "יחסים" : "Ratios"}</LabelCaps>
            <p className="text-xs text-on-surface-variant">{modeHint}</p>
          </div>

          <div className="flex flex-col gap-3">
            {parsed.map((r) => (
              <div
                key={r.value}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
              >
                <div className="flex items-center justify-between gap-3 sm:w-1/2 min-w-0">
                  <span className="font-bold text-on-surface truncate">{r.label}</span>
                  <Chip tone="secondary" className="tabular-nums shrink-0">
                    <span className="text-on-surface-variant text-xs">
                      {isHebrew ? "כעת" : "now"}
                    </span>{" "}
                    <span dir="ltr">
                      {r.currentOdds != null ? formatLiveRatio(r.currentOdds) : "—"}
                    </span>
                  </Chip>
                </div>
                <div className="sm:w-1/2">
                  <label className="sr-only" htmlFor={`odds-${r.value}`}>
                    {isHebrew ? `יחס חדש ל${r.label}` : `New ratio for ${r.label}`}
                  </label>
                  <input
                    id={`odds-${r.value}`}
                    type="number"
                    inputMode="decimal"
                    min={1.01}
                    step={0.5}
                    dir="ltr"
                    value={values[r.value]}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [r.value]: e.target.value }))
                    }
                    placeholder="×N"
                    className={`w-full min-h-[48px] px-4 rounded-full bg-surface-container-lowest border text-base tabular-nums text-center focus:outline-none focus:border-primary ${
                      r.valid ? "border-outline" : "border-error"
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <LabelCaps>{isHebrew ? "סיבה (חובה)" : "Reason (required)"}</LabelCaps>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              dir={isHebrew ? "rtl" : "ltr"}
              rows={2}
              placeholder={
                isHebrew
                  ? "למה אתה מתקן? נשמר ביומן הביקורת."
                  : "Why the correction? Stored in the audit log."
              }
              className="w-full px-4 py-3 rounded-2xl bg-surface-container-lowest border border-outline text-base focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Link href={backHref} className="text-sm text-on-surface-variant hover:text-on-surface">
              {isHebrew ? "ביטול" : "Cancel"}
            </Link>
            <PillButton type="button" onClick={goReview} className="min-h-[48px]">
              {isHebrew ? "המשך לאישור" : "Continue to review"}
            </PillButton>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <LabelCaps>{isHebrew ? "אישור" : "Review"}</LabelCaps>
            <p className="text-sm text-on-surface-variant">
              {isHebrew ? "בדוק לפני שמירה." : "Check before saving."}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {changedRows.map((r) => (
              <div
                key={r.value}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-surface-container"
              >
                <span className="font-bold text-on-surface truncate">{r.label}</span>
                <span className="inline-flex items-center gap-2 tabular-nums shrink-0">
                  <span dir="ltr" className="text-on-surface-variant line-through">
                    {r.currentOdds != null ? formatLiveRatio(r.currentOdds) : "—"}
                  </span>
                  <ArrowLeft className="h-4 w-4 text-on-surface-variant" strokeWidth={2} />
                  <span dir="ltr" className="font-bold text-primary">
                    {formatLiveRatio(r.next)}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {pickCount > 0 && (
            <div className="flex items-start gap-2 text-sm text-on-tertiary-fixed-variant bg-tertiary-fixed/50 rounded-2xl px-4 py-3">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={2} />
              <span>
                {isHebrew
                  ? `${pickCount} שחקנים כבר הימרו — התשלום שלהם יחושב מחדש לפי היחסים החדשים, וכולם יקבלו התראה.`
                  : `${pickCount} players already picked — their payout will be recomputed to the new ratios and they'll be notified.`}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <LabelCaps>{isHebrew ? "סיבה" : "Reason"}</LabelCaps>
            <p className="text-sm text-on-surface">{reason.trim()}</p>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setStep("edit")}
              disabled={pending}
              className="text-sm text-on-surface-variant hover:text-on-surface"
            >
              {isHebrew ? "חזרה לעריכה" : "Back to edit"}
            </button>
            <PillButton
              type="button"
              onClick={submit}
              disabled={pending}
              className="min-h-[48px]"
            >
              <Check className="h-5 w-5" strokeWidth={2.5} />
              {pending
                ? isHebrew ? "שומר…" : "Saving…"
                : isHebrew ? "אשר ועדכן" : "Confirm & update"}
            </PillButton>
          </div>
        </>
      )}
    </Card>
  );
}

function errorLabel(e: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    forbidden: ["אין הרשאה", "Not allowed"],
    bet_not_found: ["ההימור לא נמצא", "Bet not found"],
    wrong_scope: ["אפשר לערוך יחסים רק בהימור לייב", "Odds editing is live-bets only"],
    wrong_status: ["אפשר לערוך יחסים רק בהימור פתוח", "Only an open bet's odds are editable"],
    locked: ["ההימור כבר ננעל — אי אפשר לערוך", "The bet is already locked"],
    invalid_reason: ["צריך לכתוב סיבה", "A reason is required"],
    invalid_odds: ["יש יחס לא תקין (חייב >1, ועד ×100 בדיוק ידני)", "Invalid ratio (> 1, ≤ 100 in manual mode)"],
    no_odds: ["להימור הזה אין יחסים לעריכה", "This bet has no editable odds"],
    unauth: ["צריך להתחבר", "Sign in required"],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return (map[e] ?? ["שגיאה", "Error"])[isHebrew ? 0 : 1];
}
