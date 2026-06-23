"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Chip, PillButton } from "@/components/ui";
import { BETS_FILTER_STORAGE_KEY } from "@/lib/bets/admin-bet-filters";
import type { Locale } from "../../dictionaries";

// Summary of the active narrowing filters with a one-tap path back to a
// clean list. Each chip is a Link to the same list URL with that one
// filter removed (the server pre-computes the href + label, so this island
// owns no filter logic). "Clear all" resets the URL and wipes the
// remembered filter so it doesn't get auto-restored on the next visit.
// Hidden entirely when nothing is filtered.
export function BetsActiveFilters({
  locale,
  items,
  clearHref,
}: {
  locale: Locale;
  items: Array<{ key: string; label: string; href: string }>;
  // Reset target that keeps the current bet type but drops every filter.
  clearHref: string;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();

  if (items.length === 0) return null;

  const clearAll = () => {
    try {
      window.localStorage.removeItem(BETS_FILTER_STORAGE_KEY);
    } catch {
      // Private-mode / disabled storage — clearing the URL below is enough.
    }
    console.info("[admin bets memory] clear");
    router.replace(clearHref, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 -mt-2">
      <span className="font-[family-name:var(--font-label)] text-[11px] font-bold uppercase tracking-[0.08em] text-on-surface-variant">
        {isHebrew ? "מסונן" : "Filtered"}
      </span>
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          replace
          scroll={false}
          aria-label={
            isHebrew ? `הסר סינון: ${it.label}` : `Remove filter: ${it.label}`
          }
        >
          <Chip
            tone="primary"
            className="min-h-[44px] ps-3 pe-2 cursor-pointer font-bold hover:brightness-95"
          >
            <bdi>{it.label}</bdi>
            <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
          </Chip>
        </Link>
      ))}
      <PillButton
        type="button"
        variant="ghost"
        onClick={clearAll}
        className="min-h-[44px] py-2 px-4 text-sm"
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
        {isHebrew ? "נקה הכל" : "Clear all"}
      </PillButton>
    </div>
  );
}
