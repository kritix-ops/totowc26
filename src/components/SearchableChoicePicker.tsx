"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";

// Generic searchable single-select picker. Built for tournament
// bets where the option list has ~50 teams or ~1,200 players and
// a button-grid would be unusable, but reusable anywhere we have
// more options than fit comfortably in a grid.
//
// Behaviour:
//   * Trigger is a full-width "pill" button showing the current
//     selection or the placeholder.
//   * Click opens a popover. On md+ it floats below the trigger;
//     on mobile it becomes a full-screen sheet so the option list
//     does not get cut off by other content / the keyboard.
//   * Search filter matches against the locale label AND the
//     non-locale label (so a Hebrew user can paste "Argentina"
//     and still find "ארגנטינה", and vice versa).
//   * Keyboard: arrow-up / arrow-down to navigate, Enter to
//     select, Escape to close. Focus on the search input the
//     moment the panel opens.
//   * Click outside closes. Mobile sheet has a backdrop tap that
//     does the same.

export type SearchableOption = {
  value: string;
  labelHe: string;
  labelEn: string;
  // Optional metadata for player-style options. When `groupHe`
  // (or `groupEn`) is present the picker groups rows by it and
  // surfaces a sticky group header — critical for usability when
  // the list is 1,200+ rows. When `subtitleHe`/`subtitleEn` is
  // present the picker shows it as a second line under the main
  // label (e.g. "#10 · Forward"). `icon` is rendered before the
  // label and is best used for short strings like flag emojis.
  groupHe?: string;
  groupEn?: string;
  subtitleHe?: string;
  subtitleEn?: string;
  icon?: string;
};

export function SearchableChoicePicker({
  options,
  currentValue,
  locale,
  onChange,
  disabled,
  placeholder,
}: {
  options: SearchableOption[];
  currentValue: string | null;
  locale: Locale;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const isHebrew = locale === "he";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const currentOption = useMemo(
    () => options.find((o) => o.value === currentValue) ?? null,
    [options, currentValue],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      // Search every text field on the option so a player roster
      // can be queried by team ("argentina"), position ("forward"),
      // jersey ("#10"), or any of the names. Each lowercase
      // toLowerCase call is cheap; doing them inside the filter
      // (rather than precomputing) keeps the option shape clean.
      if (o.labelHe.toLowerCase().includes(q)) return true;
      if (o.labelEn.toLowerCase().includes(q)) return true;
      if (o.value.toLowerCase().includes(q)) return true;
      if (o.subtitleHe?.toLowerCase().includes(q)) return true;
      if (o.subtitleEn?.toLowerCase().includes(q)) return true;
      if (o.groupHe?.toLowerCase().includes(q)) return true;
      if (o.groupEn?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [options, query]);

  // Group the filtered list by `groupHe`/`groupEn` if any options
  // carry group metadata. Returns a flat array of either a header
  // row or an option row. `optionIndex` on option rows is the
  // index into `filtered` (i.e. the activeIndex space), so arrow-
  // key navigation can hop between options without us tracking a
  // separate position. Preserves the input order — callers are
  // expected to sort options themselves before passing them in.
  type GroupedRow =
    | { kind: "header"; key: string; labelHe: string; labelEn: string }
    | { kind: "option"; option: SearchableOption; optionIndex: number };
  const grouped: GroupedRow[] = useMemo(() => {
    const anyGrouped = filtered.some((o) => o.groupHe || o.groupEn);
    if (!anyGrouped) {
      return filtered.map((o, i) => ({
        kind: "option" as const,
        option: o,
        optionIndex: i,
      }));
    }
    const rows: GroupedRow[] = [];
    let lastGroup: string | null = null;
    filtered.forEach((o, i) => {
      const groupKey = `${o.groupHe ?? ""}|${o.groupEn ?? ""}`;
      if (groupKey !== lastGroup) {
        lastGroup = groupKey;
        rows.push({
          kind: "header",
          key: `${groupKey}|${i}`,
          labelHe: o.groupHe ?? "",
          labelEn: o.groupEn ?? "",
        });
      }
      rows.push({ kind: "option", option: o, optionIndex: i });
    });
    return rows;
  }, [filtered]);

  // Reset the active index whenever the filtered list changes so
  // arrow-keys land somewhere sensible (the first match).
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Click-outside on desktop. The mobile sheet uses an explicit
  // backdrop, so this is desktop-only behaviour.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      if (!rootRef.current) return;
      if (e.target instanceof Node && !rootRef.current.contains(e.target)) {
        // Mobile sheet has its own backdrop. On desktop we just
        // close — checking pointer type avoids closing twice when
        // the backdrop also fires.
        if (window.matchMedia("(min-width: 768px)").matches) {
          setOpen(false);
        }
      }
    };
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [open]);

  // Autofocus the search input + lock body scroll when the sheet
  // opens on mobile.
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (isMobile) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  // Scroll the active row into view on arrow navigation.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-active="true"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const picked = filtered[activeIndex];
      if (picked) {
        onChange(picked.value);
        setOpen(false);
      }
    }
  };

  const triggerLabel = currentOption
    ? isHebrew
      ? currentOption.labelHe
      : currentOption.labelEn
    : placeholder ?? (isHebrew ? "בחר…" : "Select…");

  // Two-line secondary: subtitle from the option (e.g. "#10 ·
  // Forward") joined with the non-locale name. Both optional, so
  // a plain team option still gets the simple Hebrew↔English
  // mapping that PR-3a shipped with.
  const triggerSubtitle = currentOption
    ? isHebrew
      ? currentOption.subtitleHe
      : currentOption.subtitleEn
    : null;
  const triggerSecondaryName =
    currentOption && currentOption.labelHe !== currentOption.labelEn
      ? isHebrew
        ? currentOption.labelEn
        : currentOption.labelHe
      : null;

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          "press-down w-full min-h-[52px] px-4 inline-flex items-center justify-between gap-3 rounded-full border text-base font-bold transition-colors",
          currentOption
            ? "border-2 border-primary bg-primary-container text-on-primary-container shadow-sm"
            : "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container",
          disabled && "opacity-60 cursor-not-allowed",
        )}
      >
        {currentOption?.icon && (
          <span className="text-xl shrink-0" aria-hidden>
            {currentOption.icon}
          </span>
        )}
        <span className="flex-1 min-w-0 flex flex-col items-start gap-0.5 text-start">
          <span className="truncate w-full">{triggerLabel}</span>
          {(triggerSubtitle || triggerSecondaryName) && (
            <span className="flex items-center gap-2 text-[11px] font-normal opacity-60 truncate w-full">
              {triggerSubtitle && (
                <span className="truncate" dir={isHebrew ? "rtl" : "ltr"}>
                  {triggerSubtitle}
                </span>
              )}
              {triggerSubtitle && triggerSecondaryName && (
                <span aria-hidden className="opacity-70">·</span>
              )}
              {triggerSecondaryName && (
                <span className="truncate" dir={isHebrew ? "ltr" : "rtl"}>
                  {triggerSecondaryName}
                </span>
              )}
            </span>
          )}
        </span>
        <ChevronDown
          className={clsx(
            "h-5 w-5 shrink-0 transition-transform",
            open && "rotate-180",
          )}
          strokeWidth={2}
        />
      </button>

      {open && (
        <>
          {/* Mobile-only backdrop. Tap closes the sheet. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="md:hidden fixed inset-0 bg-black/40 z-40"
          />

          <div
            className={clsx(
              "z-50 flex flex-col bg-surface-container-low border-outline-variant shadow-[0_12px_32px_rgba(28,20,15,0.16)]",
              // Mobile: full-width sheet pinned to the bottom of
              // the viewport, max-height 70dvh per project rule.
              "md:hidden fixed left-0 right-0 bottom-0 border-t rounded-t-2xl max-h-[70dvh] pb-[env(safe-area-inset-bottom)]",
            )}
          >
            <PanelContents
              isHebrew={isHebrew}
              query={query}
              setQuery={setQuery}
              grouped={grouped}
              filteredCount={filtered.length}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              currentValue={currentValue}
              onPick={(v) => {
                onChange(v);
                setOpen(false);
              }}
              onClear={() => {
                onChange(null);
                setOpen(false);
              }}
              onKeyDown={handleKey}
              searchRef={searchRef}
              listRef={listRef}
              showCloseButton
              onClose={() => setOpen(false)}
            />
          </div>

          {/* Desktop popover: absolute, anchored to the trigger. */}
          <div
            className={clsx(
              "hidden md:flex z-50 absolute left-0 right-0 mt-2 flex-col bg-surface-container-low border border-outline-variant rounded-2xl shadow-[0_12px_32px_rgba(28,20,15,0.16)] max-h-[420px] overflow-hidden",
            )}
          >
            <PanelContents
              isHebrew={isHebrew}
              query={query}
              setQuery={setQuery}
              grouped={grouped}
              filteredCount={filtered.length}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              currentValue={currentValue}
              onPick={(v) => {
                onChange(v);
                setOpen(false);
              }}
              onClear={() => {
                onChange(null);
                setOpen(false);
              }}
              onKeyDown={handleKey}
              searchRef={searchRef}
              listRef={listRef}
            />
          </div>
        </>
      )}
    </div>
  );
}

// Internal — the actual searchbox + scrollable list. Used in both
// the mobile-sheet and desktop-popover containers so the markup
// stays in sync between layouts.
type GroupedRow =
  | { kind: "header"; key: string; labelHe: string; labelEn: string }
  | { kind: "option"; option: SearchableOption; optionIndex: number };

function PanelContents({
  isHebrew,
  query,
  setQuery,
  grouped,
  filteredCount,
  activeIndex,
  setActiveIndex,
  currentValue,
  onPick,
  onClear,
  onKeyDown,
  searchRef,
  listRef,
  showCloseButton,
  onClose,
}: {
  isHebrew: boolean;
  query: string;
  setQuery: (v: string) => void;
  grouped: GroupedRow[];
  filteredCount: number;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  currentValue: string | null;
  onPick: (v: string) => void;
  onClear: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  listRef: React.RefObject<HTMLUListElement | null>;
  showCloseButton?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="p-3 border-b border-outline-variant flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-on-surface-variant pointer-events-none"
            strokeWidth={2}
            aria-hidden
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isHebrew ? "חיפוש שם, קבוצה, עמדה…" : "Search name, team, position…"}
            dir={isHebrew ? "rtl" : "ltr"}
            inputMode="search"
            autoComplete="off"
            className="w-full h-12 ps-9 pe-3 rounded-lg bg-surface-container-lowest border border-outline text-base focus:outline-none focus:border-primary"
          />
        </div>
        {showCloseButton && (
          <button
            type="button"
            onClick={onClose}
            aria-label={isHebrew ? "סגור" : "Close"}
            className="press-down min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-full bg-surface-container text-on-surface border border-outline-variant"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>

      <ul
        ref={listRef}
        role="listbox"
        className="flex-1 overflow-y-auto py-1"
      >
        {filteredCount === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-on-surface-variant">
            {isHebrew ? "אין תוצאות" : "No results"}
          </li>
        ) : (
          grouped.map((row) => {
            if (row.kind === "header") {
              return (
                <li
                  key={row.key}
                  className="sticky top-0 z-10 px-4 py-1.5 bg-surface-container-low text-[11px] font-bold tracking-[0.05em] uppercase text-on-surface-variant border-b border-outline-variant"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {isHebrew ? row.labelHe : row.labelEn}
                  </span>
                </li>
              );
            }
            const o = row.option;
            const i = row.optionIndex;
            const isActive = i === activeIndex;
            const isSelected = o.value === currentValue;
            const subtitle = isHebrew ? o.subtitleHe : o.subtitleEn;
            const secondaryName = o.labelHe !== o.labelEn
              ? (isHebrew ? o.labelEn : o.labelHe)
              : null;
            return (
              <li key={o.value} data-active={isActive ? "true" : "false"}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setActiveIndex(i)}
                  onClick={() => onPick(o.value)}
                  className={clsx(
                    "w-full min-h-[48px] px-4 py-2 flex items-center gap-3 text-start transition-colors",
                    isActive && "bg-surface-container",
                    isSelected && "bg-primary-container text-on-primary-container",
                  )}
                >
                  {o.icon && (
                    <span className="text-xl shrink-0" aria-hidden>
                      {o.icon}
                    </span>
                  )}
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5 text-start">
                    <span className="font-bold text-base truncate">
                      {isHebrew ? o.labelHe : o.labelEn}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] opacity-70 truncate">
                      {subtitle && (
                        <span className="truncate" dir={isHebrew ? "rtl" : "ltr"}>
                          {subtitle}
                        </span>
                      )}
                      {subtitle && secondaryName && (
                        <span aria-hidden className="opacity-50">·</span>
                      )}
                      {secondaryName && (
                        <span className="truncate" dir={isHebrew ? "ltr" : "rtl"}>
                          {secondaryName}
                        </span>
                      )}
                    </span>
                  </span>
                  {isSelected && (
                    <Check className="h-5 w-5 shrink-0" strokeWidth={2.5} />
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>

      {filteredCount > 0 && (
        <div className="px-4 py-1 border-t border-outline-variant text-[10px] text-on-surface-variant text-center">
          {isHebrew
            ? `${filteredCount} תוצאות${query ? "" : " · השתמש בחיפוש כדי לסנן"}`
            : `${filteredCount} results${query ? "" : " · search to narrow down"}`}
        </div>
      )}

      {currentValue && (
        <div className="p-2 border-t border-outline-variant flex justify-end">
          <button
            type="button"
            onClick={onClear}
            className="press-down inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-bold bg-surface-container-lowest text-on-surface-variant border border-outline-variant hover:bg-surface-container"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
            {isHebrew ? "נקה בחירה" : "Clear selection"}
          </button>
        </div>
      )}
    </div>
  );
}
