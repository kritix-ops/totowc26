"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Calendar,
  ExternalLink,
  Newspaper,
  RefreshCw,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { Card, LabelCaps } from "@/components/ui";
import { formatDateTime, localInputValueToIso } from "@/lib/format";
import type { Locale } from "../dictionaries";
import type { NewsArchiveItem } from "@/lib/news-read";
import type { NewsSource } from "@/lib/news";

// Client list with infinite scroll + date jump. The server wrapper
// (NewsTab.tsx) hydrates us with the first page of latest items and a
// cursor; from there we own paging via /api/news?lang=&before=&limit=.
//
// Pagination is keyset on published_at — page N+1 returns rows strictly
// older than the oldest visible row. This stays consistent even when
// the cron inserts new rows mid-scroll (offset pagination would
// duplicate).
//
// Date picker uses a native <input type="date">; on mobile this is the
// OS-native wheel/calendar which is the best UX a lazy user can get
// without us shipping a date library. Picking a date sets `before` to
// the START of the NEXT day in Asia/Jerusalem — so "Jun 15" shows
// every article published up to and including the end of Jun 15 IL.

export type NewsListStrings = {
  heading: string;
  openArticleAria: string;
  openArticle: string;
  sourceWalla: string;
  sourceYnet: string;
  sourceBbc: string;
  filterByDateLabel: string;
  clearDate: string;
  loadingMore: string;
  noMore: string;
  noItemsForDate: string;
  errorTitle: string;
  errorRetry: string;
};

type LoadMode =
  | { kind: "latest" }
  | { kind: "date"; isoDate: string; before: string };

export function NewsList({
  locale,
  lang,
  initialItems,
  initialCursor,
  strings,
}: {
  locale: Locale;
  lang: "he" | "en";
  initialItems: NewsArchiveItem[];
  initialCursor: string | null;
  strings: NewsListStrings;
}) {
  const [items, setItems] = useState<NewsArchiveItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [mode, setMode] = useState<LoadMode>({ kind: "latest" });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLLIElement | null>(null);

  // Keep the cursor + loading state in refs so the IntersectionObserver
  // callback (created once on mount) always sees the current values
  // without us having to rebuild the observer on every render.
  const cursorRef = useRef(cursor);
  const loadingRef = useRef(isLoading);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);
  useEffect(() => {
    loadingRef.current = isLoading;
  }, [isLoading]);

  // Monotonic request token. Bumped on every mode change (date pick /
  // clear). A response only applies its results if the token it
  // captured at request time is still the current one — so a slow
  // load_more whose response races a fast date-pick gets discarded
  // instead of polluting the new list.
  const requestTokenRef = useRef(0);

  const fetchPage = useCallback(
    async (before: string | null): Promise<{
      items: NewsArchiveItem[];
      nextCursor: string | null;
    }> => {
      const params = new URLSearchParams({ lang });
      if (before) params.set("before", before);
      params.set("limit", "20");
      const res = await fetch(`/api/news?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`news_api_status_${res.status}`);
      }
      return (await res.json()) as {
        items: NewsArchiveItem[];
        nextCursor: string | null;
      };
    },
    [lang],
  );

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    const current = cursorRef.current;
    if (!current) return;
    // Lock immediately, not just via state. The IntersectionObserver
    // can fire twice within the same React tick before setIsLoading
    // takes effect; without the sync set, a fast scroll would issue
    // two parallel /api/news requests with the same `before` cursor.
    loadingRef.current = true;
    const token = requestTokenRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const page = await fetchPage(current);
      if (requestTokenRef.current !== token) return; // mode changed; discard
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      console.info("[news list]", {
        event: "load_more",
        before: current,
        count: page.items.length,
        nextCursor: page.nextCursor,
      });
    } catch (err) {
      if (requestTokenRef.current !== token) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.warn("[news list]", { event: "error", phase: "load_more", error: msg });
    } finally {
      if (requestTokenRef.current === token) setIsLoading(false);
    }
  }, [fetchPage]);

  const switchToDate = useCallback(
    async (isoDate: string) => {
      // isoDate is a "YYYY-MM-DD" string from <input type="date">. We
      // want "items published up to end of that day IL", which is the
      // start of the next day IL converted to UTC.
      const nextDay = nextIsoDay(isoDate);
      const before = localInputValueToIso(`${nextDay}T00:00`);
      if (!before) {
        // Malformed input — treat as no-op.
        return;
      }
      requestTokenRef.current += 1;
      const token = requestTokenRef.current;
      loadingRef.current = true;
      setMode({ kind: "date", isoDate, before });
      setIsLoading(true);
      setError(null);
      setItems([]);
      setCursor(null);
      try {
        const page = await fetchPage(before);
        if (requestTokenRef.current !== token) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        console.info("[news list]", {
          event: "pick_date",
          isoDate,
          before,
          count: page.items.length,
        });
      } catch (err) {
        if (requestTokenRef.current !== token) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        console.warn("[news list]", { event: "error", phase: "pick_date", error: msg });
      } finally {
        if (requestTokenRef.current === token) setIsLoading(false);
      }
    },
    [fetchPage],
  );

  const switchToLatest = useCallback(async () => {
    requestTokenRef.current += 1;
    const token = requestTokenRef.current;
    loadingRef.current = true;
    setMode({ kind: "latest" });
    setIsLoading(true);
    setError(null);
    setItems([]);
    setCursor(null);
    try {
      const page = await fetchPage(null);
      if (requestTokenRef.current !== token) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      console.info("[news list]", {
        event: "clear_date",
        count: page.items.length,
      });
    } catch (err) {
      if (requestTokenRef.current !== token) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.warn("[news list]", { event: "error", phase: "clear_date", error: msg });
    } finally {
      if (requestTokenRef.current === token) setIsLoading(false);
    }
  }, [fetchPage]);

  const retry = useCallback(async () => {
    if (mode.kind === "date") {
      await switchToDate(mode.isoDate);
    } else {
      // For latest-mode retry we re-fetch from the current cursor (the
      // last load_more failed) rather than reset the list — the visible
      // items are still good, we just need the next page.
      await loadMore();
    }
  }, [mode, switchToDate, loadMore]);

  // One IntersectionObserver, attached to the sentinel <li> at the
  // bottom of the list. The sentinel stays mounted across renders, so
  // the observer is set up once and re-uses the same target ref.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || !entry.isIntersecting) return;
        if (loadingRef.current) return;
        if (!cursorRef.current) return;
        void loadMore();
      },
      // Pre-fetch slightly before the sentinel scrolls fully into view
      // — feels snappier on mobile where the last card is the only
      // thing on screen for a moment.
      { rootMargin: "200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  const showEndOfArchive =
    cursor === null && items.length > 0 && !isLoading && !error;
  const showEmptyForDate =
    mode.kind === "date" && items.length === 0 && !isLoading && !error;

  return (
    <div className="flex flex-col gap-4">
      <DateFilter
        locale={locale}
        isoDate={mode.kind === "date" ? mode.isoDate : ""}
        onPick={switchToDate}
        onClear={switchToLatest}
        labelText={strings.filterByDateLabel}
        clearText={strings.clearDate}
      />

      {showEmptyForDate ? (
        <Card className="p-6 md:p-8 text-center text-on-surface-variant">
          {strings.noItemsForDate}
        </Card>
      ) : (
        <ul className="flex flex-col gap-3 md:gap-4">
          {items.map((item) => (
            <li key={item.id}>
              <NewsCard item={item} locale={locale} strings={strings} />
            </li>
          ))}
          <li
            ref={sentinelRef}
            aria-hidden
            className="h-px"
          />
          {isLoading && <SkeletonCard text={strings.loadingMore} />}
          {showEndOfArchive && (
            <li className="py-2 text-center text-xs text-on-surface-variant">
              {strings.noMore}
            </li>
          )}
        </ul>
      )}

      {error && (
        <Card className="p-4 md:p-6 flex flex-col gap-3 items-center text-center">
          <p className="text-sm text-on-surface font-bold">
            {strings.errorTitle}
          </p>
          <button
            type="button"
            onClick={() => void retry()}
            className="press-down inline-flex items-center gap-2 min-h-[44px] px-5 rounded-full bg-primary text-on-primary font-[family-name:var(--font-label)] text-[13px] font-bold tracking-[0.04em]"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2} />
            <span>{strings.errorRetry}</span>
          </button>
        </Card>
      )}
    </div>
  );
}

function DateFilter({
  locale,
  isoDate,
  onPick,
  onClear,
  labelText,
  clearText,
}: {
  locale: Locale;
  isoDate: string;
  onPick: (iso: string) => void;
  onClear: () => void;
  labelText: string;
  clearText: string;
}) {
  // Native <input type="date"> renders the OS date picker on mobile.
  // 16px font-size is required to prevent iOS Safari's auto-zoom on
  // focus per CLAUDE.md mobile rules. Min height 48px matches the
  // form-input bar across the app.
  const isHebrew = locale === "he";
  return (
    <div
      className={clsx(
        "flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3",
        isHebrew ? "sm:flex-row-reverse" : "",
      )}
    >
      <label
        htmlFor="news-date-filter"
        className="flex items-center gap-2 text-sm text-on-surface-variant"
      >
        <Calendar className="h-4 w-4" strokeWidth={2} />
        <span>{labelText}</span>
      </label>
      <div className="flex items-center gap-2">
        <input
          id="news-date-filter"
          type="date"
          value={isoDate}
          min="2026-06-11"
          onChange={(e) => {
            const v = e.target.value;
            if (v) onPick(v);
            else onClear();
          }}
          className="min-h-[48px] px-3 rounded-md border border-outline bg-surface-container-lowest text-on-surface text-[16px] flex-1 sm:flex-none"
        />
        {isoDate && (
          <button
            type="button"
            onClick={onClear}
            aria-label={clearText}
            className="press-down inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-md border border-outline text-on-surface-variant hover:bg-surface-container"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

function NewsCard({
  item,
  locale,
  strings,
}: {
  item: NewsArchiveItem;
  locale: Locale;
  strings: NewsListStrings;
}) {
  const dateLabel = formatDateTime(item.publishedAt, locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const sourceLabel = sourceName(item.source, strings);

  return (
    <Card className="overflow-hidden">
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${strings.openArticleAria}: ${item.title}`}
        className="press-down flex gap-3 md:gap-4 p-3 md:p-4 min-h-[88px] hover:bg-surface-container transition-colors"
      >
        {item.imageUrl ? (
          <div className="relative shrink-0 w-[88px] h-[88px] md:w-[120px] md:h-[120px] rounded-md overflow-hidden bg-surface-variant">
            <Image
              src={item.imageUrl}
              alt=""
              fill
              sizes="(min-width: 768px) 120px, 88px"
              className="object-cover"
              unoptimized
            />
          </div>
        ) : (
          <div className="shrink-0 w-[88px] h-[88px] md:w-[120px] md:h-[120px] rounded-md bg-surface-variant flex items-center justify-center text-on-surface-variant">
            <Newspaper className="h-6 w-6" strokeWidth={1.75} />
          </div>
        )}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <LabelCaps>{sourceLabel}</LabelCaps>
            <span className="text-on-surface-variant text-xs" aria-hidden>
              ·
            </span>
            <time
              className="text-on-surface-variant text-xs bidi-ltr"
              dateTime={new Date(item.publishedAt).toISOString()}
            >
              {dateLabel}
            </time>
          </div>
          <h3 className="font-bold text-on-surface text-[15px] md:text-base leading-snug">
            {item.title}
          </h3>
          {item.summary && (
            <p className="text-sm text-on-surface-variant leading-relaxed line-clamp-2">
              {item.summary}
            </p>
          )}
          <span className="mt-1 inline-flex items-center gap-1 text-xs text-primary font-bold">
            <span>{strings.openArticle}</span>
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        </div>
      </a>
    </Card>
  );
}

function SkeletonCard({ text }: { text: string }) {
  return (
    <li
      aria-live="polite"
      aria-busy="true"
      className="rounded-lg border border-outline-variant bg-surface-container-low p-3 md:p-4 min-h-[88px] flex gap-3 md:gap-4 animate-pulse"
    >
      <div className="shrink-0 w-[88px] h-[88px] md:w-[120px] md:h-[120px] rounded-md bg-surface-variant" />
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <div className="h-3 w-24 rounded bg-surface-variant" />
        <div className="h-4 w-3/4 rounded bg-surface-variant" />
        <div className="h-4 w-1/2 rounded bg-surface-variant" />
        <span className="sr-only">{text}</span>
      </div>
    </li>
  );
}

function sourceName(source: NewsSource, strings: NewsListStrings): string {
  switch (source) {
    case "walla":
      return strings.sourceWalla;
    case "ynet":
      return strings.sourceYnet;
    case "bbc":
      return strings.sourceBbc;
  }
}

// "YYYY-MM-DD" → "YYYY-MM-DD" of the next calendar day. Used to build
// the exclusive-upper-bound `before` cutoff: end of picked day = start
// of next day (then converted to UTC via localInputValueToIso).
function nextIsoDay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mo, da] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +da));
  date.setUTCDate(date.getUTCDate() + 1);
  const yy = date.getUTCFullYear().toString().padStart(4, "0");
  const moo = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const daa = date.getUTCDate().toString().padStart(2, "0");
  return `${yy}-${moo}-${daa}`;
}
