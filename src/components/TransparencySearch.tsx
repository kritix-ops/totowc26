"use client";

import { useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { Locale } from "@/app/[lang]/dictionaries";

// Instant client-side filter for one /transparency tab.
//
// The cards are rendered on the SERVER (QuestionCard stays a server
// component) and passed in pre-built via `items[].node`. This island
// only owns the search input and decides which nodes to show, so the
// heavy per-row data never has to cross into the client bundle — all
// the client needs is a lightweight `text` haystack per card
// (question text + every picker's display name, lower-cased on the
// server).
//
// Matching is a plain case-insensitive substring test, the same shape
// SearchableChoicePicker uses. It runs on every keystroke against at
// most ~100 rows, so no debounce is needed — results update live as
// the user types. Escape (or the clear button) empties the field.

export type TransparencySearchItem = {
  id: string;
  // Pre-lowercased searchable text: question + picker display names.
  text: string;
  node: React.ReactNode;
};

export function TransparencySearch({
  items,
  locale,
  placeholder,
  noResultsLabel,
}: {
  items: TransparencySearchItem[];
  locale: Locale;
  placeholder: string;
  noResultsLabel: string;
}) {
  const isHebrew = locale === "he";
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? items.filter((it) => it.text.includes(q)) : items),
    [items, q],
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
            placeholder={placeholder}
            aria-label={placeholder}
            dir={isHebrew ? "rtl" : "ltr"}
            inputMode="search"
            autoComplete="off"
            // 48px tall + text-base (16px) so iOS Safari does not zoom
            // on focus, per the project responsive rules. Native search
            // clear UI is hidden so our own X button is the only one.
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
              ? `${matches.length} תוצאות`
              : `${matches.length} ${matches.length === 1 ? "result" : "results"}`}
          </span>
        )}
      </div>

      {matches.length === 0 ? (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-6 text-center text-sm text-on-surface-variant flex flex-col gap-1">
          <span className="font-bold text-on-surface">{noResultsLabel}</span>
          <span dir="auto">&ldquo;{query.trim()}&rdquo;</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {matches.map((it) => (
            <li key={it.id}>{it.node}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
