import { Crown, Medal, Sparkles, Trophy, Wrench } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { CategoryPrizeBreakdown, CategoryPrizeKey } from "@/db/queries";

// Public prize-pool breakdown. Renders one tile per visible category
// with the live ILS amount derived from the distributable pot
// (pot − admin overhead). The two hidden keys (`duels_winner`,
// `reserve`) are still tracked in the DB so the admin can keep them
// in the 100% split, but they do not surface to players. The setup-
// overhead deduction is shown above the tiles so the math is
// transparent: pot − overhead = distributable.

type KeyMeta = {
  key: CategoryPrizeKey;
  he: string;
  en: string;
  icon: React.ReactNode;
  highlight: "king-first" | "king-second-third" | "category";
};

const VISIBLE_KEYS: KeyMeta[] = [
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
  const currency = isHebrew ? "ש״ח" : "ILS";
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
      </div>

      {/* Pot math: makes the overhead deduction visible and the
          distributable amount explicit, so players can see exactly
          what the percentages below run on. */}
      <dl className="grid grid-cols-3 gap-2 text-center">
        <PotStat
          label={isHebrew ? "קופה" : "Pot"}
          value={`${prize.potIls.toLocaleString()} ${currency}`}
        />
        <PotStat
          label={isHebrew ? "עלות API" : "API cost"}
          value={`-${prize.overheadIls.toLocaleString()} ${currency}`}
          icon={<Wrench className="h-3.5 w-3.5" strokeWidth={2} />}
          tone="muted"
        />
        <PotStat
          label={isHebrew ? "לחלוקה" : "Distributable"}
          value={`${prize.distributableIls.toLocaleString()} ${currency}`}
          tone="strong"
        />
      </dl>

      <ul className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        {VISIBLE_KEYS.map((meta) => {
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
                    : "bg-secondary-container text-on-secondary-container border-secondary-fixed",
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
                  {p.ils.toLocaleString()} {currency}
                </bdi>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PotStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "muted" | "strong";
}) {
  return (
    <div
      className={clsx(
        "rounded-lg p-2 flex flex-col items-center gap-0.5 border",
        tone === "strong"
          ? "bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-fixed-dim"
          : tone === "muted"
            ? "bg-surface-container-lowest text-on-surface-variant border-outline-variant"
            : "bg-surface-container-lowest text-on-surface border-outline-variant",
      )}
    >
      <dt className="font-[family-name:var(--font-label)] text-[10px] font-bold tracking-[0.05em] uppercase opacity-80 inline-flex items-center gap-1">
        {icon}
        {label}
      </dt>
      <dd className="font-[family-name:var(--font-score)] text-sm md:text-base leading-none font-bold tabular-nums">
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}
