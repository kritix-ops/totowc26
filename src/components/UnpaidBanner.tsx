import Link from "next/link";
import { Lock, ArrowLeft, ArrowRight } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";

// Pinned banner shown across every page for signed-in players whose
// payment hasn't been approved yet. Friendly framing ("view-only mode")
// rather than alarming red - per the friends-pool memory note, the goal
// is to remind, not pressure. Page-level `PayGateBanner` is the richer,
// in-context version that lives above forms; this one is the always-on
// reminder that follows the user.
//
// Hidden when an admin is using view-as: the ViewAsBanner already tells
// the story ("viewing as an unpaid player") so stacking both would be
// noisy. The AppShell handles that priority.
export function UnpaidBanner({ locale }: { locale: Locale }) {
  const isHebrew = locale === "he";
  const Arrow = isHebrew ? ArrowLeft : ArrowRight;
  return (
    <div
      role="status"
      className={clsx(
        "w-full flex items-center justify-between gap-3 px-4 md:px-16 py-2 border-b text-on-tertiary-fixed-variant bg-tertiary-fixed border-tertiary-fixed-dim",
      )}
    >
      <span className="inline-flex items-center gap-2 min-w-0">
        <Lock className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="font-[family-name:var(--font-label)] text-[12px] md:text-[13px] font-bold tracking-[0.05em] truncate">
          {isHebrew
            ? "צפייה בלבד — שלם כדי לפתוח את כל ההימורים"
            : "View-only — pay to unlock every bet"}
        </span>
      </span>
      <Link
        href={localePath(locale, "pay")}
        className="press-down inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full bg-primary text-on-primary font-[family-name:var(--font-label)] text-[12px] font-bold tracking-[0.05em] hover:bg-surface-tint transition-colors shrink-0"
      >
        {isHebrew ? "תשלום" : "Pay now"}
        <Arrow className="h-3.5 w-3.5" strokeWidth={2.5} />
      </Link>
    </div>
  );
}
