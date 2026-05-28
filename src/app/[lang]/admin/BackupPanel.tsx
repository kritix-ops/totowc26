"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Database,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Bot,
  User as UserIcon,
  Terminal,
  ExternalLink,
} from "lucide-react";
import { clsx } from "clsx";
import { Card, LabelCaps, PillButton } from "@/components/ui";
import type { Locale } from "../dictionaries";
import { formatDateTime } from "@/lib/format";
import { runBackupNow, type RunBackupResult } from "./backup-actions";
import type { BackupRunRow } from "@/db/admin-queries";

export function BackupPanel({
  locale,
  history,
}: {
  locale: Locale;
  history: BackupRunRow[];
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RunBackupResult | null>(null);
  const [ranAt, setRanAt] = useState<Date | null>(null);

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      const res = await runBackupNow();
      setResult(res);
      setRanAt(new Date());
      // Refresh the server component so the history list rerenders
      // with the new sync_runs row appended.
      router.refresh();
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <h3 className="font-[family-name:var(--font-display)] text-lg md:text-xl leading-snug font-bold text-on-surface">
            {isHebrew ? "גיבוי נתונים ל-GitHub" : "Data backup to GitHub"}
          </h3>
          <p className="text-sm text-on-surface-variant">
            {isHebrew
              ? "מייצא את כל הטבלאות ל-CSV ודוחף ל-repo פרטי. רץ אוטומטית כל יום ב-03:00, או הפעל ידנית כאן."
              : "Exports every table to CSV and commits to a private GitHub repo. Runs daily at 03:00 IL, or fire it manually."}
          </p>
        </div>
        <PillButton
          type="button"
          onClick={onClick}
          disabled={pending}
          className="px-5 py-2.5 inline-flex items-center gap-2 shrink-0"
        >
          <Database
            className={clsx("h-4 w-4", pending && "animate-pulse")}
            strokeWidth={2}
          />
          {pending
            ? isHebrew ? "מגבה..." : "Backing up..."
            : isHebrew ? "גבה עכשיו" : "Back up now"}
        </PillButton>
      </div>

      {result && !result.ok && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-error-container text-on-error-container text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" strokeWidth={2} />
          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-bold">
              {result.error === "forbidden"
                ? isHebrew ? "אין הרשאה" : "Not allowed"
                : isHebrew ? "גיבוי נכשל" : "Backup failed"}
            </span>
            {result.error === "backup_failed" && result.message && (
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
            <Stat
              label={isHebrew ? "קבצים" : "Files"}
              value={result.report.files.length.toString()}
            />
            <Stat
              label={isHebrew ? "שורות סה״כ" : "Total rows"}
              value={result.report.totalRows.toLocaleString(
                locale === "he" ? "he-IL" : "en-US",
              )}
            />
            <Stat
              label={isHebrew ? "גודל" : "Size"}
              value={humaniseBytes(result.report.totalBytes)}
            />
            <Stat
              label={isHebrew ? "commit" : "Commit"}
              value={result.report.commitSha.slice(0, 7)}
              href={result.report.commitUrl}
            />
          </div>
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

      <BackupHistory rows={history} isHebrew={isHebrew} locale={locale} />
    </Card>
  );
}

function humaniseBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function BackupHistory({
  rows,
  isHebrew,
  locale,
}: {
  rows: BackupRunRow[];
  isHebrew: boolean;
  locale: Locale;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (rows.length === 0) {
    return (
      <div className="border-t border-outline-variant pt-4">
        <LabelCaps as="div" className="mb-2">
          {isHebrew ? "היסטוריית גיבויים" : "Backup history"}
        </LabelCaps>
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "עוד לא רץ גיבוי. הפעל את הראשון עם הכפתור למעלה."
            : "No backups yet. Trigger the first one with the button above."}
        </p>
      </div>
    );
  }
  return (
    <div className="border-t border-outline-variant pt-4 flex flex-col gap-2">
      <LabelCaps as="div">
        {isHebrew ? "היסטוריית גיבויים" : "Backup history"}
      </LabelCaps>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => {
          const open = expandedId === r.id;
          return (
            <li
              key={r.id}
              className="rounded-lg border border-outline-variant overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : r.id)}
                className="w-full flex items-center gap-3 px-3 py-3 min-h-[52px] text-start hover:bg-surface-container transition-colors"
              >
                <StatusDot ok={r.ok} pending={!r.finishedAt} />
                <SourceIcon source={r.source} />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-bold text-on-surface">
                    {fmtTime(r.startedAt, locale)}
                  </span>
                  <span className="text-xs text-on-surface-variant truncate">
                    {summaryLine(r, isHebrew)}
                  </span>
                </div>
                <span className="text-xs font-[family-name:var(--font-label)] text-on-surface-variant whitespace-nowrap bidi-ltr">
                  {r.durationMs != null
                    ? `${(r.durationMs / 1000).toFixed(1)}s`
                    : "…"}
                </span>
                {open ? (
                  <ChevronUp
                    className="h-4 w-4 text-on-surface-variant"
                    strokeWidth={2}
                  />
                ) : (
                  <ChevronDown
                    className="h-4 w-4 text-on-surface-variant"
                    strokeWidth={2}
                  />
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

function SourceIcon({ source }: { source: string }) {
  // 'cron-backup' = automatic nightly fire, 'admin-backup' = manual
  // operator press. Falls back to the terminal glyph for anything else
  // (defensive — sync_runs.source is a free-text column).
  const Icon = source === "cron-backup"
    ? Bot
    : source === "admin-backup"
      ? UserIcon
      : Terminal;
  return (
    <Icon
      className="h-4 w-4 text-on-surface-variant shrink-0"
      strokeWidth={1.75}
    />
  );
}

function summaryLine(r: BackupRunRow, isHebrew: boolean): string {
  if (!r.finishedAt) return isHebrew ? "רץ עכשיו..." : "Running...";
  if (!r.ok) {
    return r.errorMessage
      ? `${isHebrew ? "נכשל: " : "Failed: "}${r.errorMessage.slice(0, 80)}`
      : isHebrew ? "נכשל" : "Failed";
  }
  const parts = [
    `${r.fileCount ?? 0} ${isHebrew ? "קבצים" : "files"}`,
    `${(r.rowCount ?? 0).toLocaleString(isHebrew ? "he-IL" : "en-US")} ${
      isHebrew ? "שורות" : "rows"
    }`,
  ];
  return parts.join(" · ");
}

function fmtTime(iso: string, locale: Locale): string {
  return formatDateTime(iso, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RunDetail({ run, isHebrew }: { run: BackupRunRow; isHebrew: boolean }) {
  return (
    <div className="border-t border-outline-variant bg-surface-container-lowest px-3 py-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <Field
          label={isHebrew ? "מקור" : "Source"}
          value={sourceLabel(run.source, isHebrew)}
        />
        <Field
          label={isHebrew ? "הופעל ע״י" : "By"}
          value={
            run.triggeredByName ??
            (run.source === "cron-backup"
              ? isHebrew ? "אוטומטי" : "automatic"
              : "-")
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
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Field
            label={isHebrew ? "קבצים" : "Files"}
            value={String(run.fileCount ?? 0)}
          />
          <Field
            label={isHebrew ? "שורות סה״כ" : "Total rows"}
            value={(run.rowCount ?? 0).toLocaleString(
              isHebrew ? "he-IL" : "en-US",
            )}
          />
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

function sourceLabel(source: string, isHebrew: boolean): string {
  if (source === "cron-backup") return isHebrew ? "אוטומטי" : "automatic";
  if (source === "admin-backup") return isHebrew ? "ידני" : "manual";
  return source;
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const inner = (
    <span
      className={clsx(
        "font-[family-name:var(--font-display)] text-xl md:text-2xl leading-none font-bold bidi-ltr inline-flex items-center gap-1.5 text-on-secondary-container",
        href && "underline-offset-4 hover:underline",
      )}
    >
      {value}
      {href && (
        <ExternalLink
          className="h-4 w-4 opacity-70"
          strokeWidth={2}
          aria-hidden
        />
      )}
    </span>
  );
  return (
    <div className="flex flex-col gap-0.5">
      <LabelCaps>{label}</LabelCaps>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start"
        >
          {inner}
        </a>
      ) : (
        inner
      )}
    </div>
  );
}
