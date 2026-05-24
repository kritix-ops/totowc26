"use client";

import { useState, useTransition } from "react";
import { RefreshCw, AlertCircle, Check } from "lucide-react";
import { clsx } from "clsx";
import { Card, LabelCaps, PillButton } from "@/components/ui";
import type { Locale } from "../dictionaries";
import { runSyncNow, type RunSyncResult } from "./sync-actions";

export function SyncPanel({ locale }: { locale: Locale }) {
  const isHebrew = locale === "he";
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RunSyncResult | null>(null);
  const [ranAt, setRanAt] = useState<Date | null>(null);

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      const res = await runSyncNow();
      setResult(res);
      setRanAt(new Date());
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
            {new Intl.DateTimeFormat(isHebrew ? "he-IL" : "en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }).format(ranAt)}
          </bdi>
        </LabelCaps>
      )}
    </Card>
  );
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
