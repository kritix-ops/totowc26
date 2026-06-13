"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Gavel, X, AlertCircle, Check, ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import { PillButton } from "@/components/ui";
import { localePath } from "@/lib/paths";
import type { Locale } from "../../dictionaries";
import { usePendingAction } from "@/lib/use-pending-action";
import { formatMultiplier, type DuelOption } from "@/lib/duels/options";
import { cancelDuel, settleDuel } from "../../duels/actions";

// Inline duel management for the admin bets list. Mirrors the affordance
// set BetsTableActions gives custom bets — a details link plus the
// lifecycle actions the current status allows — but speaks the duel
// lifecycle: cancel (open/matched) and settle (matched only). Both
// legacy yes/no and custom-option duels are handled; settle for an
// options duel resolves to the winning option key, legacy to a boolean.
//
// The server actions (settleDuel / cancelDuel) are gated to the liveBets
// permission, so a scoped bet-manager reaching this component can act —
// the buttons never appear without the permission because the whole
// /admin/bets path is permission-gated upstream.

type Status = "open" | "matched" | "settled" | "cancelled";

export function DuelAdminActions({
  locale,
  duelId,
  status,
  options,
  openerOption,
  joinerOption,
}: {
  locale: Locale;
  duelId: string;
  status: Status;
  options: DuelOption[] | null;
  openerOption: string | null;
  joinerOption: string | null;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState<"settled" | "cancelled" | null>(null);
  const [panel, setPanel] = useState<"settle" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [resolvedValue, setResolvedValue] = useState<boolean | null>(null);
  const [resolvedOptionKey, setResolvedOptionKey] = useState<string | null>(
    null,
  );

  const canCancel = status === "open" || status === "matched";
  const canSettle = status === "matched";

  // For options duels only the opener's and joiner's actual picks can win
  // — settling to a third (untaken) option would leave no winner. Limit
  // the settle choices to the two sides that are in play.
  const settleChoices = (options ?? []).filter(
    (o) => o.key === openerOption || o.key === joinerOption,
  );

  const labels = {
    details: isHebrew ? "פרטים" : "Details",
    settle: isHebrew ? "הכרע" : "Settle",
    cancel: isHebrew ? "בטל" : "Cancel",
    confirmCancel: isHebrew ? "אשר ביטול" : "Confirm cancel",
    confirmSettle: isHebrew ? "אשר הכרעה" : "Confirm",
    back: isHebrew ? "חזרה" : "Back",
    reasonLabel: isHebrew ? "סיבה לביטול" : "Reason",
    settlePrompt: isHebrew ? "מה הייתה התוצאה?" : "What was the outcome?",
    yes: isHebrew ? "כן" : "Yes",
    no: isHebrew ? "לא" : "No",
    pending: isHebrew ? "שולח..." : "Sending...",
    settledFlash: isHebrew ? "הוכרע" : "Settled",
    cancelledFlash: isHebrew ? "בוטל" : "Cancelled",
  };

  const reset = () => {
    setPanel(null);
    setReason("");
    setResolvedValue(null);
    setResolvedOptionKey(null);
    setError(null);
  };

  const doCancel = () => {
    setError(null);
    if (reason.trim().length < 3) {
      setError(isHebrew ? "סיבה קצרה מדי" : "Reason too short");
      return;
    }
    void run(async () => {
      const res = await cancelDuel(duelId, reason.trim());
      if (!res.ok) {
        setError(translate(res.error, isHebrew));
        return;
      }
      setOkFlash("cancelled");
      reset();
      router.refresh();
    });
  };

  const doSettle = () => {
    setError(null);
    const resolved = options ? resolvedOptionKey : resolvedValue;
    if (resolved === null) {
      setError(isHebrew ? "בחר תוצאה" : "Pick an outcome");
      return;
    }
    void run(async () => {
      const res = await settleDuel(duelId, resolved);
      if (!res.ok) {
        setError(translate(res.error, isHebrew));
        return;
      }
      setOkFlash("settled");
      reset();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {error && (
          <span className="inline-flex items-center gap-1 text-xs text-error me-auto">
            <AlertCircle className="h-3 w-3" strokeWidth={2} />
            {error}
          </span>
        )}
        {okFlash && !error && (
          <span className="inline-flex items-center gap-1 text-xs text-secondary me-auto">
            <Check className="h-3 w-3" strokeWidth={2.5} />
            {okFlash === "settled" ? labels.settledFlash : labels.cancelledFlash}
          </span>
        )}

        <Link
          href={localePath(locale, `duels/${duelId}`)}
          className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-full border border-outline bg-surface-container-lowest text-on-surface text-sm font-bold hover:bg-surface-container"
        >
          <ExternalLink className="h-4 w-4" strokeWidth={2} />
          {labels.details}
        </Link>

        {canSettle && (
          <PillButton
            type="button"
            variant="primary"
            disabled={pending}
            onClick={() => setPanel(panel === "settle" ? null : "settle")}
            className="min-h-[40px] py-2 px-4 text-sm"
          >
            <Gavel className="h-4 w-4" strokeWidth={2.5} />
            {labels.settle}
          </PillButton>
        )}

        {canCancel && (
          <PillButton
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setPanel(panel === "cancel" ? null : "cancel")}
            className="min-h-[40px] py-2 px-4 text-sm"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
            {labels.cancel}
          </PillButton>
        )}
      </div>

      {panel === "settle" && canSettle && (
        <div className="flex flex-col gap-3 p-3 rounded-lg border border-outline-variant bg-surface-container-low">
          <p className="text-sm font-bold text-on-surface">
            {labels.settlePrompt}
          </p>
          {options ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {settleChoices.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setResolvedOptionKey(o.key)}
                  className={clsx(
                    "press-down min-h-[48px] rounded-lg border text-sm font-bold flex flex-col items-center justify-center gap-0.5",
                    resolvedOptionKey === o.key
                      ? "bg-primary text-on-primary border-primary"
                      : "bg-surface-container-lowest text-on-surface border-outline",
                  )}
                >
                  <span>{isHebrew ? o.labelHe : o.labelEn}</span>
                  <span className="text-[10px] tabular-nums opacity-80">
                    {formatMultiplier(o.multiplierPct, isHebrew ? "he" : "en")}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setResolvedValue(v)}
                  className={clsx(
                    "press-down min-h-[48px] rounded-lg border text-base font-bold",
                    resolvedValue === v
                      ? "bg-primary text-on-primary border-primary"
                      : "bg-surface-container-lowest text-on-surface border-outline",
                  )}
                >
                  {v ? labels.yes : labels.no}
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              className="press-down min-h-[44px] px-4 rounded-full bg-surface-container-low border border-outline text-on-surface text-sm font-bold"
            >
              {labels.back}
            </button>
            <PillButton
              type="button"
              onClick={doSettle}
              disabled={
                pending ||
                (options ? resolvedOptionKey === null : resolvedValue === null)
              }
              className={clsx(
                "min-h-[44px]",
                (pending ||
                  (options
                    ? resolvedOptionKey === null
                    : resolvedValue === null)) &&
                  "opacity-60 cursor-not-allowed",
              )}
            >
              {pending ? labels.pending : labels.confirmSettle}
            </PillButton>
          </div>
        </div>
      )}

      {panel === "cancel" && canCancel && (
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-outline-variant bg-surface-container-low">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {labels.reasonLabel}
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-base"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              className="press-down min-h-[44px] px-4 rounded-full bg-surface-container-low border border-outline text-on-surface text-sm font-bold"
            >
              {labels.back}
            </button>
            <PillButton
              type="button"
              variant="secondary"
              onClick={doCancel}
              disabled={pending}
              className={clsx(
                "min-h-[44px]",
                pending && "opacity-60 cursor-not-allowed",
              )}
            >
              {pending ? labels.pending : labels.confirmCancel}
            </PillButton>
          </div>
        </div>
      )}
    </div>
  );
}

// Map a duel server-action error code to a short admin-facing string.
// Kept local + terse — the admin just needs to know why an action
// bounced, not the full player-facing copy.
function translate(code: string, isHebrew: boolean): string {
  switch (code) {
    case "forbidden":
      return isHebrew ? "אין הרשאה" : "Not allowed";
    case "duel_not_found":
      return isHebrew ? "הדו-קרב לא נמצא" : "Duel not found";
    case "already_settled":
      return isHebrew ? "כבר הוכרע/בוטל" : "Already settled/cancelled";
    case "invalid_input":
      return isHebrew ? "קלט לא תקין" : "Invalid input";
    default:
      return isHebrew ? "שגיאה" : "Something went wrong";
  }
}
