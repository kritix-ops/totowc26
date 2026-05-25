import Link from "next/link";
import { Lock, ArrowLeft, ArrowRight } from "lucide-react";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";

// Read-only banner shown to players whose payment has not yet been
// approved. Action surfaces (bets, bracket, standings, specials) render
// this above their forms; the forms themselves are disabled in parallel.
// The server-side gate in each action is the actual security boundary —
// this banner is just UX.
export function PayGateBanner({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const isHebrew = locale === "he";
  const Arrow = isHebrew ? ArrowLeft : ArrowRight;
  return (
    <div
      role="status"
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 md:p-5 rounded-lg border border-tertiary bg-tertiary-fixed/40 text-on-surface"
    >
      <div className="flex items-start gap-3 min-w-0">
        <Lock
          className="h-5 w-5 mt-0.5 text-tertiary shrink-0"
          strokeWidth={2}
          aria-hidden
        />
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-[family-name:var(--font-display)] text-base md:text-lg font-bold leading-tight">
            {dict.payGate.title}
          </span>
          <span className="text-sm text-on-surface-variant">
            {dict.payGate.subtitle}
          </span>
        </div>
      </div>
      <Link
        href={localePath(locale, "pay")}
        className="press-down shrink-0 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-full bg-primary text-on-primary font-[family-name:var(--font-label)] text-[13px] font-bold tracking-[0.05em] hover:bg-surface-tint transition-colors"
      >
        {dict.payGate.cta}
        <Arrow className="h-4 w-4" strokeWidth={2.5} />
      </Link>
    </div>
  );
}
