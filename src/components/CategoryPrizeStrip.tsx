import { Crown, Medal, Sparkles, Swords, Trophy } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { CategoryPrizeBreakdown, CategoryPrizeKey } from "@/db/queries";

// 7-way prize-pool breakdown matching the betting overhaul §12 split:
// king (1/2/3) + matches winner + live winner + duels winner + reserve.
// Renders one tile per category with the live ILS amount derived from
// the current pot. Always rendered: before any payments land, the
// tiles show the configured percentages with `0 ILS` so first-time
// visitors still see the shape of the prize map.

type KeyMeta = {
  key: CategoryPrizeKey;
  he: string;
  en: string;
  icon: React.ReactNode;
  highlight: "king-first" | "king-second-third" | "category" | "reserve";
};

const KEYS: KeyMeta[] = [
  {
    key: "king_first",
    he: "מלך המונדיאל",
    en: "King of the Mundial",
    icon: <Crown className="h-4 w-4" strokeWidth={1.75} />,
    highlight: "king-first",
  },
  {
    key: "king_second",
    he: "מקום שני - כללי",
    en: "Overall 2nd",
    icon: <Medal className="h-4 w-4" strokeWidth={1.75} />,
    highlight: "king-second-third",
  },
  {
    key: "king_third",
    he: "מקום שלישי - כללי",
    en: "Overall 3rd",
    icon: <Medal className="h-4 w-4" strokeWidth={1.75} />,
    highlight: "king-second-third",
  },
  {
    key: "matches_winner",
    he: "אלוף הניחושים",
    en: "Matches winner",
    icon: <Trophy className="h-4 w-4" strokeWidth={1.75} />,
    highlight: "category",
  },
  {
    key: "live_winner",
    he: "אלוף הלייב",
    en: "Live-bets winner",
    icon: <Sparkles className="h-4 w-4" strokeWidth={1.75} />,
    highlight: "category",
  },
  {
    key: "duels_winner",
    he: "אלוף הדו-קרב",
    en: "Duels winner",
    icon: <Swords className="h-4 w-4" strokeWidth={1.75} />,
    highlight: "category",
  },
  {
    key: "reserve",
    he: "רזרבה",
    en: "Reserve",
    icon: <Trophy className="h-4 w-4" strokeWidth={1.75} />,
    highlight: "reserve",
  },
];

export function CategoryPrizeStrip({
  prize,
  locale,
}: {
  prize: CategoryPrizeBreakdown;
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const byKey = new Map(prize.prizes.map((p) => [p.key, p]));
  return (
    <section
      aria-label={isHebrew ? "חלוקת הקופה לפי קטגוריות" : "Category prize split"}
      className="bg-surface-container-low border border-outline-variant rounded-xl p-4 md:p-5 shadow-[0_4px_12px_rgba(28,20,15,0.06)] flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl leading-tight font-bold text-on-surface inline-flex items-center gap-2">
          <Trophy className="h-5 w-5 text-tertiary" strokeWidth={1.75} />
          {isHebrew ? "חלוקת הקופה" : "Prize pool"}
        </h2>
        <span className="text-xs text-on-surface-variant">
          {isHebrew ? "מקופה נוכחית:" : "from current pot:"}{" "}
          <bdi>
            {prize.potIls.toLocaleString()} {isHebrew ? "ש״ח" : "ILS"}
          </bdi>
        </span>
      </div>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        {KEYS.map((meta) => {
          const p = byKey.get(meta.key) ?? { pct: 0, ils: 0, key: meta.key };
          return (
            <li
              key={meta.key}
              className={clsx(
                "rounded-lg p-3 flex flex-col gap-1 border",
                meta.highlight === "king-first"
                  ? "bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-fixed-dim md:col-span-2"
                  : meta.highlight === "king-second-third"
                    ? "bg-primary-fixed text-on-primary-fixed-variant border-primary-fixed-dim"
                    : meta.highlight === "category"
                      ? "bg-secondary-container text-on-secondary-container border-secondary-fixed"
                      : "bg-surface-container-lowest text-on-surface border-outline-variant",
              )}
            >
              <span className="font-[family-name:var(--font-label)] text-[10px] font-bold tracking-[0.05em] uppercase opacity-80 inline-flex items-center gap-1.5">
                {meta.icon}
                {isHebrew ? meta.he : meta.en}
                {" · "}
                <bdi>{p.pct}%</bdi>
              </span>
              <span className="font-[family-name:var(--font-score)] text-xl md:text-2xl leading-none font-bold tabular-nums">
                <bdi>
                  {p.ils.toLocaleString()} {isHebrew ? "ש״ח" : "ILS"}
                </bdi>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
