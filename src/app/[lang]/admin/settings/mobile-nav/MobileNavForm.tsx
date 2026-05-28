"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { PillButton } from "@/components/ui";
import { MobileNavIcon } from "@/lib/mobile-nav-icons";
import {
  MOBILE_NAV_BAR_MAX,
  MOBILE_NAV_BAR_MIN,
  type MobileNavConfig,
  type MobileNavItemKey,
} from "@/lib/mobile-nav";
import { saveMobileNavConfig } from "./actions";

type CatalogEntry = { roleGate: "player" | "admin" | null };

export function MobileNavForm({
  locale,
  initial,
  labels,
  allKeys,
  catalog,
}: {
  locale: Locale;
  initial: MobileNavConfig;
  labels: Record<MobileNavItemKey, string>;
  allKeys: MobileNavItemKey[];
  catalog: Record<MobileNavItemKey, CatalogEntry>;
}) {
  const isHebrew = locale === "he";
  const [items, setItems] = useState<MobileNavItemKey[]>(initial.items);
  const [bottomBarCount, setBottomBarCount] = useState<number>(
    initial.bottomBarCount,
  );
  const [dragKey, setDragKey] = useState<MobileNavItemKey | null>(null);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hidden = useMemo(
    () => allKeys.filter((k) => !items.includes(k)),
    [allKeys, items],
  );

  const dirty =
    bottomBarCount !== initial.bottomBarCount ||
    items.length !== initial.items.length ||
    items.some((k, i) => initial.items[i] !== k);

  const canSave = dirty && items.length >= 1 && !pending;

  const moveItem = (key: MobileNavItemKey, dir: -1 | 1) => {
    setItems((prev) => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const removeItem = (key: MobileNavItemKey) => {
    setItems((prev) => prev.filter((k) => k !== key));
  };

  const restoreItem = (key: MobileNavItemKey) => {
    setItems((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };

  const resetToSaved = () => {
    setItems(initial.items);
    setBottomBarCount(initial.bottomBarCount);
    setErrorMsg(null);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setErrorMsg(null);
    startTransition(async () => {
      const res = await saveMobileNavConfig({ items, bottomBarCount });
      if (res.ok) {
        setSavedAt(Date.now());
        console.info("[admin mobile-nav submitted]", {
          itemCount: items.length,
          bottomBarCount,
        });
      } else {
        setErrorMsg(
          res.error === "forbidden"
            ? isHebrew
              ? "אין הרשאה."
              : "Forbidden."
            : res.error === "invalid"
              ? isHebrew
                ? "הנתונים לא תקינים."
                : "Invalid input."
              : isHebrew
                ? "השמירה נכשלה. נסה שוב."
                : "Save failed. Try again.",
        );
      }
    });
  };

  // Drag-and-drop with mouse only (touch users use the arrow buttons —
  // HTML5 DnD has shaky touch support, and arrow buttons are also more
  // accessible to keyboard users). The cutoff divider stays in place;
  // we don't allow dragging across it as a separate gesture, dropping
  // an item to a position simply moves it there in the ordered list.
  const onDragStart = (key: MobileNavItemKey) => () => {
    setDragKey(key);
  };
  const onDragOver = (overKey: MobileNavItemKey) =>
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!dragKey || dragKey === overKey) return;
      setItems((prev) => {
        const fromIdx = prev.indexOf(dragKey);
        const toIdx = prev.indexOf(overKey);
        if (fromIdx < 0 || toIdx < 0) return prev;
        const next = [...prev];
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, dragKey);
        return next;
      });
    };
  const onDragEnd = () => setDragKey(null);

  // Cutoff divider only renders when there will actually be a "More"
  // cell — i.e. when total visible items > bottomBarCount. Until then
  // every item fits in the bar and the bar/sheet distinction is moot.
  const showCutoff = items.length > bottomBarCount;
  const cutoffIndex = Math.max(0, bottomBarCount - 1);

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-6"
      aria-label={isHebrew ? "הגדרות תפריט מובייל" : "Mobile nav settings"}
    >
      {/* Bottom-bar size stepper */}
      <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 md:p-5">
        <label className="block text-sm font-bold text-on-surface mb-1">
          {isHebrew ? "כמות תאים בסרגל התחתון" : "Bar cell count"}
        </label>
        <p className="text-xs text-on-surface-variant mb-3 leading-relaxed">
          {isHebrew
            ? "אם יש יותר פריטים מהמספר הזה, התא האחרון בסרגל הופך ל-'עוד' וייפתח חלון עם שאר הפריטים."
            : "If there are more items than this number, the last bar cell turns into 'More' and opens a sheet with the rest."}
        </p>
        <div className="inline-flex items-stretch gap-0 rounded-full border border-outline overflow-hidden bg-surface">
          <button
            type="button"
            onClick={() =>
              setBottomBarCount((c) => Math.max(MOBILE_NAV_BAR_MIN, c - 1))
            }
            disabled={bottomBarCount <= MOBILE_NAV_BAR_MIN}
            aria-label={isHebrew ? "פחות תאים" : "Fewer cells"}
            className="px-4 min-h-[48px] flex items-center justify-center hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Minus className="h-4 w-4" strokeWidth={2} />
          </button>
          <span
            className="px-6 min-h-[48px] flex items-center justify-center min-w-[64px] font-[family-name:var(--font-display)] text-2xl font-bold text-primary border-x border-outline"
            aria-live="polite"
          >
            {bottomBarCount}
          </span>
          <button
            type="button"
            onClick={() =>
              setBottomBarCount((c) => Math.min(MOBILE_NAV_BAR_MAX, c + 1))
            }
            disabled={bottomBarCount >= MOBILE_NAV_BAR_MAX}
            aria-label={isHebrew ? "יותר תאים" : "More cells"}
            className="px-4 min-h-[48px] flex items-center justify-center hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <p className="text-xs text-on-surface-variant mt-2">
          {isHebrew
            ? `טווח מותר: ${MOBILE_NAV_BAR_MIN}–${MOBILE_NAV_BAR_MAX}`
            : `Allowed range: ${MOBILE_NAV_BAR_MIN}–${MOBILE_NAV_BAR_MAX}`}
        </p>
      </div>

      {/* Visible items list */}
      <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 md:p-5">
        <h2 className="text-sm font-bold text-on-surface mb-1">
          {isHebrew ? "פריטים מוצגים" : "Visible items"}
        </h2>
        <p className="text-xs text-on-surface-variant mb-4 leading-relaxed">
          {isHebrew
            ? "גרור (במחשב) או השתמש בחצים (במובייל) כדי לשנות סדר. הסר פריטים שלא תרצה לראות בתפריט."
            : "Drag (desktop) or use the arrows (mobile) to reorder. Remove items you don't want in the nav."}
        </p>

        {items.length === 0 ? (
          <p className="text-sm text-error font-bold py-4">
            {isHebrew
              ? "אין פריטים מוצגים. הוסף לפחות פריט אחד מהרשימה למטה."
              : "No visible items. Restore at least one item from the list below."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {items.map((key, idx) => {
              const gate = catalog[key]?.roleGate;
              // The cutoff line renders BEFORE the first item that
              // ends up in the More sheet (idx === cutoffIndex). That
              // makes "above the line" the bar, "below the line" the
              // sheet, which matches what the admin reads.
              const isCutoff = showCutoff && idx === cutoffIndex;
              const inBar = !showCutoff || idx < cutoffIndex;
              return (
                <li key={key} className="flex flex-col">
                  {isCutoff && (
                    <div
                      aria-hidden
                      className="relative my-2 flex items-center gap-3 select-none"
                    >
                      <div className="flex-1 h-px bg-primary/40" />
                      <span className="text-[10px] font-bold uppercase tracking-wide text-primary px-2 py-1 bg-primary-fixed rounded-full">
                        {isHebrew
                          ? "↑ סרגל תחתון  ·  ↓ תפריט 'עוד'"
                          : "↑ Bottom bar  ·  ↓ 'More' sheet"}
                      </span>
                      <div className="flex-1 h-px bg-primary/40" />
                    </div>
                  )}
                  <div
                    draggable
                    onDragStart={onDragStart(key)}
                    onDragOver={onDragOver(key)}
                    onDragEnd={onDragEnd}
                    className={clsx(
                      "flex items-center gap-3 py-2 px-2 border-b border-outline-variant last:border-b-0",
                      dragKey === key && "opacity-50",
                    )}
                  >
                    <span
                      aria-hidden
                      className="shrink-0 text-on-surface-variant cursor-grab active:cursor-grabbing"
                      title={isHebrew ? "גרור" : "Drag"}
                    >
                      <GripVertical className="h-5 w-5" strokeWidth={1.75} />
                    </span>
                    <span aria-hidden className="shrink-0 text-on-surface-variant">
                      <MobileNavIcon itemKey={key} />
                    </span>
                    <span className="flex-1 min-w-0 truncate font-bold text-on-surface text-sm">
                      {labels[key]}
                    </span>
                    {gate === "player" && (
                      <span className="shrink-0 text-[10px] font-bold tracking-wide px-2 py-1 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant border border-secondary-fixed-dim">
                        {isHebrew ? "רק משתתפים" : "Players only"}
                      </span>
                    )}
                    {gate === "admin" && (
                      <span className="shrink-0 text-[10px] font-bold tracking-wide px-2 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
                        {isHebrew ? "רק אדמין" : "Admin only"}
                      </span>
                    )}
                    <span
                      className={clsx(
                        "shrink-0 text-[10px] font-bold tracking-wide px-2 py-1 rounded-full",
                        inBar
                          ? "bg-primary-fixed text-primary"
                          : "bg-surface-container-high text-on-surface-variant",
                      )}
                    >
                      {inBar
                        ? isHebrew
                          ? "בסרגל"
                          : "Bar"
                        : isHebrew
                          ? "ב'עוד'"
                          : "In More"}
                    </span>
                    <div className="shrink-0 flex items-center gap-0">
                      <button
                        type="button"
                        onClick={() => moveItem(key, -1)}
                        disabled={idx === 0}
                        aria-label={isHebrew ? "הזז למעלה" : "Move up"}
                        className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <ArrowUp className="h-4 w-4" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(key, 1)}
                        disabled={idx === items.length - 1}
                        aria-label={isHebrew ? "הזז למטה" : "Move down"}
                        className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <ArrowDown className="h-4 w-4" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(key)}
                        aria-label={isHebrew ? "הסר" : "Remove"}
                        className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-error cursor-pointer"
                      >
                        <X className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Hidden items list */}
      {hidden.length > 0 && (
        <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 md:p-5">
          <h2 className="text-sm font-bold text-on-surface mb-1">
            {isHebrew ? "פריטים מוסתרים" : "Hidden items"}
          </h2>
          <p className="text-xs text-on-surface-variant mb-3 leading-relaxed">
            {isHebrew
              ? "פריטים שהסרת מהתפריט. לחץ על השחזר כדי להחזיר פריט לסוף הרשימה."
              : "Items you removed. Click restore to add them back to the end of the list."}
          </p>
          <ul className="flex flex-col">
            {hidden.map((key) => {
              const gate = catalog[key]?.roleGate;
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 py-2 px-2 border-b border-outline-variant last:border-b-0"
                >
                  <span aria-hidden className="shrink-0 text-on-surface-variant">
                    <MobileNavIcon itemKey={key} />
                  </span>
                  <span className="flex-1 min-w-0 truncate font-bold text-on-surface-variant text-sm">
                    {labels[key]}
                  </span>
                  {gate === "player" && (
                    <span className="shrink-0 text-[10px] font-bold tracking-wide px-2 py-1 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant border border-secondary-fixed-dim">
                      {isHebrew ? "רק משתתפים" : "Players only"}
                    </span>
                  )}
                  {gate === "admin" && (
                    <span className="shrink-0 text-[10px] font-bold tracking-wide px-2 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary-fixed-dim">
                      {isHebrew ? "רק אדמין" : "Admin only"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => restoreItem(key)}
                    aria-label={isHebrew ? "שחזר" : "Restore"}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-bold bg-primary-fixed text-primary hover:bg-primary-container transition-colors cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                    {isHebrew ? "שחזר" : "Restore"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Live preview */}
      <MobileNavPreview
        items={items}
        labels={labels}
        bottomBarCount={bottomBarCount}
        isHebrew={isHebrew}
      />

      {/* Save bar */}
      <div className="sticky bottom-0 -mx-4 md:mx-0 px-4 md:px-0 py-3 bg-surface/95 backdrop-blur border-t border-outline-variant flex items-center justify-between gap-3 z-10">
        <div className="text-xs min-h-[20px]">
          {errorMsg && <span className="text-error font-bold">{errorMsg}</span>}
          {!errorMsg && savedAt && !dirty && (
            <span className="text-primary font-bold">
              {isHebrew ? "✓ נשמר" : "✓ Saved"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetToSaved}
            disabled={!dirty || pending}
            className="px-4 py-2 rounded-full text-sm font-bold text-on-surface-variant hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {isHebrew ? "בטל" : "Cancel"}
          </button>
          <PillButton type="submit" disabled={!canSave}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isHebrew ? "שמור" : "Save"}
          </PillButton>
        </div>
      </div>
    </form>
  );
}

// Static visual mock of the mobile bar showing exactly what the bar
// will look like after save. Honours the bottomBarCount + items in
// state so the admin can see the layout update as they edit. Does
// not apply role gates — admins are usually previewing for players,
// and showing the unfiltered preview matches what they configure.
function MobileNavPreview({
  items,
  labels,
  bottomBarCount,
  isHebrew,
}: {
  items: MobileNavItemKey[];
  labels: Record<MobileNavItemKey, string>;
  bottomBarCount: number;
  isHebrew: boolean;
}) {
  const hasMore = items.length > bottomBarCount;
  const barSlots = hasMore ? Math.max(0, bottomBarCount - 1) : items.length;
  const barItems = items.slice(0, barSlots);
  const totalCells = barItems.length + (hasMore ? 1 : 0);

  return (
    <div>
      <h2 className="text-sm font-bold text-on-surface mb-2">
        {isHebrew ? "תצוגה מקדימה" : "Preview"}
      </h2>
      <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-3 max-w-sm">
        <div
          className="grid items-stretch bg-surface-container rounded-t-xl border border-outline-variant"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, totalCells)}, minmax(0, 1fr))`,
            minHeight: 64,
          }}
        >
          {barItems.map((key) => (
            <div
              key={key}
              className="flex flex-col items-center justify-center gap-1 px-1 py-2 min-h-[56px] text-on-surface-variant"
            >
              <MobileNavIcon itemKey={key} />
              <span className="font-[family-name:var(--font-label)] text-[10px] leading-none font-bold tracking-[0.03em] truncate max-w-full">
                {labels[key]}
              </span>
            </div>
          ))}
          {hasMore && (
            <div className="flex flex-col items-center justify-center gap-1 px-1 py-2 min-h-[56px] text-on-surface-variant">
              <span aria-hidden className="text-base">···</span>
              <span className="font-[family-name:var(--font-label)] text-[10px] leading-none font-bold tracking-[0.03em] truncate max-w-full">
                {isHebrew ? "עוד" : "More"}
              </span>
            </div>
          )}
        </div>
        {hasMore && (
          <p className="text-xs text-on-surface-variant mt-2 px-1">
            {isHebrew
              ? `+${items.length - barSlots} פריטים בתפריט 'עוד'`
              : `+${items.length - barSlots} items in the 'More' sheet`}
          </p>
        )}
      </div>
    </div>
  );
}
