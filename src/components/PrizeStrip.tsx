import { Trophy } from "lucide-react";
import { clsx } from "clsx";
import type { Dictionary, Locale } from "@/app/[lang]/dictionaries";
import type { PrizeBreakdown } from "@/db/queries";

// Compact prize-pool breakdown for the top 4. Renders one chip per rank
// with the live ILS amount derived from the current pot. Hides itself
// completely when the pot is zero (no payments approved yet) so the home
// page doesn't show "1st place: 0 ILS" empty state.
export function PrizeStrip({
  prize,
  locale,
  dict,
}: {
  prize: PrizeBreakdown;
  locale: Locale;
  dict: Dictionary;
}) {
  if (prize.potIls <= 0) return null;
  const isHebrew = locale === "he";
  const positive = prize.prizes.filter((p) => p.ils > 0);
  if (positive.length === 0) return null;

  return (
    <section
      aria-label={dict.prizes.label}
      className="bg-surface-container-low border border-outline-variant rounded-xl p-4 md:p-5 shadow-[0_4px_12px_rgba(28,20,15,0.06)] flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl leading-tight font-bold text-on-surface inline-flex items-center gap-2">
          <Trophy className="h-5 w-5 text-tertiary" strokeWidth={1.75} />
          {dict.prizes.label}
        </h2>
        <span className="text-xs text-on-surface-variant">
          {dict.prizes.fromPot.replace(
            "{pot}",
            prize.potIls.toLocaleString(),
          )}
        </span>
      </div>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        {prize.prizes.map((p) => (
          <li
            key={p.rank}
            className={clsx(
              "rounded-lg p-3 flex flex-col gap-1 border",
              p.rank === 1
                ? "bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-fixed-dim"
                : "bg-surface-container-lowest text-on-surface border-outline-variant",
            )}
          >
            <span className="font-[family-name:var(--font-label)] text-[10px] font-bold tracking-[0.05em] uppercase opacity-80">
              {dict.prizes.rankLabel.replace("{n}", String(p.rank))}
              {" · "}
              <bdi>{p.pct}%</bdi>
            </span>
            <span className="font-[family-name:var(--font-score)] text-xl md:text-2xl leading-none font-bold tabular-nums">
              <bdi>
                {p.ils.toLocaleString()} {isHebrew ? "ש״ח" : "ILS"}
              </bdi>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
