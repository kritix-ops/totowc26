"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Edit3, X } from "lucide-react";
import { Chip, LabelCaps, PillButton } from "@/components/ui";
import { localePath } from "@/lib/paths";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { AdminDuplicateBetRow } from "@/db/admin-queries";
import { usePendingAction } from "@/lib/use-pending-action";
import { cancelCustomBet } from "../actions";

// Row + actions for the duplicates screen. Client-side so the row can hide
// itself the moment the cancel succeeds — the server's revalidatePath will
// catch up on the next refresh, but the optimistic flip is what makes the
// click feel instant. A two-step confirm wraps rows that already carry
// picks (real refund involved).
export function DuplicateRow({
  locale,
  row,
  index,
}: {
  locale: Locale;
  row: AdminDuplicateBetRow;
  index: number;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = usePendingAction();

  if (hidden) return null;

  const lockLabel = formatDateTime(row.lockAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const createdLabel = formatDateTime(row.createdAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const onCancel = () => {
    const firstMsg = isHebrew
      ? "לבטל את הרשומה הזו? היא תיעלם ממסך המשתתפים."
      : "Cancel this copy? It will disappear from the player view.";
    if (!window.confirm(firstMsg)) return;
    if (row.pickCount > 0) {
      const secondMsg = isHebrew
        ? "יש כבר ניחושים פעילים על הרשומה הזו. הביטול יחזיר את ההשקעות. להמשיך?"
        : "This copy already has picks. Cancelling will refund their stakes. Continue?";
      if (!window.confirm(secondMsg)) return;
    }

    setError(null);
    void run(async () => {
      const res = await cancelCustomBet(row.id);
      if (!res.ok) {
        setError(
          res.error === "forbidden"
            ? isHebrew ? "אין הרשאה" : "Not allowed"
            : res.error === "bet_not_found"
              ? isHebrew ? "ההימור לא נמצא" : "Bet not found"
              : res.error === "invalid_status"
                ? isHebrew ? "סטטוס לא תקין למעבר" : "Invalid status"
                : isHebrew ? "שגיאה" : "Failed",
        );
        return;
      }
      // Hide locally first so the row disappears the same frame the user
      // clicked. router.refresh() then pulls the new server state — once
      // revalidatePath kicks in the row is also gone from the cache, so
      // any future navigation sees the same view.
      setHidden(true);
      router.refresh();
    });
  };

  return (
    <div className="border border-outline-variant rounded-lg p-3 md:p-4 flex flex-col gap-3 bg-surface-container-lowest">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <LabelCaps>
              {isHebrew ? `עותק #${index}` : `Copy #${index}`}
            </LabelCaps>
            <Chip tone={statusTone(row.status)}>
              {statusLabel(row.status, isHebrew)}
            </Chip>
            {row.pickCount > 0 && (
              <Chip tone="warning">
                {isHebrew
                  ? `${row.pickCount} ניחושים`
                  : `${row.pickCount} picks`}
              </Chip>
            )}
          </div>
          <span className="text-[11px] text-on-surface-variant font-mono break-all">
            {row.id}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div className="flex flex-col">
          <dt className="text-xs text-on-surface-variant">
            {isHebrew ? "נסגר" : "Locks"}
          </dt>
          <dd className="font-bold tabular-nums">{lockLabel}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-on-surface-variant">
            {isHebrew ? "נוצר" : "Created"}
          </dt>
          <dd className="font-bold tabular-nums">{createdLabel}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-on-surface-variant">
            {isHebrew ? "עלות" : "Stake"}
          </dt>
          <dd className="font-bold tabular-nums">{row.stakeSnapshot}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-on-surface-variant">
            {isHebrew ? "תשלום" : "Payout"}
          </dt>
          <dd className="font-bold tabular-nums">{row.payoutSnapshot}</dd>
        </div>
      </dl>

      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href={localePath(locale, `admin/bets/${row.id}`)}
          className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-full border border-outline bg-surface-container-lowest text-on-surface text-sm font-bold hover:bg-surface-container"
        >
          <Edit3 className="h-4 w-4" strokeWidth={2} />
          {isHebrew ? "פרטים" : "Details"}
        </Link>
        <PillButton
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onCancel}
          className="min-h-[40px] py-2 px-4 text-sm"
        >
          {pending ? (
            isHebrew ? "מבטל..." : "Cancelling..."
          ) : (
            <>
              <X className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew ? "בטל את הרשומה" : "Cancel this copy"}
            </>
          )}
        </PillButton>
        {error && (
          <span className="inline-flex items-center gap-1 text-xs text-error">
            <AlertCircle className="h-3 w-3" strokeWidth={2} />
            {error}
          </span>
        )}
        {pending && (
          <span className="inline-flex items-center gap-1 text-xs text-secondary">
            <Check className="h-3 w-3" strokeWidth={2.5} />
            {isHebrew ? "מסיר…" : "Removing…"}
          </span>
        )}
      </div>
    </div>
  );
}

function statusTone(s: AdminDuplicateBetRow["status"]): "default" | "primary" | "secondary" | "warning" {
  switch (s) {
    case "draft":     return "default";
    case "open":      return "primary";
    case "locked":    return "warning";
    case "graded":    return "secondary";
    case "reversed":  return "warning";
    case "cancelled": return "default";
  }
}

function statusLabel(s: AdminDuplicateBetRow["status"], isHebrew: boolean): string {
  const map: Record<AdminDuplicateBetRow["status"], [string, string]> = {
    draft:     ["טיוטה", "Draft"],
    open:      ["פתוח", "Open"],
    locked:    ["נסגר", "Locked"],
    graded:    ["נמדד", "Graded"],
    reversed:  ["הוחזר", "Reversed"],
    cancelled: ["בוטל", "Cancelled"],
  };
  return map[s][isHebrew ? 0 : 1];
}
