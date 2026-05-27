"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { localePath } from "@/lib/paths";

export type TournamentTabKey = "summary" | "tables" | "teams" | "players" | "news";

export const TOURNAMENT_TABS: ReadonlyArray<TournamentTabKey> = [
  "summary",
  "tables",
  "teams",
  "players",
  "news",
];

type TabSpec = {
  key: TournamentTabKey;
  label: string;
  badge?: string;
};

export function TournamentTabs({
  locale,
  tabs,
  ariaLabel,
}: {
  locale: Locale;
  tabs: ReadonlyArray<TabSpec>;
  ariaLabel: string;
}) {
  const searchParams = useSearchParams();
  const raw = searchParams.get("tab");
  const active: TournamentTabKey = isTabKey(raw) ? raw : "summary";

  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  // Bring the active pill into view on mount and on tab change.
  // Handles the deep-link case where ?tab=teams arrives on a 360px
  // screen and the pill would otherwise sit off-canvas.
  useEffect(() => {
    const node = activeRef.current;
    if (!node) return;
    node.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="sticky top-14 md:top-16 z-30 -mx-4 md:-mx-16 px-4 md:px-16 bg-surface/95 backdrop-blur-sm border-b border-outline-variant"
    >
      <div
        ref={listRef}
        className="flex items-center gap-2 overflow-x-auto snap-x snap-mandatory py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const isActive = t.key === active;
          const href =
            t.key === "summary"
              ? localePath(locale, "tournament")
              : `${localePath(locale, "tournament")}?tab=${t.key}`;
          return (
            <Link
              key={t.key}
              ref={isActive ? activeRef : undefined}
              role="tab"
              aria-selected={isActive}
              href={href}
              onClick={() => {
                console.info("[tournament tab change]", {
                  from: active,
                  to: t.key,
                });
              }}
              className={clsx(
                "press-down snap-start inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full font-[family-name:var(--font-label)] text-[13px] font-bold tracking-[0.04em] whitespace-nowrap transition-colors shrink-0",
                isActive
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-on-surface-variant border border-outline-variant hover:bg-surface-container",
              )}
            >
              <span>{t.label}</span>
              {t.badge && (
                <span
                  className={clsx(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-[0.04em]",
                    isActive
                      ? "bg-on-primary/15 text-on-primary"
                      : "bg-tertiary-fixed text-on-tertiary-fixed-variant",
                  )}
                >
                  {t.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function isTabKey(v: string | null): v is TournamentTabKey {
  return (
    v === "summary" || v === "tables" || v === "teams" || v === "players" || v === "news"
  );
}
