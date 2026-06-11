import Link from "next/link";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";
import type { TransparencyCategory } from "@/db/queries";

// Tab strip for /transparency, one tab per TransparencyCategory. Same
// visual contract as BetsTabs (rounded chip, snap-scroll on mobile,
// real URL links — no client state) so the two surfaces feel like one
// family. Each tab carries existing filter params (user, date) forward
// so changing tabs does not blow away an active filter.

type TabDef = {
  key: TransparencyCategory;
  he: string;
  en: string;
};

const TABS: TabDef[] = [
  { key: "match",      he: "ניחושי משחקים", en: "Match picks" },
  { key: "live",       he: "הימורי לייב",   en: "Live bets" },
  { key: "tournament", he: "הימורי טורניר", en: "Tournament" },
  { key: "group",      he: "דירוגי בתים",   en: "Group rankings" },
  { key: "duel",       he: "דו-קרב",        en: "Duels" },
];

export function TransparencyTabs({
  locale,
  active,
  userId,
  date,
}: {
  locale: Locale;
  active: TransparencyCategory;
  userId?: string;
  date?: string;
}) {
  const isHebrew = locale === "he";
  const base = localePath(locale, "transparency");
  return (
    <nav
      aria-label={isHebrew ? "סוגי הימורים" : "Bet surfaces"}
      className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-1 px-1"
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        const params = new URLSearchParams();
        params.set("tab", t.key);
        if (userId) params.set("user", userId);
        if (date) params.set("date", date);
        const href = `${base}?${params.toString()}`;
        return (
          <Link
            key={t.key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={clsx(
              "snap-start press-down inline-flex items-center justify-center h-11 px-5 rounded-full border text-sm font-bold whitespace-nowrap",
              isActive
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container",
            )}
          >
            {isHebrew ? t.he : t.en}
          </Link>
        );
      })}
    </nav>
  );
}
