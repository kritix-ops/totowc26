"use client";

import { useMemo, useRef, useState } from "react";
import { Search, X, ChevronDown, CalendarDays } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { Card, Chip, LabelCaps, ScoreLine } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import {
  filterRowsByQuery,
  type TransparencyCategory,
  type TransparencyContext,
  type TransparencyQuestionRow,
} from "@/lib/transparency-group";

// One /transparency tab: an instant search box over the tab's questions
// plus the rendered cards. Lives client-side because the search has to
// reach INSIDE each card and filter the picker rows, not just show or
// hide whole cards.
//
// Smart matching, two intents the same box serves:
//   * Query matches the QUESTION text (a match name / bet question) ->
//     show the whole card with every picker. "Find the Mexico game."
//   * Query matches only PICKER names -> keep the card but show just the
//     matching people's rows (and drop the "didn't bet" list, which is
//     meaningless once we are looking at one person). "What did Ohad
//     pick?" now collapses the 30-name wall to Ohad's single row.
//
// Substring, case-insensitive, run on every keystroke over at most ~100
// questions — no debounce needed. Escape or the clear button empties it.

export function TransparencyList({
  rows,
  tab,
  locale,
  categoryLabel,
  stakeLabel,
  searchPlaceholder,
  searchNoResults,
}: {
  rows: TransparencyQuestionRow[];
  tab: TransparencyCategory;
  locale: Locale;
  categoryLabel: string;
  stakeLabel: string;
  searchPlaceholder: string;
  searchNoResults: string;
}) {
  const isHebrew = locale === "he";
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const q = query.trim();
  const filtered = useMemo(
    () => filterRowsByQuery(rows, query),
    [rows, query],
  );

  const clear = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <Search
            className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-on-surface-variant pointer-events-none"
            strokeWidth={2}
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                clear();
              }
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            dir={isHebrew ? "rtl" : "ltr"}
            inputMode="search"
            autoComplete="off"
            // 48px tall + text-base (16px) so iOS Safari does not zoom on
            // focus, per the project responsive rules. Native search-clear
            // UI is hidden so our own X button is the only one.
            className="w-full h-12 ps-10 pe-10 rounded-full bg-surface-container-lowest border border-outline text-base focus:outline-none focus:border-primary [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={clear}
              aria-label={isHebrew ? "נקה חיפוש" : "Clear search"}
              className="press-down absolute top-1/2 -translate-y-1/2 end-2 h-9 w-9 inline-flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container"
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
        {q !== "" && (
          <span className="px-1 text-xs text-on-surface-variant tabular-nums">
            {isHebrew
              ? `${filtered.length} תוצאות`
              : `${filtered.length} ${filtered.length === 1 ? "result" : "results"}`}
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-6 text-center text-sm text-on-surface-variant flex flex-col gap-1">
          <span className="font-bold text-on-surface">{searchNoResults}</span>
          <span dir="auto">&ldquo;{query.trim()}&rdquo;</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((row) => (
            <li key={row.questionId}>
              <QuestionCard
                tab={tab}
                row={row}
                locale={locale}
                categoryLabel={categoryLabel}
                stakeLabel={stakeLabel}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuestionCard({
  tab,
  row,
  locale,
  categoryLabel,
  stakeLabel,
}: {
  tab: TransparencyCategory;
  row: TransparencyQuestionRow;
  locale: Locale;
  categoryLabel: string;
  stakeLabel: string;
}) {
  const isHebrew = locale === "he";
  return (
    <Card className="p-3 md:p-4 flex flex-col gap-3">
      {/* Which game is this? A live bet's question never names the
          fixture, so when several matches run at once the banner is the
          only thing that tells the cards apart. It bleeds to the card
          edges and sits above everything else so it reads first. */}
      {row.context && (
        <MatchContextBanner context={row.context} isHebrew={isHebrew} />
      )}

      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <Chip tone={categoryTone(tab)} className="self-start shrink-0">
            {categoryLabel}
          </Chip>
          <span className="text-sm md:text-base font-bold text-on-surface">
            {row.question}
          </span>
        </div>
        <time
          className="text-[11px] text-on-surface-variant whitespace-nowrap shrink-0"
          dateTime={row.eventTime}
        >
          {formatDateTime(row.eventTime, locale, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </header>

      {/* Full-bleed zebra rows. With 30+ names a flat gapped list reads
          as one undifferentiated wall (the home digit and points float
          far from the name across an empty middle). Alternating row
          tints band each name to its own score/points line, and the
          points sit in a fixed-width right-aligned column so every
          +10 / +5 / 0 stacks into a scannable column. min-h-11 keeps
          each row a 44px touch target. */}
      <ul className="flex flex-col -mx-3 md:-mx-4 rounded-lg overflow-hidden">
        {row.pickers.map((pk, idx) => (
          <li
            key={`${row.questionId}:${pk.userId}:${idx}`}
            className={clsx(
              "flex items-center justify-between gap-3 text-sm px-3 md:px-4 py-2 min-h-11",
              idx % 2 === 1 && "bg-surface-container-high/70",
            )}
          >
            <span className="font-bold text-on-surface truncate min-w-0">
              {pk.displayName}
            </span>
            <span className="flex items-center gap-3 shrink-0">
              {pk.stake > 0 && (
                <span className="bidi-ltr text-[11px] text-on-surface-variant">
                  ({stakeLabel}: {pk.stake})
                </span>
              )}
              <span className="text-on-surface-variant">
                <PickLabel tab={tab} label={pk.pickLabel} />
              </span>
              {pk.pointsEarned !== null && (
                <span
                  className={clsx(
                    "min-w-[2.75rem] text-end font-[family-name:var(--font-score)] text-sm leading-none font-bold tabular-nums",
                    pk.pointsEarned > 0
                      ? "text-secondary"
                      : pk.pointsEarned < 0
                        ? "text-error"
                        : "text-on-surface",
                  )}
                >
                  <bdi>
                    {pk.pointsEarned > 0 ? "+" : ""}
                    {pk.pointsEarned}
                  </bdi>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {tab !== "duel" && row.nonBettors.length > 0 && (
        <details className="group">
          <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none press-down inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-surface-container-low border border-outline-variant text-xs font-bold text-on-surface-variant">
            <ChevronDown
              className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
              strokeWidth={2.5}
            />
            {isHebrew
              ? `+${row.nonBettors.length} לא הימרו`
              : `+${row.nonBettors.length} didn't bet`}
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {row.nonBettors.map((nb) => (
              <li key={nb.userId}>
                <Chip tone="default" className="text-[11px]">
                  {nb.displayName}
                </Chip>
              </li>
            ))}
          </ul>
        </details>
      )}

      <LabelCaps as="div" className="self-end">
        {row.pickers[0]?.status ?? ""}
      </LabelCaps>
    </Card>
  );
}

// The "which game" banner on a live card. Full-bleed across the card top
// in a warm live-tint so it reads before the question. Two shapes:
//   * match scope -> the two flagged teams facing off ("🇲🇽 מקסיקו · קוריאה 🇰🇷")
//   * day scope   -> a calendar row with the matchday label
// Team names are short country names; on the narrowest viewport the row
// wraps instead of scrolling. Flags are decorative (aria-hidden) — the
// team name carries the meaning for screen readers.
function MatchContextBanner({
  context,
  isHebrew,
}: {
  context: TransparencyContext;
  isHebrew: boolean;
}) {
  return (
    <div className="-mx-3 md:-mx-4 -mt-3 md:-mt-4 rounded-t-lg bg-primary-fixed/60 border-b border-primary-fixed-dim px-3 md:px-4 py-2.5">
      {context.kind === "match" ? (
        <div className="flex items-center justify-center gap-x-3 gap-y-1 flex-wrap text-sm md:text-base font-bold text-on-surface">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="text-lg leading-none">
              {context.home.flag}
            </span>
            {context.home.name}
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wide text-on-primary-fixed-variant">
            {isHebrew ? "נגד" : "vs"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            {context.away.name}
            <span aria-hidden className="text-lg leading-none">
              {context.away.flag}
            </span>
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-1.5 text-sm font-bold text-on-surface">
          <CalendarDays
            className="h-4 w-4 text-on-primary-fixed-variant shrink-0"
            strokeWidth={2}
            aria-hidden
          />
          {context.label}
        </div>
      )}
    </div>
  );
}

// Match score picks arrive as a flat "home-away" string from SQL
// (`mb.home_score || '-' || mb.away_score`). Rendering that string in an
// RTL paragraph puts the home digit on the LEFT (LTR-isolated number
// run) — the opposite of where the home team's name sits in every other
// fixture surface in the app, so Hebrew readers see "3-1" with the 1
// next to Mexico and conclude their pick flipped. ScoreLine renders the
// two digits as separate flex children that flow with the document
// direction, lining the home digit up under the home team. The match
// branch is the only one that uses a "H-A" shape; all other tabs have
// prose labels and render unchanged.
function PickLabel({
  tab,
  label,
}: {
  tab: TransparencyCategory;
  label: string;
}) {
  if (tab === "match") {
    const m = /^(\d+)-(\d+)$/.exec(label);
    if (m) {
      return <ScoreLine home={Number(m[1])} away={Number(m[2])} />;
    }
  }
  return <span>{label}</span>;
}

function categoryTone(
  category: TransparencyCategory,
): "primary" | "default" | "secondary" | "warning" {
  switch (category) {
    case "match":
      return "default";
    case "live":
      return "primary";
    case "tournament":
      return "warning";
    case "group":
      return "default";
    case "duel":
      return "secondary";
  }
}
