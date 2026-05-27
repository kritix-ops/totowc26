import Link from "next/link";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";

// Shared tab strip for the three bet surfaces. /bets, /bets/tournament
// and /bets/groups all render this at the top so the user can switch
// between the three without losing context. Server component on
// purpose — no client state needed since each tab is a real URL.

export type BetsTabKey = "match-picks" | "tournament" | "groups";

type TabDef = {
  key: BetsTabKey;
  path: string;
  he: string;
  en: string;
};

const TABS: TabDef[] = [
  { key: "match-picks", path: "bets",            he: "ניחושי משחקים", en: "Match picks" },
  { key: "tournament",  path: "bets/tournament", he: "הימורי טורניר", en: "Tournament" },
  { key: "groups",      path: "bets/groups",     he: "דירוגי בתים",   en: "Group rankings" },
];

export function BetsTabs({
  locale,
  active,
}: {
  locale: Locale;
  active: BetsTabKey;
}) {
  const isHebrew = locale === "he";
  return (
    <nav
      aria-label={isHebrew ? "סוגי הימורים" : "Bet surfaces"}
      className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-1 px-1"
    >
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={localePath(locale, t.path)}
          className={clsx(
            "snap-start press-down inline-flex items-center justify-center h-11 px-5 rounded-full border text-sm font-bold whitespace-nowrap",
            t.key === active
              ? "bg-primary text-on-primary border-primary"
              : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container",
          )}
        >
          {isHebrew ? t.he : t.en}
        </Link>
      ))}
    </nav>
  );
}
