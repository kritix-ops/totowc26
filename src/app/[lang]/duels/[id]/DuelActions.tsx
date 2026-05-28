"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { clsx } from "clsx";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import type { Dictionary, Locale } from "../../dictionaries";
import { cancelDuel, joinDuel, settleDuel } from "../actions";

// All viewer-context-dependent CTAs for the duel detail page live here.
// Server passes booleans that describe the viewer's role; this component
// renders the right action set without any sensitive logic in the client.

type Props = {
  locale: Locale;
  dict: Dictionary;
  duelId: string;
  status: "open" | "matched" | "settled" | "cancelled";
  iAmOpener: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  joinDeadlinePassed: boolean;
};

export function DuelActions({
  locale,
  dict,
  duelId,
  status,
  iAmOpener,
  isAdmin,
  canEdit,
  joinDeadlinePassed,
}: Props) {
  const router = useRouter();
  const isHebrew = locale === "he";
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [resolvedValue, setResolvedValue] = useState<boolean | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [showSettle, setShowSettle] = useState(false);

  const labels = {
    joinCta: isHebrew
      ? "הצטרף וקח את הצד ההפוך"
      : "Join - take the opposite side",
    joinSelfBlocked: isHebrew
      ? "אי אפשר להצטרף לדו-קרב שאתה פתחת."
      : "You can't join a duel you opened yourself.",
    cancelCta: isHebrew ? "בטל דו-קרב" : "Cancel duel",
    cancelReason: isHebrew ? "סיבה לביטול" : "Reason",
    cancelConfirm: isHebrew ? "אשר ביטול" : "Confirm cancel",
    settleCta: isHebrew ? "הכרע" : "Settle",
    settleQuestion: isHebrew
      ? "מה הייתה התוצאה האמיתית?"
      : "What was the real outcome?",
    yes: isHebrew ? "כן" : "Yes",
    no: isHebrew ? "לא" : "No",
    confirm: isHebrew ? "אשר" : "Confirm",
    notPaid: isHebrew
      ? "התשלום שלך לא אושר עדיין - אי אפשר להצטרף."
      : "Your entry payment is not approved yet - you can't join.",
    pending: isHebrew ? "שולח..." : "Sending...",
    closedLabel: isHebrew
      ? "ההצטרפות נסגרה. הדו-קרב יתבטל אוטומטית."
      : "Joining is closed. The duel will be auto-cancelled.",
  };

  const join = () => {
    setError(null);
    startTransition(async () => {
      const res = await joinDuel(duelId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const cancel = () => {
    setError(null);
    if (reason.trim().length < 3) {
      setError("invalid_input");
      return;
    }
    startTransition(async () => {
      const res = await cancelDuel(duelId, reason.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const settle = () => {
    setError(null);
    if (resolvedValue === null) {
      setError("invalid_input");
      return;
    }
    startTransition(async () => {
      const res = await settleDuel(duelId, resolvedValue);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const sections: React.ReactNode[] = [];

  // Join CTA - only when status='open', viewer isn't opener, deadline
  // not passed, and viewer is paid up.
  if (status === "open" && !iAmOpener && !joinDeadlinePassed) {
    sections.push(
      <Card key="join" className="p-5 md:p-6 flex flex-col gap-3">
        {!canEdit ? (
          <p className="text-sm text-on-surface-variant">{labels.notPaid}</p>
        ) : (
          <PillButton
            type="button"
            onClick={join}
            disabled={pending}
            className={clsx("min-h-[48px]", pending && "opacity-60 cursor-not-allowed")}
          >
            {pending ? labels.pending : labels.joinCta}
          </PillButton>
        )}
      </Card>,
    );
  }

  if (status === "open" && iAmOpener) {
    sections.push(
      <Card key="self" className="p-5 md:p-6 text-sm text-on-surface-variant">
        {labels.joinSelfBlocked}
      </Card>,
    );
  }

  // Closed-with-no-joiner banner before the auto-cancel cron runs.
  if (status === "open" && joinDeadlinePassed) {
    sections.push(
      <Card
        key="closed"
        className="p-5 md:p-6 text-sm text-on-surface-variant bg-tertiary-fixed text-on-tertiary-fixed-variant"
      >
        {labels.closedLabel}
      </Card>,
    );
  }

  // Cancel CTA - opener on open duel, OR admin on any active duel.
  const canCancel =
    (status === "open" && iAmOpener) ||
    (isAdmin && (status === "open" || status === "matched"));
  if (canCancel) {
    sections.push(
      <Card key="cancel" className="p-5 md:p-6 flex flex-col gap-3">
        <SectionHeading underline="thin" as="h2">
          {labels.cancelCta}
        </SectionHeading>
        {showCancel ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
              {labels.cancelReason}
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
                onClick={() => {
                  setShowCancel(false);
                  setReason("");
                  setError(null);
                }}
                className="press-down min-h-[44px] px-4 rounded-full bg-surface-container-low border border-outline text-on-surface text-sm font-bold"
              >
                {isHebrew ? "ביטול" : "Back"}
              </button>
              <PillButton
                type="button"
                onClick={cancel}
                variant="secondary"
                disabled={pending}
                className={clsx("min-h-[44px]", pending && "opacity-60 cursor-not-allowed")}
              >
                {pending ? labels.pending : labels.cancelConfirm}
              </PillButton>
            </div>
          </div>
        ) : (
          <PillButton
            type="button"
            variant="ghost"
            onClick={() => setShowCancel(true)}
            className="self-start min-h-[44px]"
          >
            {labels.cancelCta}
          </PillButton>
        )}
      </Card>,
    );
  }

  // Settle CTA - admin only, status='matched'.
  if (isAdmin && status === "matched") {
    sections.push(
      <Card key="settle" className="p-5 md:p-6 flex flex-col gap-3">
        <SectionHeading underline="thin" as="h2">
          {labels.settleCta}
        </SectionHeading>
        {showSettle ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-on-surface-variant">
              {labels.settleQuestion}
            </p>
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
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowSettle(false);
                  setResolvedValue(null);
                  setError(null);
                }}
                className="press-down min-h-[44px] px-4 rounded-full bg-surface-container-low border border-outline text-on-surface text-sm font-bold"
              >
                {isHebrew ? "ביטול" : "Back"}
              </button>
              <PillButton
                type="button"
                onClick={settle}
                disabled={pending || resolvedValue === null}
                className={clsx(
                  "min-h-[44px]",
                  (pending || resolvedValue === null) &&
                    "opacity-60 cursor-not-allowed",
                )}
              >
                {pending ? labels.pending : labels.confirm}
              </PillButton>
            </div>
          </div>
        ) : (
          <PillButton
            type="button"
            onClick={() => setShowSettle(true)}
            className="self-start min-h-[44px]"
          >
            {labels.settleCta}
          </PillButton>
        )}
      </Card>,
    );
  }

  return (
    <>
      {sections}
      {error && (
        <p className="inline-flex items-center gap-1.5 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {translateError(error, dict)}
        </p>
      )}
      {!error && !pending && status === "settled" && (
        <p className="inline-flex items-center gap-1.5 text-sm text-secondary">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          {isHebrew ? "הוכרע" : "Settled"}
        </p>
      )}
    </>
  );
}

function translateError(code: string, dict: Dictionary): string {
  const map = dict.errors.duel as Record<string, string>;
  return map[code] ?? map.db;
}
