"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ScrollText,
  ChevronDown,
} from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../../dictionaries";
import { LabelCaps } from "@/components/ui";
import { listRecentGenRuns, type GenRunRow } from "./actions";

// Fired by the generate buttons the instant a run is scheduled, so the log
// refreshes immediately instead of waiting for the next poll tick.
export const LIVE_GEN_STARTED_EVENT = "live-gen-started";

// Inline, live log of AI generation runs. Generation happens in the background
// (after()), so the admin used to get only a notification with no detail. This
// panel polls listRecentGenRuns and shows, right on the suggestions page, each
// run's progress, the model + token usage, any error, and exactly how many
// suggestions it produced — so nothing requires leaving the page.
//
// Polling cadence adapts: fast (4s) while any run is still 'running', slow
// (15s) once everything has settled, so it stays responsive during a run
// without hammering the DB when idle.
//
// The list is an accordion, collapsed by default, so the (up to 12) run rows
// don't push the rest of the page down. A live run surfaces a "רץ" badge on
// the collapsed header — polling keeps refreshing underneath — but never
// auto-opens the panel, which would reintroduce the long-scroll it avoids.

const FAST_MS = 4_000;
const SLOW_MS = 15_000;

export function GenerationLog({
  initialRuns,
  locale,
}: {
  initialRuns: GenRunRow[];
  locale: Locale;
}) {
  const isHebrew = locale === "he";
  const [runs, setRuns] = useState<GenRunRow[]>(initialRuns);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await listRecentGenRuns(12);
      setRuns(next);
    } catch {
      // Transient — the next tick retries. Keep the last good list on screen.
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Adaptive polling loop. Re-schedules itself after every fetch at a cadence
  // that depends on whether anything is still running.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const next = await listRecentGenRuns(12).catch(() => null);
      if (cancelled) return;
      if (next) setRuns(next);
      const anyRunning = (next ?? runs).some((r) => r.status === "running");
      timer.current = setTimeout(tick, anyRunning ? FAST_MS : SLOW_MS);
    };
    const anyRunning = runs.some((r) => r.status === "running");
    timer.current = setTimeout(tick, anyRunning ? FAST_MS : SLOW_MS);

    // Refresh the instant a run is scheduled, so "running" shows up right away
    // rather than after the (possibly 15s) idle poll. Re-arms the loop fast.
    const onStarted = () => {
      void refresh();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(tick, FAST_MS);
    };
    window.addEventListener(LIVE_GEN_STARTED_EVENT, onStarted);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener(LIVE_GEN_STARTED_EVENT, onStarted);
    };
    // Intentionally run once on mount; the loop re-reads state via the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drives the collapsed-header live indicator. Polling runs regardless of
  // whether the panel is open, so this stays accurate while collapsed.
  const anyRunning = runs.some((r) => r.status === "running");

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="ai-gen-log-body"
          className="press-down inline-flex flex-1 min-w-0 items-center gap-2 min-h-11 -mx-1 px-1 rounded-lg text-start hover:bg-surface-container"
        >
          <ScrollText className="h-4 w-4 text-primary shrink-0" strokeWidth={1.75} />
          <LabelCaps>{isHebrew ? "יומן ייצור AI" : "AI generation log"}</LabelCaps>
          {anyRunning ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-primary shrink-0">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.25} />
              {isHebrew ? "רץ" : "Running"}
            </span>
          ) : runs.length > 0 ? (
            <span className="text-[11px] font-bold text-on-surface-variant tabular-nums shrink-0">
              {runs.length}
            </span>
          ) : null}
          <ChevronDown
            className={clsx(
              "h-4 w-4 text-outline shrink-0 transition-transform ms-auto",
              open && "rotate-180",
            )}
            strokeWidth={2}
            aria-hidden
          />
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="press-down inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full border border-outline text-xs font-bold text-on-surface-variant hover:bg-surface-container disabled:opacity-60 shrink-0"
        >
          <RefreshCw
            className={clsx("h-3.5 w-3.5 shrink-0", refreshing && "animate-spin")}
            strokeWidth={2}
          />
          {isHebrew ? "רענן" : "Refresh"}
        </button>
      </div>

      {open && (
        <div id="ai-gen-log-body">
          {runs.length === 0 ? (
            <p className="text-xs text-on-surface-variant">
              {isHebrew
                ? "עדיין לא הופעל ייצור. אחרי שתבקש הצעות, ההתקדמות תופיע כאן בזמן אמת."
                : "No runs yet. After you request suggestions, progress shows here in real time."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} isHebrew={isHebrew} locale={locale} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function RunRow({
  run,
  isHebrew,
  locale,
}: {
  run: GenRunRow;
  isHebrew: boolean;
  locale: Locale;
}) {
  const failed = run.status === "failed";
  const running = run.status === "running";
  return (
    <li
      className={clsx(
        "flex flex-col gap-1.5 rounded-xl border p-3",
        failed
          ? "border-error/40 bg-error-container/30"
          : running
            ? "border-primary/40 bg-primary-container/30"
            : "border-outline-variant bg-surface-container",
      )}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <StatusPill status={run.status} isHebrew={isHebrew} />
          <span className="text-xs font-bold rounded-full px-2 py-0.5 bg-surface-container-highest text-on-surface-variant shrink-0">
            {run.scope === "day"
              ? isHebrew ? "יום" : "Day"
              : isHebrew ? "משחק" : "Match"}
          </span>
          <span className="text-sm font-bold truncate">{run.subjectHe}</span>
        </div>
        <time className="text-[11px] text-on-surface-variant tabular-nums shrink-0">
          {relativeTime(run.startedAt, isHebrew, locale)}
        </time>
      </div>

      {running && (
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? "מייצר הצעות… זה יכול לקחת עד כ-2 דקות."
            : "Generating… this can take up to ~2 minutes."}
        </p>
      )}

      {!running && !failed && (
        <p className="text-xs text-on-surface">
          {isHebrew ? (
            <>
              ביקשת <b>{run.requested ?? "?"}</b> · קיבל{" "}
              <b>{run.returned ?? 0}</b> · תקינות <b>{run.valid ?? 0}</b> ·
              נוצרו <b className="text-primary">{run.created ?? 0}</b>
              {run.failed ? <> · {run.failed} נכשלו</> : null}
            </>
          ) : (
            <>
              asked <b>{run.requested ?? "?"}</b> · returned{" "}
              <b>{run.returned ?? 0}</b> · valid <b>{run.valid ?? 0}</b> ·
              created <b className="text-primary">{run.created ?? 0}</b>
              {run.failed ? <> · {run.failed} failed</> : null}
            </>
          )}
        </p>
      )}

      {failed && (
        <p className="inline-flex items-start gap-1 text-xs text-error">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" strokeWidth={2} />
          <span>{translateRunError(run.error, isHebrew)}</span>
        </p>
      )}

      <MetaLine run={run} isHebrew={isHebrew} />
    </li>
  );
}

function StatusPill({ status, isHebrew }: { status: string; isHebrew: boolean }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-primary shrink-0">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.25} />
        {isHebrew ? "רץ" : "Running"}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-error shrink-0">
        <AlertCircle className="h-3.5 w-3.5" strokeWidth={2.25} />
        {isHebrew ? "נכשל" : "Failed"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-primary shrink-0">
      <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.25} />
      {isHebrew ? "הסתיים" : "Done"}
    </span>
  );
}

// Model + web-search + token usage, shown muted for the runs that have it.
function MetaLine({ run, isHebrew }: { run: GenRunRow; isHebrew: boolean }) {
  const parts: string[] = [];
  if (run.model) parts.push(run.model);
  if (run.searchRequests != null && run.searchRequests > 0) {
    parts.push(
      isHebrew ? `${run.searchRequests} חיפושים` : `${run.searchRequests} searches`,
    );
  }
  if (run.inputTokens != null || run.outputTokens != null) {
    const tin = run.inputTokens ?? 0;
    const tout = run.outputTokens ?? 0;
    parts.push(
      isHebrew
        ? `${tin}→${tout} טוקנים`
        : `${tin}→${tout} tokens`,
    );
  }
  if (parts.length === 0) return null;
  return (
    <p className="text-[11px] text-on-surface-variant tabular-nums">
      {parts.join(" · ")}
    </p>
  );
}

// Map the tagged generation error to plain Hebrew/English.
function translateRunError(error: string | null, isHebrew: boolean): string {
  switch (error) {
    case "empty":
      return isHebrew
        ? "המודל לא החזיר אף הצעה תקינה. נסה שוב או הקטן את הכמות."
        : "The model returned no valid suggestions. Try again or lower the count.";
    case "api_error":
      return isHebrew
        ? "שגיאת תקשורת מול המודל. נסה שוב."
        : "API error talking to the model. Try again.";
    case "no_tool_use":
      return isHebrew
        ? "המודל לא הפיק פלט מובנה בזמן שהוקצב."
        : "The model did not produce structured output in time.";
    case "no_key":
      return isHebrew ? "מפתח ה-AI לא מוגדר." : "AI key not configured.";
    case "crashed":
      return isHebrew ? "הריצה קרסה. נסה שוב." : "The run crashed. Try again.";
    default:
      return isHebrew
        ? `הייצור נכשל${error ? ` (${error})` : ""}.`
        : `Generation failed${error ? ` (${error})` : ""}.`;
  }
}

// Compact "x min ago" relative time, falling back to a clock for older runs.
function relativeTime(iso: string, isHebrew: boolean, locale: Locale): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 45) return isHebrew ? "הרגע" : "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) {
    return isHebrew ? `לפני ${diffMin} ד׳` : `${diffMin}m ago`;
  }
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) {
    return isHebrew ? `לפני ${diffHr} ש׳` : `${diffHr}h ago`;
  }
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
