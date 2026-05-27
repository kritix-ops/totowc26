import Link from "next/link";
import { Coins } from "lucide-react";
import { clsx } from "clsx";
import { localePath } from "@/lib/paths";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";

// Compact "💰 87 / 100" pill that links to the user's bank history page.
// Hidden for unauthenticated viewers and on the auth/onboarding routes
// where the bank isn't yet provisioned.
export function BankPill({
  locale,
  dict,
  balance,
  starting,
}: {
  locale: Locale;
  dict: Dictionary;
  balance: number;
  starting: number;
}) {
  const low = balance < Math.max(5, Math.floor(starting * 0.1));
  const negative = balance < 0;

  return (
    <Link
      href={localePath(locale, "me/bank")}
      aria-label={`${dict.bank.label}: ${balance} / ${starting}`}
      className={clsx(
        "press-down inline-flex items-center gap-1 md:gap-1.5 shrink-0 min-h-[36px] px-2 md:px-3 rounded-full whitespace-nowrap",
        "font-[family-name:var(--font-label)] text-[12px] md:text-[13px] font-bold tracking-[0.05em]",
        "transition-colors",
        negative
          ? "bg-error-container text-on-error-container"
          : low
            ? "bg-tertiary-container text-on-tertiary-container"
            : "bg-surface-container-high text-on-surface",
      )}
    >
      <Coins className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
      <bdi className="tabular-nums whitespace-nowrap">
        {balance}
        <span className="opacity-60">/{starting}</span>
      </bdi>
    </Link>
  );
}
