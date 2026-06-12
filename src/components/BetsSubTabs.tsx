import Link from "next/link";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";

// Sub-toggle that lives directly under BetsTabs on every bet surface
// (match picks / live / tournament / groups). Two pills: Upcoming and
// Past. State is driven by the URL `?view=upcoming|past` so each
// position is shareable, back-button-friendly, and renders on the
// server with no client JS.
//
// The toggle is intentionally visually quieter than BetsTabs - smaller
// pills, transparent border for the inactive state - so the top strip
// remains the primary navigation and this strip reads as a filter
// inside the active surface.

export type BetsView = "upcoming" | "past";

export function parseBetsView(raw: string | string[] | undefined): BetsView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "past" ? "past" : "upcoming";
}

export function BetsSubTabs({
  locale,
  path,
  view,
}: {
  locale: Locale;
  // The base path of the surface this strip belongs to, e.g. "bets" or
  // "bets/tournament". Both pills link to the same path with only
  // ?view differing.
  path: string;
  view: BetsView;
}) {
  const isHebrew = locale === "he";
  const items: Array<{ key: BetsView; he: string; en: string }> = [
    { key: "upcoming", he: "בעתיד",  en: "Upcoming" },
    { key: "past",     he: "עברו",    en: "Past"     },
  ];
  return (
    <nav
      aria-label={isHebrew ? "סינון לפי זמן" : "Time filter"}
      className="flex gap-2 -mx-1 px-1"
    >
      {items.map((it) => {
        const isActive = it.key === view;
        const href =
          it.key === "upcoming"
            ? localePath(locale, path)
            : `${localePath(locale, path)}?view=past`;
        return (
          <Link
            key={it.key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={clsx(
              "press-down inline-flex items-center justify-center h-11 px-4 rounded-full border text-sm font-bold whitespace-nowrap min-w-[88px]",
              isActive
                ? "bg-secondary-container text-on-secondary-container border-secondary-container"
                : "bg-transparent text-on-surface-variant border-outline-variant hover:bg-surface-container-low",
            )}
          >
            {isHebrew ? it.he : it.en}
          </Link>
        );
      })}
    </nav>
  );
}
