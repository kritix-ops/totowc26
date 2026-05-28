"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronsDown } from "lucide-react";
import { Card } from "@/components/ui";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { AdminPlayerReviewRow } from "@/db/admin-queries";
import { PlayerFilterBar } from "./PlayerFilterBar";
import { PlayerReviewRow } from "./PlayerReviewRow";
import type {
  PlayerFilters,
  PlayerVerdictKey,
  PlayerLockKey,
} from "./player-filters";
import {
  EMPTY_FILTERS,
  matchesPlayerFilters,
  hasAnyFilter,
  filterCounts,
} from "./player-filters";

// Initial visible-row count + how many more we reveal per
// "Load more" click. Rendering all 1,357 PlayerReviewRow nodes at
// once hydrated for ~1.5 s on mid-tier mobile and blocked input
// focus until the work finished — exactly what the user reported
// as "clicking the search box freezes everything". Capping the
// initial render to PAGE_SIZE rows keeps hydration well under
// 100 ms and the rest stream in only when the admin asks for them.
const PAGE_SIZE = 50;

// Owns all client-side filter state for the /admin/players queue.
//
// Why client-side: with 1,357 rows the full payload is ~540 KB —
// acceptable for an admin-only page — and once loaded, every filter
// flick or keystroke is instant (zero network). The alternative
// (server filtering via URL params) cost a 200-400 ms round-trip on
// every change and made dynamic counts ("3 rejected in Brazil")
// impossible without a second query.
//
// Server stays the authority on data: edit/approve/reject server
// actions call router.refresh(), the page re-fetches all rows, and
// the filter state in this component is preserved across the
// refresh because useState lives in the client tree.

export function PlayerReviewBoard({
  locale,
  initialVerdict,
  rows,
}: {
  locale: Locale;
  initialVerdict: PlayerVerdictKey;
  rows: AdminPlayerReviewRow[];
}) {
  const isHebrew = locale === "he";
  const [filters, setFilters] = useState<PlayerFilters>(() => ({
    ...EMPTY_FILTERS,
    verdict: initialVerdict,
  }));
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Single pass over all 1,357 rows: applies every filter and
  // returns the filtered list. useMemo means we recompute only when
  // filters or rows change.
  const filtered = useMemo(
    () => rows.filter((r) => matchesPlayerFilters(r, filters)),
    [rows, filters],
  );

  // Slice to first `visibleCount` rows for rendering. Hydrating the
  // full 1,357-row list on mount was blocking input focus for over
  // a second — the perf regression that prompted this pagination.
  const visibleRows = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );
  const hiddenRemaining = filtered.length - visibleRows.length;
  const nextChunk = Math.min(PAGE_SIZE, hiddenRemaining);

  // Whenever the filter set changes, reset back to the first page
  // so the admin sees the top of the new result list rather than
  // arbitrarily-deep page 4 they happened to have loaded before.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filters]);

  // Dynamic counts for every filter dimension, computed against the
  // OTHER active filters. Lets the verdict chip strip show "190
  // rejected" when team=BRA is selected — that's the count of
  // Brazilian rejects, not the global one.
  const counts = useMemo(() => filterCounts(rows, filters), [rows, filters]);

  const anyActive = hasAnyFilter(filters);

  return (
    <section className="flex flex-col gap-4">
      <PlayerFilterBar
        locale={locale}
        filters={filters}
        onChange={setFilters}
        counts={counts}
        rows={rows}
      />

      <ResultsSummary
        isHebrew={isHebrew}
        showing={filtered.length}
        total={rows.length}
        anyActive={anyActive}
        onClear={() => setFilters(EMPTY_FILTERS)}
      />

      {filtered.length === 0 ? (
        <Card className="p-6 text-center text-on-surface-variant">
          {isHebrew ? "אין שורות שמתאימות לסינון." : "No rows match these filters."}
        </Card>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {visibleRows.map((row) => (
              <PlayerReviewRow key={row.id} locale={locale} row={row} />
            ))}
          </ul>

          {hiddenRemaining > 0 && (
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="press-down self-center inline-flex items-center gap-2 min-h-[44px] px-5 rounded-full text-sm font-bold text-primary bg-surface-container-low border border-outline-variant hover:bg-surface-container"
            >
              <ChevronsDown className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew
                ? `טען עוד ${nextChunk} (נשארו ${hiddenRemaining})`
                : `Load ${nextChunk} more (${hiddenRemaining} remaining)`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ResultsSummary({
  isHebrew,
  showing,
  total,
  anyActive,
  onClear,
}: {
  isHebrew: boolean;
  showing: number;
  total: number;
  anyActive: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs md:text-sm text-on-surface-variant">
      <span className="bidi-ltr tabular-nums">
        {isHebrew
          ? `מציג ${showing} מתוך ${total}`
          : `Showing ${showing} of ${total}`}
      </span>
      {anyActive && (
        <button
          type="button"
          onClick={onClear}
          className="press-down inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-bold bg-surface-container-lowest text-on-surface-variant border border-outline-variant hover:bg-surface-container"
        >
          {isHebrew ? "נקה הכל" : "Clear all"}
        </button>
      )}
    </div>
  );
}

// Re-export the shared types so the page can describe its prop
// without importing from the (client-only) board file directly.
export type { PlayerFilters, PlayerVerdictKey, PlayerLockKey };
