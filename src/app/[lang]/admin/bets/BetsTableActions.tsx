"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Send, X, Edit3, Trash2, AlertCircle, Check } from "lucide-react";
import { PillButton } from "@/components/ui";
import { localePath } from "@/lib/paths";
import type { Locale } from "../../dictionaries";
import { usePendingAction } from "@/lib/use-pending-action";
import { publishCustomBet, cancelCustomBet, deleteCustomBet } from "./actions";

type Status =
  | "draft"
  | "open"
  | "locked"
  | "graded"
  | "reversed"
  | "cancelled";

export function BetsTableActions({
  locale,
  id,
  status,
}: {
  locale: Locale;
  id: string;
  status: Status;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const searchParams = useSearchParams();
  // Carry the live list filters into the detail / edit links as ?return=,
  // so the back button there lands on the exact filtered view the admin
  // left — no flash, no refetch. The detail page sanitises this value
  // before reflecting it into its back href. (localStorage is the wider
  // safety net for any other way back into the list.)
  const returnQs = searchParams.toString();
  const withReturn = (path: string) =>
    localePath(locale, path) +
    (returnQs ? `?return=${encodeURIComponent(returnQs)}` : "");
  const [error, setError] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState<"published" | "cancelled" | "deleted" | null>(null);
  const { pending, run } = usePendingAction();

  const handle = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    success: "published" | "cancelled" | "deleted",
    confirmMsg?: string,
  ) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    setOkFlash(null);
    void run(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(
          res.error === "forbidden"
            ? isHebrew ? "אין הרשאה" : "Not allowed"
            : res.error === "bet_not_found"
              ? isHebrew ? "ההימור לא נמצא" : "Bet not found"
              : res.error === "invalid_status"
                ? isHebrew ? "סטטוס לא תקין למעבר" : "Invalid status transition"
                : res.error === "has_picks"
                  ? isHebrew ? "יש הימורים על ההצעה, אי אפשר למחוק" : "Has picks; cannot delete"
                  : isHebrew ? "שגיאת שמירה" : "Save failed",
        );
        return;
      }
      setOkFlash(success);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {error && (
        <span className="inline-flex items-center gap-1 text-xs text-error">
          <AlertCircle className="h-3 w-3" strokeWidth={2} />
          {error}
        </span>
      )}
      {okFlash && !error && (
        <span className="inline-flex items-center gap-1 text-xs text-secondary">
          <Check className="h-3 w-3" strokeWidth={2.5} />
          {okFlash === "published"
            ? isHebrew ? "פורסם" : "Published"
            : okFlash === "deleted"
              ? isHebrew ? "נמחק" : "Deleted"
              : isHebrew ? "בוטל" : "Cancelled"}
        </span>
      )}

      {/* Details is available in EVERY state — including graded and
          cancelled — so an admin can always open the grade / reverse form
          to fix the result of a live bet that already passed. The detail
          page's GradeForm offers reverse + re-grade once a bet is graded. */}
      <Link
        href={withReturn(`admin/bets/${id}`)}
        className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-full border border-outline bg-surface-container-lowest text-on-surface text-sm font-bold hover:bg-surface-container"
      >
        <Edit3 className="h-4 w-4" strokeWidth={2} />
        {status === "graded"
          ? isHebrew ? "תקן תוצאה" : "Fix result"
          : isHebrew ? "פרטים" : "Details"}
      </Link>

      {status === "draft" && (
        <>
          <Link
            href={withReturn(`admin/bets/${id}/edit`)}
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-full border border-outline bg-surface-container-lowest text-on-surface text-sm font-bold hover:bg-surface-container"
          >
            <Edit3 className="h-4 w-4" strokeWidth={2} />
            {isHebrew ? "ערוך" : "Edit"}
          </Link>
          <PillButton
            type="button"
            variant="primary"
            disabled={pending}
            onClick={() => handle(() => publishCustomBet(id), "published")}
            className="min-h-[40px] py-2 px-4 text-sm"
          >
            <Send className="h-4 w-4" strokeWidth={2.5} />
            {isHebrew ? "פרסם" : "Publish"}
          </PillButton>
        </>
      )}

      {/* Cancel only where the lifecycle allows it — the server rejects a
          cancel on graded / cancelled bets, so we hide the control there. */}
      {status !== "graded" && status !== "cancelled" && (
        <PillButton
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            handle(
              () => cancelCustomBet(id),
              "cancelled",
              isHebrew
                ? "לבטל את ההימור? הסטטוס יעבור ל'בוטל'."
                : "Cancel this bet? Status will move to 'cancelled'.",
            )
          }
          className="min-h-[40px] py-2 px-4 text-sm"
        >
          <X className="h-4 w-4" strokeWidth={2.5} />
          {isHebrew ? "בטל" : "Cancel"}
        </PillButton>
      )}

      {/* Hard-delete — only where it's safe (draft / cancelled, no picks). The
          server rejects anything else, so we hide it on open/locked/graded. */}
      {(status === "draft" || status === "cancelled") && (
        <PillButton
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            handle(
              () => deleteCustomBet(id),
              "deleted",
              isHebrew
                ? "למחוק את ההצעה לצמיתות? אי אפשר לשחזר."
                : "Delete this suggestion permanently? This cannot be undone.",
            )
          }
          className="min-h-[40px] py-2 px-4 text-sm text-error"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2.5} />
          {isHebrew ? "מחק" : "Delete"}
        </PillButton>
      )}
    </div>
  );
}
