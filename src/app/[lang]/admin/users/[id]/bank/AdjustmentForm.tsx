"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Plus, Minus } from "lucide-react";
import { clsx } from "clsx";
import { PillButton } from "@/components/ui";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import { usePendingAction } from "@/lib/use-pending-action";
import { adjustUserPoints } from "../../actions";
import type { Locale } from "../../../../dictionaries";

export function AdjustmentForm({
  targetUserId,
  locale,
}: {
  targetUserId: string;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ oldBalance: number; newBalance: number } | null>(null);
  const { pending, run } = usePendingAction();

  const numericDelta = Number(delta);
  const valid =
    Number.isFinite(numericDelta) &&
    numericDelta !== 0 &&
    Math.abs(numericDelta) <= 500 &&
    reason.trim().length >= 3;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(null);
    if (!valid) {
      setError("invalid");
      return;
    }
    void run(async () => {
      const res = await adjustUserPoints(
        targetUserId,
        Math.trunc(numericDelta),
        reason.trim(),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved({ oldBalance: res.oldBalance, newBalance: res.newBalance });
      setDelta("");
      setReason("");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="adj-delta"
            className="font-[family-name:var(--font-label)] text-[11px] font-bold tracking-[0.05em] uppercase text-on-surface-variant"
          >
            {isHebrew ? "סכום (+/-)" : "Delta (+/-)"}
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setDelta((v) => {
                  const n = Number(v);
                  if (!Number.isFinite(n)) return v;
                  return String(-Math.abs(n || 0));
                })
              }
              aria-label={isHebrew ? "סימן מינוס" : "Set negative"}
              className="min-w-[44px] min-h-[48px] rounded-l-full border border-outline bg-surface-container-lowest hover:bg-error-container hover:text-on-error-container flex items-center justify-center"
            >
              <Minus className="h-4 w-4" strokeWidth={2.25} />
            </button>
            <input
              id="adj-delta"
              type="number"
              inputMode="numeric"
              min={-500}
              max={500}
              step={1}
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="0"
              className="flex-1 h-12 px-3 bg-surface-container-lowest border-y border-outline text-on-surface text-base font-bold tabular-nums text-center focus:outline-none focus:border-primary"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() =>
                setDelta((v) => {
                  const n = Number(v);
                  if (!Number.isFinite(n)) return v;
                  return String(Math.abs(n || 0));
                })
              }
              aria-label={isHebrew ? "סימן פלוס" : "Set positive"}
              className="min-w-[44px] min-h-[48px] rounded-r-full border border-outline bg-surface-container-lowest hover:bg-secondary-container hover:text-on-secondary-container flex items-center justify-center"
            >
              <Plus className="h-4 w-4" strokeWidth={2.25} />
            </button>
          </div>
          <p className="text-[11px] text-on-surface-variant">
            {isHebrew ? "מקסימום ±500 לרשומה" : "Max ±500 per row"}
          </p>
        </div>

        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label
            htmlFor="adj-reason"
            className="font-[family-name:var(--font-label)] text-[11px] font-bold tracking-[0.05em] uppercase text-on-surface-variant"
          >
            {isHebrew ? "סיבה (חובה)" : "Reason (required)"}
          </label>
          <textarea
            id="adj-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isHebrew
                ? "לדוגמה: בונוס פתיחת טורניר"
                : "e.g. opening-week bonus"
            }
            className="w-full min-h-[48px] px-3 py-2 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base focus:outline-none focus:border-primary resize-y"
            minLength={3}
            maxLength={400}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          {error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-error">
              <AlertCircle className="h-4 w-4" strokeWidth={2} />
              {translateError(error, isHebrew)}
            </p>
          )}
          {saved && (
            <p className="inline-flex items-center gap-1.5 text-sm text-secondary">
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew
                ? `נשמר. יתרה: ${saved.oldBalance} → ${saved.newBalance}`
                : `Saved. Balance: ${saved.oldBalance} → ${saved.newBalance}`}
            </p>
          )}
        </div>
        <PillButton
          type="submit"
          disabled={!valid || pending}
          className={clsx(
            "px-8 py-3",
            (!valid || pending) && "opacity-60 cursor-not-allowed",
          )}
        >
          {pending
            ? isHebrew
              ? "שומר..."
              : "Saving..."
            : isHebrew
              ? "החל התאמה"
              : "Apply adjustment"}
        </PillButton>
      </div>
    </form>
  );
}

const ERROR_MAP = {
  ...COMMON_ADMIN_ERRORS,
  invalid: [
    "ערכים לא תקינים. סכום בין -500 ל-500 ולא 0, סיבה לפחות 3 תווים.",
    "Invalid input. Delta between -500 and 500 (not 0); reason at least 3 chars.",
  ],
  unauthorized: ["יש להתחבר", "Sign in required"],
} as const satisfies Record<string, LocalizedTuple>;

function translateError(code: string, isHebrew: boolean): string {
  return translateAdminError(code in ERROR_MAP ? code : "db", ERROR_MAP, isHebrew);
}
