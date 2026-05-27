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
  CircleAlert,
} from "lucide-react";
import { clsx } from "clsx";
import { Card, LabelCaps, PillButton } from "@/components/ui";
import type { Locale } from "../dictionaries";
import { formatDateTime } from "@/lib/format";
import {
  runSyncNow,
  refreshApiFootballQuota,
  setTeamApiFootballId,
  type RunSyncResult,
} from "./sync-actions";
import type { SyncRunRow, TeamMappingStatus } from "@/db/admin-queries";
import type { ApiFootballQuota } from "@/lib/api-football";

export function SyncPanel({
  locale,
  history,
  teamMapping,
  apiFootballQuota,
}: {
  locale: Locale;
  history: SyncRunRow[];
  teamMapping: TeamMappingStatus;
  apiFootballQuota: ApiFootballQuota | null;
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
              label={isHebrew ? "הימורים מותאמים שנוקדו" : "Custom bets graded"}
              value={result.report.scoredAutoCustomBets}
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

      <TeamMappingBanner status={teamMapping} isHebrew={isHebrew} />

      <QuotaCard quota={apiFootballQuota} isHebrew={isHebrew} locale={locale} />

      <SyncHistory rows={history} isHebrew={isHebrew} />
    </Card>
  );
}

function QuotaCard({
  quota,
  isHebrew,
  locale,
}: {
  quota: ApiFootballQuota | null;
  isHebrew: boolean;
  locale: Locale;
}) {
  const [pending, startTransition] = useTransition();
  const [latest, setLatest] = useState<ApiFootballQuota | null>(quota);

  // Stay in sync if the server-rendered prop changes after a sync run.
  // useEffect would be overkill — comparing identity each render is
  // cheap, and we only swap the local state when the parent value
  // actually moves.
  if (quota !== latest && !pending) {
    setLatest(quota);
  }

  const onRefresh = () => {
    startTransition(async () => {
      const res = await refreshApiFootballQuota();
      if (res.ok) setLatest(res.quota);
    });
  };

  // Empty state — key not set, upstream unreachable, or first render
  // before activation. Tell the operator what's missing without
  // pretending we have data.
  if (!latest) {
    return (
      <div className="flex items-start gap-3 p-3 md:p-4 rounded-lg border border-outline-variant bg-surface-container-lowest">
        <RefreshCw className="h-5 w-5 mt-0.5 shrink-0 text-on-surface-variant" strokeWidth={2} />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="font-bold text-sm text-on-surface">
            {isHebrew ? "מכסת API-Football לא זמינה" : "API-Football quota unavailable"}
          </span>
          <span className="text-xs text-on-surface-variant">
            {isHebrew
              ? "API_FOOTBALL_KEY לא מוגדר או שה-/status לא הגיב. הסנכרון עובד דרך football-data fallback."
              : "API_FOOTBALL_KEY is unset or /status didn't respond. Sync falls back to football-data."}
          </span>
        </div>
        <PillButton
          type="button"
          onClick={onRefresh}
          disabled={pending}
          className="px-3 py-1.5 inline-flex items-center gap-1.5 shrink-0 text-xs"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", pending && "animate-spin")} strokeWidth={2} />
          {pending
            ? isHebrew ? "..." : "..."
            : isHebrew ? "רענן" : "Refresh"}
        </PillButton>
      </div>
    );
  }

  const pct = latest.limitDay > 0 ? Math.min(100, (latest.used / latest.limitDay) * 100) : 0;
  const tone: "ok" | "warn" | "bad" =
    pct >= 95 ? "bad" : pct >= 80 ? "warn" : "ok";
  const barColor =
    tone === "bad"
      ? "bg-error"
      : tone === "warn"
        ? "bg-tertiary"
        : "bg-secondary";
  const trackColor =
    tone === "bad"
      ? "bg-error-container"
      : tone === "warn"
        ? "bg-tertiary-container"
        : "bg-secondary-container";

  return (
    <div className="flex flex-col gap-3 p-3 md:p-4 rounded-lg border border-outline-variant bg-surface-container-lowest">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="font-bold text-sm text-on-surface">
            {isHebrew ? "מכסת API-Football" : "API-Football quota"}
          </span>
          <span className="text-xs text-on-surface-variant">
            {isHebrew ? "תכנית" : "Plan"}: <bdi>{latest.plan}</bdi>
            {!latest.subscriptionActive && (
              <span className="text-error font-bold">
                {" "}· {isHebrew ? "לא פעיל" : "inactive"}
              </span>
            )}
          </span>
        </div>
        <PillButton
          type="button"
          onClick={onRefresh}
          disabled={pending}
          className="px-3 py-1.5 inline-flex items-center gap-1.5 shrink-0 text-xs"
          aria-label={isHebrew ? "רענן מכסה" : "Refresh quota"}
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", pending && "animate-spin")} strokeWidth={2} />
          {pending
            ? isHebrew ? "מרענן..." : "Refreshing..."
            : isHebrew ? "רענן" : "Refresh"}
        </PillButton>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <QuotaStat
          label={isHebrew ? "בשימוש היום" : "Used today"}
          value={latest.used.toLocaleString(locale === "he" ? "he-IL" : "en-US")}
          tone={tone === "bad" ? "bad" : tone === "warn" ? "warn" : undefined}
        />
        <QuotaStat
          label={isHebrew ? "נותרו" : "Remaining"}
          value={latest.remaining.toLocaleString(locale === "he" ? "he-IL" : "en-US")}
        />
        <QuotaStat
          label={isHebrew ? "תקרה יומית" : "Daily limit"}
          value={latest.limitDay.toLocaleString(locale === "he" ? "he-IL" : "en-US")}
        />
      </div>

      <div
        className={clsx("h-2 w-full rounded-full overflow-hidden bidi-ltr", trackColor)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={latest.limitDay}
        aria-valuenow={latest.used}
        aria-label={isHebrew ? "ניצול מכסה" : "Quota usage"}
      >
        <div
          className={clsx("h-full transition-[width] duration-300", barColor)}
          style={{ width: `${pct.toFixed(1)}%` }}
        />
      </div>
    </div>
  );
}

function QuotaStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <LabelCaps>{label}</LabelCaps>
      <span
        className={clsx(
          "font-[family-name:var(--font-display)] text-lg leading-none font-bold bidi-ltr",
          tone === "bad" && "text-error",
          tone === "warn" && "text-tertiary",
          !tone && "text-on-surface",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function TeamMappingBanner({
  status,
  isHebrew,
}: {
  status: TeamMappingStatus;
  isHebrew: boolean;
}) {
  if (status.totalTeams === 0) return null;

  const ok = status.unmapped === 0;
  const Icon = ok ? Check : CircleAlert;

  const titleHe = ok
    ? "כל הקבוצות ממופות ל-API-Football"
    : `${status.unmapped} מתוך ${status.totalTeams} קבוצות עדיין ללא מיפוי`;
  const titleEn = ok
    ? "All teams mapped to API-Football"
    : `${status.unmapped} of ${status.totalTeams} teams not yet mapped`;

  const bodyHe = ok
    ? "סנכרון הפיקסצ׳רים יכול לפעול דרך API-Football בלי לדלג על שורות בגלל אי-התאמת שמות."
    : "עד שכל הקבוצות ממופות, הסנכרון החדש (PR 2) ידלג עליהן. הרץ מקומית `node --env-file=.env.local scripts/api-football-map-teams.mjs` כדי להשלים את המיפוי.";
  const bodyEn = ok
    ? "Fixture sync can resolve every team via API-Football without name-matching skips."
    : "Until every team is mapped, the new sync (PR 2) will skip them. Run `node --env-file=.env.local scripts/api-football-map-teams.mjs` locally to finish the mapping.";

  return (
    <div
      className={clsx(
        "flex items-start gap-3 p-3 md:p-4 rounded-lg border",
        ok
          ? "bg-secondary-container text-on-secondary-container border-transparent"
          : "bg-error-container text-on-error-container border-transparent",
      )}
    >
      <Icon className="h-5 w-5 mt-0.5 shrink-0" strokeWidth={2} />
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="font-bold text-sm">
          {isHebrew ? titleHe : titleEn}
        </span>
        <span className="text-xs opacity-90">
          {isHebrew ? bodyHe : bodyEn}
        </span>
        {!ok && status.unmappedSample.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            <span className="text-xs font-bold opacity-90">
              {isHebrew ? "לא ממופות:" : "Unmapped:"}
            </span>
            <ul className="flex flex-wrap gap-1.5">
              {status.unmappedSample.map((code) => (
                <li key={code} className="min-w-0">
                  <UnmappedTeamChip code={code} isHebrew={isHebrew} />
                </li>
              ))}
              {status.unmapped > status.unmappedSample.length && (
                <li className="self-center text-xs opacity-90">
                  +{status.unmapped - status.unmappedSample.length}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function UnmappedTeamChip({
  code,
  isHebrew,
}: {
  code: string;
  isHebrew: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<
    "bad_input" | "team_not_found" | "id_already_in_use" | "forbidden" | null
  >(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setOpen(false);
    setValue("");
    setErrorKey(null);
    setDone(false);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorKey(null);
    const parsed = Number(value.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setErrorKey("bad_input");
      return;
    }
    startTransition(async () => {
      const res = await setTeamApiFootballId(code, parsed);
      if (res.ok) {
        setDone(true);
        // Don't auto-close — let the operator see the success state
        // for one render. The page revalidate already dropped the
        // chip from the unmapped list, so the next render removes
        // it naturally.
      } else {
        setErrorKey(res.error);
      }
    });
  };

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary text-on-secondary text-xs font-bold">
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        <bdi>{code}</bdi>
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-2.5 min-h-[32px] rounded-full bg-error text-on-error text-xs font-bold border border-transparent hover:bg-error/90 transition-colors press-down"
        aria-label={isHebrew ? `מפה ידנית את ${code}` : `Map ${code} manually`}
      >
        <bdi>{code}</bdi>
        <span aria-hidden className="opacity-70">↗</span>
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-1 rounded-lg bg-surface-container-lowest border border-outline-variant p-2 min-w-[180px]"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-error-container text-on-error-container text-xs font-bold shrink-0">
          <bdi>{code}</bdi>
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={isHebrew ? "ID מ-API-Football" : "API-Football team ID"}
          autoFocus
          disabled={pending}
          className="flex-1 min-w-0 px-2 py-1.5 rounded-md text-sm bg-surface text-on-surface border border-outline-variant focus:border-primary focus:outline-none disabled:opacity-50"
          aria-label={isHebrew ? `מזהה API-Football עבור ${code}` : `API-Football id for ${code}`}
        />
      </div>
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="text-xs text-on-surface-variant hover:text-on-surface px-2 py-1 min-h-[32px] press-down"
        >
          {isHebrew ? "ביטול" : "Cancel"}
        </button>
        <button
          type="submit"
          disabled={pending || value.trim() === ""}
          className="inline-flex items-center gap-1 text-xs font-bold bg-primary text-on-primary rounded-full px-3 py-1 min-h-[32px] disabled:opacity-50 press-down"
        >
          {pending ? (isHebrew ? "..." : "...") : isHebrew ? "שמור" : "Save"}
        </button>
      </div>
      {errorKey && (
        <span className="text-[11px] text-error">
          {errorMessage(errorKey, isHebrew)}
        </span>
      )}
    </form>
  );
}

function errorMessage(
  key: "bad_input" | "team_not_found" | "id_already_in_use" | "forbidden",
  isHebrew: boolean,
): string {
  if (isHebrew) {
    switch (key) {
      case "bad_input":         return "מזהה לא תקין — צריך מספר חיובי שלם.";
      case "team_not_found":    return "הקבוצה לא נמצאה.";
      case "id_already_in_use": return "המזהה הזה כבר משויך לקבוצה אחרת.";
      case "forbidden":         return "אין הרשאה.";
    }
  }
  switch (key) {
    case "bad_input":         return "Invalid id — must be a positive integer.";
    case "team_not_found":    return "Team not found.";
    case "id_already_in_use": return "That id is already mapped to a different team.";
    case "forbidden":         return "Not allowed.";
  }
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
                  <span className="text-sm font-bold text-on-surface">
                    {fmtTime(r.startedAt, isHebrew)}
                  </span>
                  <span className="text-xs text-on-surface-variant truncate">
                    {summaryLine(r, isHebrew)}
                  </span>
                </div>
                <ProviderBadge provider={r.provider} className="hidden sm:inline-flex" />
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

function ProviderBadge({
  provider,
  className,
}: {
  provider: SyncRunRow["provider"];
  className?: string;
}) {
  if (!provider) return null;
  const apiFootball = provider === "api-football";
  return (
    <span
      className={clsx(
        "shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-[0.04em] uppercase font-[family-name:var(--font-label)] whitespace-nowrap bidi-ltr",
        apiFootball
          ? "bg-primary-container text-on-primary-container"
          : "bg-tertiary-container text-on-tertiary-container",
        className,
      )}
      aria-label={apiFootball ? "Synced via API-Football" : "Synced via football-data"}
    >
      {apiFootball ? "API-Football" : "football-data"}
    </span>
  );
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
            (run.source === "cron" ? (isHebrew ? "אוטומטי" : "automatic") : "-")
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
        <Field
          label={isHebrew ? "ספק" : "Provider"}
          value={
            run.provider === "api-football"
              ? "API-Football"
              : run.provider === "football-data"
                ? "football-data"
                : "—"
          }
          tone={run.provider === "football-data" ? "warning" : undefined}
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
