"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import type { Locale } from "@/app/[lang]/dictionaries";

// Free-text search for /admin/bets. The page itself is a server component
// that reads `q` from the URL and pushes it into listCustomBets() — this
// client island only owns the textbox and writes the value back into the
// URL after a short debounce so the admin sees results without hitting
// "Search" or "Enter" manually. Other filters (status, scope) stay as
// pure-server links and are preserved here by reading the live
// searchParams on every change.

const DEBOUNCE_MS = 300;

export function BetsSearchBox({
  locale,
  initialQuery,
}: {
  locale: Locale;
  initialQuery: string;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedRef = useRef(initialQuery);

  // Sync local state with URL changes from elsewhere (back/forward,
  // chip clicks that re-render the server tree). The empty branch
  // covers "user cleared a different chip and the URL no longer has q".
  useEffect(() => {
    const urlQ = searchParams.get("q") ?? "";
    if (urlQ !== value && urlQ !== lastPushedRef.current) {
      setValue(urlQ);
      lastPushedRef.current = urlQ;
    }
    // Intentionally exclude `value` from deps — we sync URL → state, not
    // the other way around. The other direction is the debounced effect
    // below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Debounced URL write. Skips the initial mount where value already
  // matches the URL so we don't push a redundant entry.
  useEffect(() => {
    if (value === lastPushedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      const trimmed = value.trim();
      if (trimmed === "") next.delete("q");
      else next.set("q", trimmed);
      lastPushedRef.current = trimmed;
      const qs = next.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, router, searchParams]);

  const clear = () => setValue("");

  return (
    <div className="relative">
      <Search
        className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-on-surface-variant pointer-events-none"
        strokeWidth={2}
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={
          isHebrew
            ? "חפש לפי שאלה, משחק, שלב או בית…"
            : "Search by question, match, stage, or group…"
        }
        dir={isHebrew ? "rtl" : "ltr"}
        inputMode="search"
        autoComplete="off"
        className="w-full min-h-[48px] ps-10 pe-10 rounded-full bg-surface-container-lowest border border-outline text-base focus:outline-none focus:border-primary"
        aria-label={isHebrew ? "חיפוש" : "Search"}
      />
      {value !== "" && (
        <button
          type="button"
          onClick={clear}
          aria-label={isHebrew ? "נקה חיפוש" : "Clear search"}
          className="absolute top-1/2 -translate-y-1/2 end-2 inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-surface-container text-on-surface-variant"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
