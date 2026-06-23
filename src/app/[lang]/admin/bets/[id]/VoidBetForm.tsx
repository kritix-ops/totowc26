"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Ban } from "lucide-react";
import { Card, LabelCaps, PillButton } from "@/components/ui";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import type { Locale } from "../../../dictionaries";
import { usePendingAction } from "@/lib/use-pending-action";
import { voidCustomBet } from "../actions";

type Status = "draft" | "open" | "locked" | "graded" | "reversed" | "cancelled";

// Admin "cancel this live bet and refund everyone who picked". Surfaced on the
// bet detail page for every status except already-cancelled — including graded,
// which is the whole point: a player prop that auto-graded "no" because the
// player never played gets unwound here in one click. Pairs with the
// voidCustomBet server action; the refund is what nets each picker's bank back
// to zero. Reason is required and lands in the immutable audit trail.
export function VoidBetForm({
  locale,
  bet,
}: {
  locale: Locale;
  bet: { id: string; status: Status };
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    picksRefunded: number;
  } | null>(null);
  const { pending, run } = usePendingAction();

  // Only meaningful once a bet is live (open / locked / graded / reversed).
  // A draft has no pickers and uses Edit + the list's plain cancel; a
  // cancelled bet has nothing left to void.
  if (bet.status === "draft" || bet.status === "cancelled") return null;

  const onVoid = () => {
    if (reason.trim().length < 3) {
      setError(
        isHebrew ? "סיבה חייבת לפחות 3 תווים" : "Reason must be 3+ characters",
      );
      return;
    }
    if (
      !window.confirm(
        isHebrew
          ? "לבטל את ההימור ולהחזיר את הנקודות לכל מי שהימר? הפעולה תסגור את ההימור ולא ניתן לבטל אותה."
          : "Cancel this bet and refund every picker? This closes the bet and cannot be undone.",
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    void run(async () => {
      const res = await voidCustomBet(bet.id, reason);
      if (!res.ok) {
        setError(translateError(res.error, isHebrew));
        return;
      }
      setSuccess({ picksRefunded: res.picksRefunded });
      router.refresh();
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4 border-2 border-error/30">
      <div className="flex items-center gap-2">
        <Ban className="h-5 w-5 text-error" strokeWidth={1.75} />
        <h2 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-on-surface">
          {isHebrew ? "בטל והחזר נקודות" : "Cancel & refund"}
        </h2>
      </div>

      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "מבטל את ההימור ומחזיר לכל מי שהימר את הנקודות שהימר — גם אם ההימור כבר נמדד (למשל שחקן שלא שיחק). כל המהמרים יקבלו התראה בפיד."
          : "Cancels the bet and refunds every picker — even if it was already graded (e.g. a player who never played). All pickers get a feed notice."}
      </p>

      <div className="flex flex-col gap-1.5">
        <LabelCaps>{isHebrew ? "סיבה" : "Reason"}</LabelCaps>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            isHebrew
              ? "למשל: השחקן לא נכלל בהרכב"
              : "e.g. player was not in the lineup"
          }
          dir={isHebrew ? "rtl" : "ltr"}
          maxLength={500}
          className="min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base"
        />
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? "נשמר באודיט פנימי. אל תכתוב מידע אישי - הטקסט נשמר לעד."
            : "Saved in the internal audit log. Do not enter personal info."}
        </p>
      </div>

      {error && (
        <p className="inline-flex items-center gap-2 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {error}
        </p>
      )}
      {success && !error && (
        <p className="inline-flex items-center gap-2 text-sm text-secondary">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          {isHebrew
            ? `ההימור בוטל. ${success.picksRefunded} מהמרים קיבלו את הנקודות בחזרה.`
            : `Cancelled. ${success.picksRefunded} pickers refunded.`}
        </p>
      )}

      <div className="flex flex-col-reverse md:flex-row md:justify-end gap-3">
        <PillButton
          type="button"
          variant="ghost"
          disabled={pending || reason.trim().length < 3}
          onClick={onVoid}
          className="min-h-[48px] !border-error/50 !text-error hover:!bg-error/10"
        >
          <Ban className="h-4 w-4" strokeWidth={2.5} />
          {pending
            ? isHebrew
              ? "מבטל…"
              : "Cancelling…"
            : isHebrew
              ? "בטל הימור והחזר נקודות"
              : "Cancel bet & refund"}
        </PillButton>
      </div>
    </Card>
  );
}

const ERROR_MAP = {
  ...COMMON_ADMIN_ERRORS,
  forbidden: ["אין הרשאה", "Not allowed"],
  bet_not_found: ["ההימור לא נמצא", "Bet not found"],
  invalid_status: ["ההימור כבר בוטל", "Bet is already cancelled"],
  invalid_reason: ["סיבה חייבת לפחות 3 תווים", "Reason must be 3+ characters"],
} as const satisfies Record<string, LocalizedTuple>;

function translateError(err: string, isHebrew: boolean): string {
  return translateAdminError(err, ERROR_MAP, isHebrew);
}
