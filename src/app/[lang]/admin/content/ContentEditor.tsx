"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
  Save,
  Search,
} from "lucide-react";
import { clsx } from "clsx";

import type { Locale } from "../../dictionaries";
import { saveOverride } from "./actions";

export type ContentEntry = {
  key: string;
  section: string;
  shortKey: string;
  defaultHe: string;
  defaultEn: string;
  overrideHe: string | null;
  overrideEn: string | null;
};

type RowState = {
  he: string;
  en: string;
  // Mirrors the DB row so the "Overridden" badge stays in sync after
  // a save without us mutating the prop entries array.
  overrideHe: string | null;
  overrideEn: string | null;
  status: "idle" | "saving" | "saved" | "error";
  errorHe: string | null;
  errorEn: string | null;
};

function buildInitial(entries: ContentEntry[]): Record<string, RowState> {
  const map: Record<string, RowState> = {};
  for (const e of entries) {
    map[e.key] = {
      he: e.overrideHe ?? e.defaultHe,
      en: e.overrideEn ?? e.defaultEn,
      overrideHe: e.overrideHe,
      overrideEn: e.overrideEn,
      status: "idle",
      errorHe: null,
      errorEn: null,
    };
  }
  return map;
}

export function ContentEditor({
  locale,
  entries,
}: {
  locale: Locale;
  entries: ContentEntry[];
}) {
  const isHebrew = locale === "he";
  const [query, setQuery] = useState("");
  const [onlyOverridden, setOnlyOverridden] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [state, setState] = useState<Record<string, RowState>>(() =>
    buildInitial(entries),
  );
  const [, startTransition] = useTransition();

  // Group entries by section and apply filters in one pass so the
  // render doesn't have to re-scan the whole array per row. Reads
  // override status from `state` (not entries) so the section badge
  // counts stay accurate after a save.
  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Array<{
      section: string;
      rows: ContentEntry[];
      overriddenCount: number;
    }> = [];
    const bySection = new Map<string, ContentEntry[]>();
    for (const e of entries) {
      const rowState = state[e.key];
      const overridden =
        rowState.overrideHe !== null || rowState.overrideEn !== null;
      if (onlyOverridden && !overridden) continue;
      if (q) {
        const hay =
          e.key.toLowerCase() +
          "\n" +
          e.defaultHe.toLowerCase() +
          "\n" +
          e.defaultEn.toLowerCase() +
          "\n" +
          (rowState.overrideHe?.toLowerCase() ?? "") +
          "\n" +
          (rowState.overrideEn?.toLowerCase() ?? "");
        if (!hay.includes(q)) continue;
      }
      const arr = bySection.get(e.section) ?? [];
      arr.push(e);
      bySection.set(e.section, arr);
    }
    for (const [section, rows] of bySection) {
      out.push({
        section,
        rows,
        overriddenCount: rows.filter((r) => {
          const rs = state[r.key];
          return rs.overrideHe !== null || rs.overrideEn !== null;
        }).length,
      });
    }
    return out;
  }, [entries, query, onlyOverridden, state]);

  // When a filter is active we expand every matched section so the
  // admin doesn't have to click into each one to see hits.
  const isFilterActive = query.trim().length > 0 || onlyOverridden;

  function toggle(section: string) {
    setOpenSections((s) => ({ ...s, [section]: !s[section] }));
  }

  function setField(key: string, locale: "he" | "en", value: string) {
    setState((s) => ({
      ...s,
      [key]: { ...s[key], [locale]: value, status: "idle" },
    }));
  }

  async function persist(
    entry: ContentEntry,
    targetLocale: "he" | "en",
    value: string | null,
  ) {
    console.info("[admin content ui] save_click", {
      key: entry.key,
      locale: targetLocale,
      mode: value === null ? "reset" : "set",
    });
    setState((s) => ({
      ...s,
      [entry.key]: {
        ...s[entry.key],
        status: "saving",
        errorHe: targetLocale === "he" ? null : s[entry.key].errorHe,
        errorEn: targetLocale === "en" ? null : s[entry.key].errorEn,
      },
    }));
    const defaultValue =
      targetLocale === "he" ? entry.defaultHe : entry.defaultEn;
    const result = await saveOverride({
      key: entry.key,
      locale: targetLocale,
      defaultValue,
      newValue: value,
    });
    if (result.ok) {
      console.info("[admin content ui] save_ok", {
        key: entry.key,
        locale: targetLocale,
      });
      // Reflect the new "effective" value AND the new override-row
      // presence locally so the next render shows the override badge
      // (or clears it after reset) without a server round-trip.
      setState((s) => {
        const next = { ...s[entry.key] };
        if (value === null) {
          if (targetLocale === "he") {
            next.he = entry.defaultHe;
            next.overrideHe = null;
            next.errorHe = null;
          } else {
            next.en = entry.defaultEn;
            next.overrideEn = null;
            next.errorEn = null;
          }
        } else {
          if (targetLocale === "he") {
            next.he = value;
            next.overrideHe = value;
            next.errorHe = null;
          } else {
            next.en = value;
            next.overrideEn = value;
            next.errorEn = null;
          }
        }
        next.status = "saved";
        return { ...s, [entry.key]: next };
      });
    } else {
      const msg = errorMessage(result.error, isHebrew, result.missingSlots);
      console.warn("[admin content ui] save_failed", {
        key: entry.key,
        locale: targetLocale,
        error: result.error,
      });
      setState((s) => ({
        ...s,
        [entry.key]: {
          ...s[entry.key],
          status: "error",
          errorHe: targetLocale === "he" ? msg : s[entry.key].errorHe,
          errorEn: targetLocale === "en" ? msg : s[entry.key].errorEn,
        },
      }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <label className="relative block">
          <span className="sr-only">{isHebrew ? "חיפוש" : "Search"}</span>
          <Search
            className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-on-surface-variant pointer-events-none"
            strokeWidth={2}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isHebrew
                ? "חיפוש לפי מפתח או טקסט (עברית או אנגלית)"
                : "Search by key or text (Hebrew or English)"
            }
            className="w-full ps-10 pe-3 py-3 min-h-[48px] text-base rounded-lg bg-surface-container-lowest border border-outline focus:outline-none focus:border-primary"
          />
        </label>
        <label className="inline-flex items-center gap-2 self-start text-sm cursor-pointer min-h-[44px]">
          <input
            type="checkbox"
            checked={onlyOverridden}
            onChange={(e) => setOnlyOverridden(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          <span>
            {isHebrew
              ? "הצג רק שינויים מברירת המחדל"
              : "Show only overridden"}
          </span>
        </label>
      </div>

      {filteredSections.length === 0 ? (
        <div className="px-4 py-10 text-center text-on-surface-variant border border-dashed border-outline rounded-lg">
          {isHebrew ? "אין תוצאות לחיפוש." : "No matches."}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {filteredSections.map(({ section, rows, overriddenCount }) => {
            const open = isFilterActive ? true : !!openSections[section];
            return (
              <li
                key={section}
                className="border border-outline-variant rounded-lg overflow-hidden bg-surface-container-low"
              >
                <button
                  type="button"
                  onClick={() => toggle(section)}
                  disabled={isFilterActive}
                  className="w-full px-4 py-3 min-h-[56px] flex items-center gap-3 hover:bg-surface-container disabled:hover:bg-transparent transition-colors text-start"
                >
                  {open ? (
                    <ChevronDown
                      className="h-4 w-4 text-on-surface-variant shrink-0"
                      strokeWidth={2}
                    />
                  ) : (
                    <ChevronRight
                      className="h-4 w-4 text-on-surface-variant shrink-0 rtl:rotate-180"
                      strokeWidth={2}
                    />
                  )}
                  <span className="font-bold text-base text-on-surface flex-1 min-w-0 truncate">
                    {section}
                  </span>
                  <span className="text-xs text-on-surface-variant shrink-0 tabular-nums">
                    {rows.length}
                  </span>
                  {overriddenCount > 0 && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant shrink-0 tabular-nums">
                      {overriddenCount}
                    </span>
                  )}
                </button>
                {open && (
                  <ul className="border-t border-outline-variant divide-y divide-outline-variant">
                    {rows.map((entry) => (
                      <Row
                        key={entry.key}
                        entry={entry}
                        state={state[entry.key]}
                        isHebrew={isHebrew}
                        onChange={setField}
                        onSave={(loc, val) =>
                          startTransition(() => {
                            void persist(entry, loc, val);
                          })
                        }
                      />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Row({
  entry,
  state,
  isHebrew,
  onChange,
  onSave,
}: {
  entry: ContentEntry;
  state: RowState;
  isHebrew: boolean;
  onChange: (key: string, locale: "he" | "en", value: string) => void;
  onSave: (locale: "he" | "en", value: string | null) => void;
}) {
  const heDirty = state.he !== (state.overrideHe ?? entry.defaultHe);
  const enDirty = state.en !== (state.overrideEn ?? entry.defaultEn);
  const heOverridden = state.overrideHe !== null;
  const enOverridden = state.overrideEn !== null;
  const saving = state.status === "saving";
  return (
    <li className="px-4 py-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <code className="text-xs text-on-surface-variant break-all">
          {entry.key}
        </code>
        {(heOverridden || enOverridden) && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant">
            {isHebrew ? "מותאם" : "Overridden"}
          </span>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={isHebrew ? "עברית" : "Hebrew"}
          dir="rtl"
          value={state.he}
          dirty={heDirty}
          overridden={heOverridden}
          defaultValue={entry.defaultHe}
          error={state.errorHe}
          saving={saving}
          isHebrew={isHebrew}
          onChange={(v) => onChange(entry.key, "he", v)}
          onSave={() => onSave("he", state.he)}
          onReset={() => onSave("he", null)}
        />
        <Field
          label={isHebrew ? "אנגלית" : "English"}
          dir="ltr"
          value={state.en}
          dirty={enDirty}
          overridden={enOverridden}
          defaultValue={entry.defaultEn}
          error={state.errorEn}
          saving={saving}
          isHebrew={isHebrew}
          onChange={(v) => onChange(entry.key, "en", v)}
          onSave={() => onSave("en", state.en)}
          onReset={() => onSave("en", null)}
        />
      </div>
    </li>
  );
}

function Field({
  label,
  dir,
  value,
  dirty,
  overridden,
  defaultValue,
  error,
  saving,
  isHebrew,
  onChange,
  onSave,
  onReset,
}: {
  label: string;
  dir: "rtl" | "ltr";
  value: string;
  dirty: boolean;
  overridden: boolean;
  defaultValue: string;
  error: string | null;
  saving: boolean;
  isHebrew: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  // Single-line strings (no \n in default) render as input, longer ones
  // as textarea. Avoids the visual weight of a multi-line box for a
  // 5-char label, but lets paragraphs grow.
  const multiline = defaultValue.length > 80 || defaultValue.includes("\n");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
          {label}
        </span>
        <div className="flex items-center gap-1">
          {overridden && (
            <button
              type="button"
              onClick={onReset}
              disabled={saving}
              className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary disabled:opacity-50 min-h-[32px] px-1.5"
              title={isHebrew ? "איפוס לברירת מחדל" : "Reset to default"}
            >
              <RotateCcw className="h-3 w-3" strokeWidth={2} />
              <span className="hidden sm:inline">
                {isHebrew ? "איפוס" : "Reset"}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className={clsx(
              "inline-flex items-center gap-1 text-xs font-bold min-h-[32px] px-3 rounded-full transition-colors",
              dirty && !saving
                ? "bg-primary text-on-primary"
                : "bg-surface-container text-on-surface-variant",
              "disabled:opacity-60",
            )}
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <Save className="h-3 w-3" strokeWidth={2} />
            )}
            <span>{isHebrew ? "שמור" : "Save"}</span>
          </button>
        </div>
      </div>
      {multiline ? (
        <textarea
          value={value}
          dir={dir}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.max(2, Math.ceil(defaultValue.length / 60))}
          className="w-full px-3 py-2 min-h-[48px] text-base rounded-md bg-surface-container-lowest border border-outline focus:outline-none focus:border-primary resize-y"
        />
      ) : (
        <input
          type="text"
          value={value}
          dir={dir}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 min-h-[48px] text-base rounded-md bg-surface-container-lowest border border-outline focus:outline-none focus:border-primary"
        />
      )}
      {overridden && (
        <details className="text-xs text-on-surface-variant">
          <summary className="cursor-pointer">
            {isHebrew ? "הצג ברירת מחדל מהקוד" : "Show default from code"}
          </summary>
          <pre
            dir={dir}
            className="mt-1 p-2 rounded bg-surface-container whitespace-pre-wrap break-words font-sans"
          >
            {defaultValue}
          </pre>
        </details>
      )}
      {error && (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function errorMessage(
  error:
    | "unauthorized"
    | "forbidden"
    | "invalid_locale"
    | "invalid_value"
    | "missing_slot"
    | "db",
  isHebrew: boolean,
  missingSlots?: string[],
): string {
  if (error === "missing_slot" && missingSlots && missingSlots.length > 0) {
    const joined = missingSlots.join(", ");
    return isHebrew
      ? `חסרים תווי החלפה: ${joined}. אסור להסיר אותם, אחרת המחרוזת תוצג שבורה.`
      : `Missing interpolation slots: ${joined}. Removing them breaks the rendered string.`;
  }
  if (error === "invalid_value") {
    return isHebrew
      ? "הערך לא תקין. ריק או ארוך מ-4000 תווים?"
      : "Invalid value. Empty or over 4000 chars?";
  }
  if (error === "unauthorized" || error === "forbidden") {
    return isHebrew ? "אין הרשאה." : "Not allowed.";
  }
  if (error === "invalid_locale") {
    return isHebrew ? "שפה לא נתמכת." : "Unsupported locale.";
  }
  return isHebrew ? "שמירה נכשלה. נסה שוב." : "Save failed. Try again.";
}
