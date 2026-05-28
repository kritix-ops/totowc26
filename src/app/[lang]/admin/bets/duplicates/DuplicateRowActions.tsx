"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Edit3, X } from "lucide-react";
import { PillButton } from "@/components/ui";
import { localePath } from "@/lib/paths";
import type { Locale } from "@/app/[lang]/dictionaries";
import { cancelCustomBet } from "../actions";

// Per-row action strip on the duplicates page. "Cancel" soft-flips the bet
// to status='cancelled' so it drops out of the player-facing surfaces. We
// re-confirm twice when the row already has picks — friends already locked
// money on it, and cancelling refunds them, so the admin must be deliberate.
export function DuplicateRowActions({
  locale,
  id,
  hasPicks,
}: {
  locale: Locale;
  id: string;
  hasPicks: boolean;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const onCancel = () => {
    const firstMsg = isHebrew
      ? "לבטל את הרשומה הזו? היא תעלם ממסך המשתתפים."
      : "Cancel this copy? It will disappear from the player view.";
    if (!window.confirm(firstMsg)) return;
    if (hasPicks) {
      const secondMsg = isHebrew
        ? "יש כבר ניחושים פעילים על הרשומה הזו. הביטול יחזיר את הסטייקים. להמשיך?"
        : "This copy already has picks. Cancelling will refund their stakes. Continue?";
      if (!window.confirm(secondMsg)) return;
    }

    setError(null);
    startTransition(async () => {
      const res = await cancelCustomBet(id);
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
      setDone(true);
      router.refresh();
    });
  };

  if (done) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-secondary">
        <Check className="h-4 w-4" strokeWidth={2.5} />
        {isHebrew ? "בוטל" : "Cancelled"}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Link
        href={localePath(locale, `admin/bets/${id}`)}
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
        <X className="h-4 w-4" strokeWidth={2.5} />
        {pending
          ? isHebrew ? "מבטל..." : "Cancelling..."
          : isHebrew ? "בטל את הרשומה" : "Cancel this copy"}
      </PillButton>
      {error && (
        <span className="inline-flex items-center gap-1 text-xs text-error">
          <AlertCircle className="h-3 w-3" strokeWidth={2} />
          {error}
        </span>
      )}
    </div>
  );
}
