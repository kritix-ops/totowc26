"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Bot,
  User as UserIcon,
  Terminal,
} from "lucide-react";
import { clsx } from "clsx";
import { Card, LabelCaps, PillButton } from "@/components/ui";
import type { Locale } from "../dictionaries";
import { formatDateTime } from "@/lib/format";
import { runSyncNow, type RunSyncResult } from "./sync-actions";
import type { SyncRunRow } from "@/db/admin-queries";

export function SyncPanel({
  locale,
  history,
}: {
  locale: Locale;
  history: SyncRunRow[];
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RunSyncResult | null>(null);
  const [ranAt, setRanAt] = useState<Date | null>(null);

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      const res = await runSyncNow();
      setResult(res);
      setRanAt(new Date());
      // Refresh the server component so the history list rerenders with the
      // new sync_runs row appended.
      router.refresh();
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <h3 className="font-[family-name:var(--font-display)] text-lg md:text-xl leading-snug font-bold text-on-surface">
            {isHebrew ? "סנכרון מהאתר הרשמי" : "Sync from football-data"}
          </h3>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "מושך משחקים, תוצאות וניקוד אוטומטי. רץ אוטומטית פעם ביום ב-6:00 UTC, או הפעל כאן ידנית."
              : "Pulls fixtures, results and auto-scores bets. Runs once daily at 06:00 UTC, or fire it manually."}
          </p>
        </div>
        <PillButton
          type="button"
          onClick={onClick}
          disabled={pending}
          className="px-5 py-2.5 inline-flex items-center gap-2 shrink-0"
        >
          <RefreshCw
            className={clsx("h-4 w-4", pending && "animate-spin")}
            strokeWidth={2}
          />
          {pending
            ? isHebrew ? "מסנכרן..." : "Syncing..."
            : isHebrew ? "סנכרן עכשיו" : "Sync now"}
        </PillButton>
      </div>

      {result && !result.ok && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-error-container text-on-error-container text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" strokeWidth={2} />
          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-bold">
              {result.error === "forbidden"
                ? isHebrew ? "אין הרשאה" : "Not allowed"
                : isHebrew ? "סנכרון נכשל" : "Sync failed"}
            </span>
            {result.error === "sync_failed" && result.message && (
              <span className="text-xs opacity-90 break-words">{result.message}</span>
            )}
          </div>
        </div>
      )}

      {result && result.ok && (
        <div className="flex flex-col gap-3 p-4 rounded-lg bg-secondary-container text-on-secondary-container">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            <span className="font-bold text-sm">
              {isHebrew
                ? `הסתיים תוך ${(result.durationMs / 1000).toFixed(1)} שניות`
                : `Done in ${(result.durationMs / 1000).toFixed(1)}s`}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label={isHebrew ? "נמשכו" : "Fetched"} value={result.report.fetched} />
            <Stat label={isHebrew ? "חדשים" : "New"} value={result.report.inserted} />
            <Stat label={isHebrew ? "עודכנו" : "Updated"} value={result.report.updated} />
            <Stat label={isHebrew ? "נוקדו" : "Scored"} value={result.report.scoredBets} />
            <Stat
              label={isHebrew ? "משחקים שנוקדו" : "Matches scored"}
              value={result.report.scoredMatches}
            />
            <Stat
              label={isHebrew ? "הימורי על" : "Specials"}
              value={result.report.scoredSpecials}
            />
            <Stat
              label={isHebrew ? "דולגו" : "Skipped"}
              value={result.report.skipped}
            />
            {result.report.unknownTeams.length > 0 && (
              <Stat
                label={isHebrew ? "קבוצות לא ידועות" : "Unknown teams"}
                value={result.report.unknownTeams.length}
                tone="warning"
              />
            )}
          </div>
          {result.report.unknownTeams.length > 0 && (
            <p className="text-xs opacity-90">
              {isHebrew ? "לא זוהו: " : "Unmatched: "}
              {result.report.unknownTeams.slice(0, 8).join(", ")}
              {result.report.unknownTeams.length > 8 && "…"}
            </p>
          )}
        </div>
      )}

      {ranAt && !pending && (
        <LabelCaps>
          {isHebrew ? "הופעל ב" : "Ran at"}{" "}
          <bdi>
            {formatDateTime(ranAt, locale, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </bdi>
        </LabelCaps>
      )}

      <SyncHistory rows={history} isHebrew={isHebrew} />
    </Card>
  );
}

function SyncHistory({
  rows,
  isHebrew,
}: {
  rows: SyncRunRow[];
  isHebrew: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (rows.length === 0) {
    return (
      <div className="border-t border-outline-variant pt-4">
        <LabelCaps as="div" className="mb-2">
          {isHebrew ? "היסטוריית סנכרון" : "Sync history"}
        </LabelCaps>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "עוד לא רץ סנכרון. הפעל את הראשון עם הכפתור למעלה."
            : "No syncs yet. Trigger the first one with the button above."}
        </p>
      </div>
    );
  }
  return (
    <div className="border-t border-outline-variant pt-4 flex flex-col gap-2">
      <LabelCaps as="div">{isHebrew ? "היסטוריית סנכרון" : "Sync history"}</LabelCaps>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => {
          const open = expandedId === r.id;
          return (
            <li key={r.id} className="rounded-lg border border-outline-variant overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : r.id)}
                className="w-full flex items-center gap-3 px-3 py-3 min-h-[52px] text-start hover:bg-surface-container transition-colors"
              >
                <StatusDot ok={r.ok} pending={!r.finishedAt} />
                <SourceIcon source={r.source} />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-bold text-on-surface bidi-ltr">
                    {fmtTime(r.startedAt, isHebrew)}
                  </span>
                  <span className="text-xs text-on-surface-variant truncate">
                    {summaryLine(r, isHebrew)}
                  </span>
                </div>
                <span className="text-xs font-[family-name:var(--font-label)] text-on-surface-variant whitespace-nowrap bidi-ltr">
                  {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "…"}
                </span>
                {open ? (
                  <ChevronUp className="h-4 w-4 text-on-surface-variant" strokeWidth={2} />
                ) : (
                  <ChevronDown className="h-4 w-4 text-on-surface-variant" strokeWidth={2} />
                )}
              </button>
              {open && <RunDetail run={r} isHebrew={isHebrew} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusDot({ ok, pending }: { ok: boolean; pending: boolean }) {
  return (
    <span
      className={clsx(
        "w-2.5 h-2.5 rounded-full shrink-0",
        pending
          ? "bg-tertiary animate-pulse"
          : ok
            ? "bg-secondary"
            : "bg-error",
      )}
      aria-hidden
    />
  );
}

function SourceIcon({ source }: { source: SyncRunRow["source"] }) {
  const Icon = source === "cron" ? Bot : source === "admin" ? UserIcon : Terminal;
  return <Icon className="h-4 w-4 text-on-surface-variant shrink-0" strokeWidth={1.75} />;
}

function summaryLine(r: SyncRunRow, isHebrew: boolean): string {
  if (!r.finishedAt) return isHebrew ? "רץ עכשיו..." : "Running...";
  if (!r.ok) {
    return r.errorMessage
      ? `${isHebrew ? "נכשל: " : "Failed: "}${r.errorMessage.slice(0, 80)}`
      : isHebrew ? "נכשל" : "Failed";
  }
  const parts = [
    `${r.fetched ?? 0} ${isHebrew ? "נמשכו" : "fetched"}`,
    `${r.inserted ?? 0} ${isHebrew ? "חדשים" : "new"}`,
    `${r.scoredBets ?? 0} ${isHebrew ? "ניקודים" : "scored"}`,
  ];
  if ((r.scoredSpecials ?? 0) > 0) {
    parts.push(`${r.scoredSpecials} ${isHebrew ? "על" : "specials"}`);
  }
  if ((r.unknownTeams?.length ?? 0) > 0) {
    parts.push(
      `${r.unknownTeams!.length} ${isHebrew ? "קבוצות לא ידועות" : "unknown teams"}`,
    );
  }
  return parts.join(" · ");
}

function fmtTime(iso: string, isHebrew: boolean): string {
  return formatDateTime(iso, isHebrew ? "he" : "en", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RunDetail({ run, isHebrew }: { run: SyncRunRow; isHebrew: boolean }) {
  return (
    <div className="border-t border-outline-variant bg-surface-container-lowest px-3 py-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <Field label={isHebrew ? "מקור" : "Source"} value={sourceLabel(run.source, isHebrew)} />
        <Field
          label={isHebrew ? "הופעל ע״י" : "By"}
          value={
            run.triggeredByName ??
            (run.source === "cron" ? (isHebrew ? "אוטומטי" : "automatic") : "—")
          }
        />
        <Field
          label={isHebrew ? "משך" : "Duration"}
          value={
            run.durationMs != null
              ? `${(run.durationMs / 1000).toFixed(2)}s`
              : "…"
          }
        />
        <Field
          label={isHebrew ? "סטטוס" : "Status"}
          value={
            !run.finishedAt
              ? isHebrew ? "רץ" : "running"
              : run.ok
                ? isHebrew ? "הצליח" : "ok"
                : isHebrew ? "נכשל" : "failed"
          }
          tone={!run.finishedAt ? "warning" : run.ok ? "good" : "bad"}
        />
      </div>

      {run.ok && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <Field label={isHebrew ? "נמשכו" : "Fetched"} value={String(run.fetched ?? 0)} />
          <Field label={isHebrew ? "חדשים" : "New"} value={String(run.inserted ?? 0)} />
          <Field label={isHebrew ? "עודכנו" : "Updated"} value={String(run.updated ?? 0)} />
          <Field label={isHebrew ? "דולגו" : "Skipped"} value={String(run.skipped ?? 0)} />
          <Field
            label={isHebrew ? "הימורי משחק" : "Match bets"}
            value={String(run.scoredBets ?? 0)}
          />
          <Field
            label={isHebrew ? "משחקים" : "Matches"}
            value={String(run.scoredMatches ?? 0)}
          />
          <Field
            label={isHebrew ? "הימורי על" : "Specials"}
            value={String(run.scoredSpecials ?? 0)}
          />
          <Field
            label={isHebrew ? "ק׳ לא ידועות" : "Unknown teams"}
            value={String(run.unknownTeams?.length ?? 0)}
            tone={run.unknownTeams && run.unknownTeams.length > 0 ? "warning" : undefined}
          />
        </div>
      )}

      {run.unknownTeams && run.unknownTeams.length > 0 && (
        <div className="flex flex-col gap-1">
          <LabelCaps>{isHebrew ? "לא זוהו" : "Unmatched team names"}</LabelCaps>
          <p className="text-sm text-on-surface break-words">
            {run.unknownTeams.join(", ")}
          </p>
        </div>
      )}

      {!run.ok && run.errorMessage && (
        <div className="flex flex-col gap-1 p-3 rounded-lg bg-error-container text-on-error-container">
          <LabelCaps>{isHebrew ? "שגיאה" : "Error"}</LabelCaps>
          <p className="text-sm break-words font-mono">{run.errorMessage}</p>
          {run.errorStack && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs opacity-80">
                {isHebrew ? "stack trace" : "stack trace"}
              </summary>
              <pre className="mt-2 text-[11px] leading-snug overflow-x-auto whitespace-pre-wrap break-words opacity-90">
                {run.errorStack}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warning";
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <LabelCaps>{label}</LabelCaps>
      <span
        className={clsx(
          "text-sm font-bold truncate",
          tone === "good" && "text-secondary",
          tone === "bad" && "text-error",
          tone === "warning" && "text-tertiary",
          !tone && "text-on-surface",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function sourceLabel(source: SyncRunRow["source"], isHebrew: boolean): string {
  if (isHebrew) {
    return source === "cron" ? "אוטומטי" : source === "admin" ? "ידני" : "טרמינל";
  }
  return source;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warning";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <LabelCaps>{label}</LabelCaps>
      <span
        className={clsx(
          "font-[family-name:var(--font-display)] text-2xl leading-none font-bold bidi-ltr",
          tone === "warning" ? "text-error" : "text-on-secondary-container",
        )}
      >
        {value}
      </span>
    </div>
  );
}
