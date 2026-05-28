"use client";

import { useMemo, useState } from "react";
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

  // Single pass over all 1,357 rows: applies every filter and
  // returns the filtered list. useMemo means we recompute only when
  // filters or rows change.
  const filtered = useMemo(
    () => rows.filter((r) => matchesPlayerFilters(r, filters)),
    [rows, filters],
  );

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
        <ul className="flex flex-col gap-2">
          {filtered.map((row) => (
            <PlayerReviewRow key={row.id} locale={locale} row={row} />
          ))}
        </ul>
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
