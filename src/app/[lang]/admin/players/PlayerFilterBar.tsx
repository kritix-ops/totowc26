"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import type { AdminPlayerReviewRow } from "@/db/admin-queries";
import { SearchableChoicePicker } from "@/components/SearchableChoicePicker";
import type {
  FilterCounts,
  PlayerFilters,
  PlayerLockKey,
  PlayerPositionKey,
  PlayerSourceKey,
  PlayerVerdictKey,
} from "./player-filters";

// Top of /admin/players: search box + filter chips + an expandable
// "more filters" drawer. Everything renders mobile-first; the
// always-visible row stays under one screen height at 360px so an
// admin triaging on a phone never loses the first row of results
// behind chrome.
//
// Active-filter count badge on the "More filters" button so the
// drawer-being-closed-but-filters-applied state is obvious.

export function PlayerFilterBar({
  locale,
  filters,
  onChange,
  counts,
  rows,
}: {
  locale: Locale;
  filters: PlayerFilters;
  onChange: (next: PlayerFilters) => void;
  counts: FilterCounts;
  rows: AdminPlayerReviewRow[];
}) {
  const isHebrew = locale === "he";
  const [expanded, setExpanded] = useState(false);

  // Distinct teams derived from the loaded rows so we don't ship a
  // separate teams payload and the picker stays in sync with what's
  // actually in the queue (if a team somehow has zero players, it
  // would not appear here).
  const teamOptions = useMemo(() => {
    const byCode = new Map<
      string,
      { code: string; nameHe: string; nameEn: string; flag: string }
    >();
    for (const r of rows) {
      if (byCode.has(r.teamCode)) continue;
      byCode.set(r.teamCode, {
        code: r.teamCode,
        nameHe: r.teamNameHe,
        nameEn: r.teamNameEn,
        flag: r.teamFlag,
      });
    }
    const sorted = [...byCode.values()].sort((a, b) =>
      (isHebrew ? a.nameHe : a.nameEn).localeCompare(
        isHebrew ? b.nameHe : b.nameEn,
        isHebrew ? "he" : "en",
      ),
    );
    return sorted.map((t) => {
      const n = counts.team.get(t.code) ?? 0;
      return {
        value: t.code,
        labelHe: `${t.nameHe} (${n})`,
        labelEn: `${t.nameEn} (${n})`,
        icon: t.flag,
      };
    });
  }, [rows, counts.team, isHebrew]);

  // Count active filter dimensions for the "More filters (N)" badge.
  // Search and verdict are excluded — they have their own visible
  // chrome, so counting them again here would be noisy.
  const advancedActiveCount =
    (filters.team !== null ? 1 : 0) +
    (filters.source !== "any" ? 1 : 0) +
    (filters.position !== "any" ? 1 : 0) +
    (filters.lock !== "any" ? 1 : 0);

  const set = (patch: Partial<PlayerFilters>) =>
    onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: search box */}
      <SearchBox
        value={filters.search}
        onChange={(v) => set({ search: v })}
        isHebrew={isHebrew}
      />

      {/* Row 2: verdict chip strip */}
      <VerdictChips
        active={filters.verdict}
        counts={counts.verdict}
        onPick={(v) => set({ verdict: v })}
        isHebrew={isHebrew}
      />

      {/* Row 3: expand toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="press-down self-start inline-flex items-center gap-2 h-10 px-4 rounded-full bg-surface-container-low text-on-surface border border-outline-variant text-sm font-bold"
        aria-expanded={expanded}
      >
        <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
        <span>{isHebrew ? "פילטרים מתקדמים" : "More filters"}</span>
        {advancedActiveCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-on-primary text-[11px] font-bold tabular-nums">
            {advancedActiveCount}
          </span>
        )}
        <ChevronDown
          className={clsx(
            "h-4 w-4 transition-transform",
            expanded && "rotate-180",
          )}
          strokeWidth={2}
        />
      </button>

      {/* Row 4: expanded drawer */}
      {expanded && (
        <div className="flex flex-col gap-4 p-3 md:p-4 rounded-2xl border border-outline-variant bg-surface-container-lowest">
          <FilterSection
            label={isHebrew ? "נבחרת" : "Team"}
          >
            <SearchableChoicePicker
              options={teamOptions}
              currentValue={filters.team}
              locale={locale}
              onChange={(v) => set({ team: v })}
              placeholder={
                isHebrew ? "כל הנבחרות" : "All teams"
              }
            />
          </FilterSection>

          <FilterSection
            label={isHebrew ? "מקור התרגום" : "Translation source"}
          >
            <PillRow
              items={[
                { key: "any",          labelHe: "הכל",          labelEn: "All",         n: counts.source.any },
                { key: "wikidata",     labelHe: "ויקידאטה",     labelEn: "Wikidata",    n: counts.source.wikidata },
                { key: "llm_claude",   labelHe: "LLM (תרגום)",  labelEn: "LLM",         n: counts.source.llm_claude },
                { key: "llm_reviewer", labelHe: "LLM (סקירה)",  labelEn: "LLM review",  n: counts.source.llm_reviewer },
                { key: "manual",       labelHe: "ידני",         labelEn: "Manual",      n: counts.source.manual },
                { key: "none",         labelHe: "ללא",          labelEn: "None",        n: counts.source.none },
              ]}
              active={filters.source}
              onPick={(k) => set({ source: k as PlayerSourceKey })}
              isHebrew={isHebrew}
            />
          </FilterSection>

          <FilterSection
            label={isHebrew ? "עמדה" : "Position"}
          >
            <PillRow
              items={[
                { key: "any",         labelHe: "הכל",   labelEn: "All",          n: counts.position.any },
                { key: "goalkeeper",  labelHe: "שוער",  labelEn: "Goalkeeper",   n: counts.position.goalkeeper },
                { key: "defender",    labelHe: "מגן",   labelEn: "Defender",     n: counts.position.defender },
                { key: "midfielder",  labelHe: "קשר",   labelEn: "Midfielder",   n: counts.position.midfielder },
                { key: "attacker",    labelHe: "חלוץ",  labelEn: "Attacker",     n: counts.position.attacker },
                { key: "none",        labelHe: "ללא",   labelEn: "Unknown",      n: counts.position.none },
              ]}
              active={filters.position}
              onPick={(k) => set({ position: k as PlayerPositionKey })}
              isHebrew={isHebrew}
            />
          </FilterSection>

          <FilterSection
            label={isHebrew ? "נעילה" : "Lock"}
          >
            <PillRow
              items={[
                { key: "any",      labelHe: "הכל",       labelEn: "All",       n: counts.lock.any },
                { key: "locked",   labelHe: "נעולים",    labelEn: "Locked",    n: counts.lock.locked },
                { key: "unlocked", labelHe: "לא נעולים", labelEn: "Unlocked",  n: counts.lock.unlocked },
              ]}
              active={filters.lock}
              onPick={(k) => set({ lock: k as PlayerLockKey })}
              isHebrew={isHebrew}
            />
          </FilterSection>
        </div>
      )}
    </div>
  );
}

// ---------- pieces ----------

function SearchBox({
  value,
  onChange,
  isHebrew,
}: {
  value: string;
  onChange: (v: string) => void;
  isHebrew: boolean;
}) {
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
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          isHebrew
            ? "חיפוש שחקן, נבחרת, מספר חולצה…"
            : "Search player, team, jersey…"
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
          onClick={() => onChange("")}
          aria-label={isHebrew ? "נקה חיפוש" : "Clear search"}
          className="absolute top-1/2 -translate-y-1/2 end-2 inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-surface-container text-on-surface-variant"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

function VerdictChips({
  active,
  counts,
  onPick,
  isHebrew,
}: {
  active: PlayerVerdictKey;
  counts: Record<PlayerVerdictKey, number>;
  onPick: (v: PlayerVerdictKey) => void;
  isHebrew: boolean;
}) {
  const items: Array<{
    key: PlayerVerdictKey;
    labelHe: string;
    labelEn: string;
    tone: "neutral" | "error" | "warn" | "info" | "success";
  }> = [
    { key: "all",        labelHe: "הכל",       labelEn: "All",        tone: "neutral" },
    { key: "reject",     labelHe: "דחויים",    labelEn: "Rejected",   tone: "error" },
    { key: "flag",       labelHe: "מסומנים",   labelEn: "Flagged",    tone: "warn" },
    { key: "unreviewed", labelHe: "טרם נסקרו", labelEn: "Unreviewed", tone: "info" },
    { key: "approved",   labelHe: "מאושרים",   labelEn: "Approved",   tone: "success" },
  ];
  return (
    <nav
      aria-label={isHebrew ? "סינון לפי סטטוס" : "Filter by verdict"}
      className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-1 px-1"
    >
      {items.map((it) => {
        const isActive = it.key === active;
        const palette = isActive
          ? verdictActivePalette(it.tone)
          : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container";
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onPick(it.key)}
            className={clsx(
              "snap-start press-down inline-flex items-center gap-2 h-10 px-4 rounded-full border text-sm font-bold whitespace-nowrap",
              palette,
            )}
            aria-pressed={isActive}
          >
            <span>{isHebrew ? it.labelHe : it.labelEn}</span>
            <span className="tabular-nums opacity-80 bidi-ltr">
              {counts[it.key]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function verdictActivePalette(
  tone: "neutral" | "error" | "warn" | "info" | "success",
): string {
  switch (tone) {
    case "error":   return "bg-error-container text-on-error-container border-error";
    case "warn":    return "bg-tertiary-container text-on-tertiary-container border-tertiary-fixed-dim";
    case "info":    return "bg-primary-container text-on-primary-container border-primary";
    case "success": return "bg-secondary-container text-on-secondary-container border-secondary-fixed";
    case "neutral":
    default:        return "bg-primary text-on-primary border-primary";
  }
}

function FilterSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold tracking-[0.05em] uppercase text-on-surface-variant">
        {label}
      </span>
      {children}
    </div>
  );
}

function PillRow<K extends string>({
  items,
  active,
  onPick,
  isHebrew,
}: {
  items: Array<{ key: K; labelHe: string; labelEn: string; n: number }>;
  active: K;
  onPick: (k: K) => void;
  isHebrew: boolean;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {items.map((it) => {
        const isActive = it.key === active;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onPick(it.key)}
            aria-pressed={isActive}
            className={clsx(
              "press-down inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-full border text-xs font-bold whitespace-nowrap transition-colors",
              isActive
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-container",
            )}
          >
            <span>{isHebrew ? it.labelHe : it.labelEn}</span>
            <span className="tabular-nums opacity-80 bidi-ltr">{it.n}</span>
          </button>
        );
      })}
    </div>
  );
}
