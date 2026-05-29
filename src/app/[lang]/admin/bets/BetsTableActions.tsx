"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, X, Edit3, AlertCircle, Check } from "lucide-react";
import { PillButton } from "@/components/ui";
import { localePath } from "@/lib/paths";
import type { Locale } from "../../dictionaries";
import { usePendingAction } from "@/lib/use-pending-action";
import { publishCustomBet, cancelCustomBet } from "./actions";

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
  const [error, setError] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState<"published" | "cancelled" | null>(null);
  const { pending, run } = usePendingAction();

  const handle = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    success: "published" | "cancelled",
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
                : isHebrew ? "שגיאת שמירה" : "Save failed",
        );
        return;
      }
      setOkFlash(success);
      router.refresh();
    });
  };

  // Terminal states get no actions - only the visual chip telling the
  // admin where the bet is in its lifecycle.
  if (status === "graded" || status === "cancelled") {
    return null;
  }

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
            : isHebrew ? "בוטל" : "Cancelled"}
        </span>
      )}

      <Link
        href={localePath(locale, `admin/bets/${id}`)}
        className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-full border border-outline bg-surface-container-lowest text-on-surface text-sm font-bold hover:bg-surface-container"
      >
        <Edit3 className="h-4 w-4" strokeWidth={2} />
        {isHebrew ? "פרטים" : "Details"}
      </Link>

      {status === "draft" && (
        <>
          <Link
            href={localePath(locale, `admin/bets/${id}/edit`)}
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
    </div>
  );
}
