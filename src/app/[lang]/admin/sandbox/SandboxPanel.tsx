"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Database,
  FlaskConical,
  GitMerge,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  pushCodeToProd,
  pushSettingsToProd,
  refreshSandboxFromProd,
  type PushCodeResult,
  type PushSettingsResult,
  type RefreshResult,
} from "./actions";

export type SettingsDiffRow = {
  column: string;
  sandbox: string;
  prod: string;
};

export type GitCompareSummary = {
  aheadBy: number;
  behindBy: number;
  commits: { sha: string; message: string; author: string | null }[];
};

export function SandboxPanel({
  locale,
  settingsDiff,
  gitCompare,
}: {
  locale: Locale;
  settingsDiff: SettingsDiffRow[] | null;
  gitCompare: GitCompareSummary | null;
}) {
  const isHebrew = locale === "he";
  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <PushSettingsCard isHebrew={isHebrew} initialDiff={settingsDiff} />
      <PushCodeCard isHebrew={isHebrew} initialCompare={gitCompare} />
      <RefreshDataCard isHebrew={isHebrew} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Push settings
// ---------------------------------------------------------------------------

function PushSettingsCard({
  isHebrew,
  initialDiff,
}: {
  isHebrew: boolean;
  initialDiff: SettingsDiffRow[] | null;
}) {
  const router = useRouter();
  const [diff, setDiff] = useState<SettingsDiffRow[] | null>(initialDiff);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<PushSettingsResult | null>(null);
  const { pending, run } = usePendingAction();

  const empty = diff !== null && diff.length === 0;
  const loadFailed = diff === null;

  const onConfirm = () => {
    setResult(null);
    void run(async () => {
      const res = await pushSettingsToProd();
      setResult(res);
      if (res.ok) {
        setDiff([]);
        setConfirming(false);
        router.refresh();
      }
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <CardHeader
        icon={<Upload className="h-5 w-5" strokeWidth={2} />}
        title={isHebrew ? "דחיפת הגדרות לפרודקשן" : "Push settings to production"}
        subtitle={
          isHebrew
            ? "מעתיק את שורת ההגדרות מהסאנדבוקס לפרוד. רק עמודות שנשתנו נכתבות."
            : "Copies the settings row from sandbox to prod. Only changed columns are written."
        }
      />

      {loadFailed && (
        <ErrorBox>
          {isHebrew
            ? "נכשלה קריאה של ההגדרות מהפרוד. ודא ש-PROD_DATABASE_URL מוגדר."
            : "Could not read settings from prod. Check PROD_DATABASE_URL."}
        </ErrorBox>
      )}

      {!loadFailed && empty && (
        <InfoBox>
          {isHebrew
            ? "אין הבדלים בין סאנדבוקס לפרוד. כלום לדחוף."
            : "No differences between sandbox and prod. Nothing to push."}
        </InfoBox>
      )}

      {!loadFailed && diff && diff.length > 0 && (
        <DiffTable rows={diff} isHebrew={isHebrew} />
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
        <ResultBanner result={result} isHebrew={isHebrew} kind="settings" />
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={loadFailed || empty || pending}
          className={primaryBtnClass(loadFailed || empty || pending)}
        >
          <Upload className="h-4 w-4" strokeWidth={2.5} />
          {isHebrew ? `דחוף ${diff?.length ?? 0} עמודות` : `Push ${diff?.length ?? 0} columns`}
        </button>
      </div>

      {confirming && diff && diff.length > 0 && (
        <ConfirmModal
          title={isHebrew ? "אישור דחיפת הגדרות" : "Confirm settings push"}
          isHebrew={isHebrew}
          onCancel={() => setConfirming(false)}
          onConfirm={onConfirm}
          pending={pending}
          confirmLabel={isHebrew ? "כן, דחוף לפרוד" : "Yes, push to prod"}
          tone="warning"
        >
          <p className="text-sm text-on-surface">
            {isHebrew
              ? `${diff.length} עמודות ייכתבו אל הפרוד. הפעולה כותבת ישירות ל-DB ולא ניתן לבטל אותה אוטומטית.`
              : `${diff.length} columns will be written to prod. This writes directly to the DB and cannot be auto-undone.`}
          </p>
          <ul className="text-xs text-on-surface-variant max-h-40 overflow-y-auto bg-surface-container-lowest rounded-lg p-3 flex flex-col gap-1">
            {diff.map((d) => (
              <li key={d.column} dir="ltr" className="font-mono">
                · {d.column}
              </li>
            ))}
          </ul>
        </ConfirmModal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Push code
// ---------------------------------------------------------------------------

function PushCodeCard({
  isHebrew,
  initialCompare,
}: {
  isHebrew: boolean;
  initialCompare: GitCompareSummary | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<PushCodeResult | null>(null);
  const { pending, run } = usePendingAction();

  const compare = initialCompare;
  const loadFailed = compare === null;
  const upToDate = compare !== null && compare.aheadBy === 0;

  const onConfirm = () => {
    setResult(null);
    void run(async () => {
      const res = await pushCodeToProd(message);
      setResult(res);
      if (res.ok) {
        setConfirming(false);
        setMessage("");
        router.refresh();
      }
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <CardHeader
        icon={<GitMerge className="h-5 w-5" strokeWidth={2} />}
        title={isHebrew ? "דחיפת קוד לפרודקשן" : "Push code to production"}
        subtitle={
          isHebrew
            ? "ממזג את ענף sandbox לתוך main דרך GitHub API. Vercel ידפלוי אוטומטית - כולל מיגרציות."
            : "Merges the sandbox branch into main via GitHub API. Vercel auto-deploys, including migrations."
        }
      />

      {loadFailed && (
        <ErrorBox>
          {isHebrew
            ? "נכשלה גישה ל-GitHub. ודא GITHUB_DEPLOY_TOKEN / OWNER / REPO."
            : "Couldn't reach GitHub. Check GITHUB_DEPLOY_TOKEN / OWNER / REPO."}
        </ErrorBox>
      )}

      {compare && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>
              {isHebrew
                ? `${compare.aheadBy} קומיטים לדחוף`
                : `${compare.aheadBy} commits ahead`}
            </Pill>
            {compare.behindBy > 0 && (
              <Pill tone="warning">
                {isHebrew
                  ? `main מקדים ב-${compare.behindBy}`
                  : `main is ahead by ${compare.behindBy}`}
              </Pill>
            )}
          </div>
          {compare.commits.length > 0 && (
            <ul className="text-xs text-on-surface-variant max-h-44 overflow-y-auto bg-surface-container-lowest rounded-lg p-3 flex flex-col gap-1">
              {compare.commits.map((c) => (
                <li key={c.sha} className="font-mono truncate" dir="ltr">
                  {c.sha.slice(0, 7)} · {c.message}
                  {c.author && <span className="text-outline"> — {c.author}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
        <ResultBanner result={result} isHebrew={isHebrew} kind="code" />
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={loadFailed || upToDate || pending}
          className={primaryBtnClass(loadFailed || upToDate || pending)}
        >
          <GitMerge className="h-4 w-4" strokeWidth={2.5} />
          {upToDate
            ? isHebrew
              ? "אין מה לדחוף"
              : "Nothing to push"
            : isHebrew
              ? "דחוף לפרוד"
              : "Push to prod"}
        </button>
      </div>

      {confirming && compare && compare.aheadBy > 0 && (
        <ConfirmModal
          title={isHebrew ? "אישור דחיפת קוד" : "Confirm code push"}
          isHebrew={isHebrew}
          onCancel={() => setConfirming(false)}
          onConfirm={onConfirm}
          pending={pending}
          confirmLabel={isHebrew ? "כן, מזג ופרוס" : "Yes, merge & deploy"}
          tone="warning"
        >
          <p className="text-sm text-on-surface">
            {isHebrew
              ? `${compare.aheadBy} קומיטים ימוזגו מ-sandbox ל-main. Vercel תפרוס אוטומטית והמיגרציות ירוצו על הפרוד.`
              : `${compare.aheadBy} commits will be merged from sandbox into main. Vercel will auto-deploy and run migrations against prod.`}
          </p>
          <label className="flex flex-col gap-2">
            <LabelCaps>
              {isHebrew ? "הודעת merge (אופציונלי)" : "Merge commit message (optional)"}
            </LabelCaps>
            <input
              type="text"
              dir="ltr"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                isHebrew
                  ? "ברירת מחדל: chore: promote sandbox to production (תאריך)"
                  : "Default: chore: promote sandbox to production (date)"
              }
              maxLength={200}
              className="h-12 px-4 rounded-lg bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base text-on-surface placeholder:text-outline-variant"
            />
          </label>
        </ConfirmModal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Refresh data
// ---------------------------------------------------------------------------

function RefreshDataCard({ isHebrew }: { isHebrew: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const { pending, run } = usePendingAction();

  const onConfirm = () => {
    setResult(null);
    void run(async () => {
      const res = await refreshSandboxFromProd();
      setResult(res);
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      }
    });
  };

  const refreshableTables = [
    "groups",
    "teams",
    "players",
    "matchdays",
    "matches",
    "settings",
    "sync_runs",
    "bet_lock_defaults",
    "stage_lock_defaults",
    "content_overrides",
  ];
  const excludedTables = [
    "profiles",
    "match_bets",
    "custom_bets",
    "payments",
    "duels",
    "signup_requests",
    "point_adjustments",
    "user_notifications",
  ];

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <CardHeader
        icon={<Database className="h-5 w-5" strokeWidth={2} />}
        title={isHebrew ? "רענון נתוני סאנדבוקס מפרוד" : "Refresh sandbox data from prod"}
        subtitle={
          isHebrew
            ? "מוחק נתוני בדיקה בסאנדבוקס ומעתיק במקומם את הנתונים האמיתיים מהפרוד. רק נתונים תפעוליים - לא משתמשים והימורים."
            : "Wipes sandbox test data and copies real operational data from prod. User/bet tables are excluded."
        }
      />

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-2 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
          <LabelCaps>
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
              {isHebrew ? "ירוענן" : "Refreshed"}
            </span>
          </LabelCaps>
          <ul className="text-xs text-on-surface-variant flex flex-col gap-0.5 font-mono" dir="ltr">
            {refreshableTables.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
          <LabelCaps>
            <span className="inline-flex items-center gap-1">
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              {isHebrew ? "לא נוגע" : "Not touched"}
            </span>
          </LabelCaps>
          <ul className="text-xs text-on-surface-variant flex flex-col gap-0.5 font-mono" dir="ltr">
            {excludedTables.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
        <ResultBanner result={result} isHebrew={isHebrew} kind="refresh" />
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending}
          className={primaryBtnClass(pending)}
        >
          <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
          {isHebrew ? "רענן מפרוד" : "Refresh from prod"}
        </button>
      </div>

      {confirming && (
        <ConfirmModal
          title={isHebrew ? "אישור רענון מהפרוד" : "Confirm refresh from prod"}
          isHebrew={isHebrew}
          onCancel={() => setConfirming(false)}
          onConfirm={onConfirm}
          pending={pending}
          confirmLabel={isHebrew ? "כן, רענן" : "Yes, refresh"}
          tone="warning"
        >
          <p className="text-sm text-on-surface">
            {isHebrew
              ? "כל נתוני הבדיקה בטבלאות שמתחת יימחקו וייבנו מחדש מהפרוד. משתמשים והימורים בסאנדבוקס לא יישנו."
              : "All test data in the tables below will be wiped and reloaded from prod. Sandbox users and bets are untouched."}
          </p>
        </ConfirmModal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function CardHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-primary-fixed text-on-primary-fixed-variant">
        {icon}
      </div>
      <div className="flex flex-col gap-1 min-w-0">
        <SectionHeading as="h2" underline="thin">
          {title}
        </SectionHeading>
        <p className="text-sm text-on-surface-variant">{subtitle}</p>
      </div>
    </div>
  );
}

function DiffTable({
  rows,
  isHebrew,
}: {
  rows: SettingsDiffRow[];
  isHebrew: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <LabelCaps>
        {isHebrew ? `${rows.length} עמודות שונות` : `${rows.length} columns differ`}
      </LabelCaps>
      <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
        {rows.map((r) => (
          <div
            key={r.column}
            className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr] gap-2 p-3 rounded-lg bg-surface-container-lowest border border-outline-variant text-xs"
          >
            <div className="flex flex-col gap-1">
              <LabelCaps>{isHebrew ? "עמודה" : "Column"}</LabelCaps>
              <code className="font-mono text-on-surface break-all" dir="ltr">
                {r.column}
              </code>
            </div>
            <div className="flex flex-col gap-1">
              <LabelCaps>
                <span className="text-tertiary">
                  {isHebrew ? "סאנדבוקס (חדש)" : "Sandbox (new)"}
                </span>
              </LabelCaps>
              <code
                className="font-mono text-on-surface break-all whitespace-pre-wrap"
                dir="ltr"
              >
                {r.sandbox}
              </code>
            </div>
            <div className="flex flex-col gap-1">
              <LabelCaps>
                <span className="text-on-surface-variant">
                  {isHebrew ? "פרוד (יוחלף)" : "Prod (overwritten)"}
                </span>
              </LabelCaps>
              <code
                className="font-mono text-on-surface-variant break-all whitespace-pre-wrap"
                dir="ltr"
              >
                {r.prod}
              </code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  isHebrew,
  onCancel,
  onConfirm,
  pending,
  confirmLabel,
  tone = "warning",
  children,
}: {
  title: string;
  isHebrew: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  confirmLabel: string;
  tone?: "warning" | "default";
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-end md:items-center justify-center bg-scrim/60 p-0 md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <div className="w-full md:max-w-lg max-h-[100dvh] md:max-h-[90dvh] overflow-y-auto bg-surface md:rounded-2xl rounded-t-2xl shadow-xl border border-outline-variant p-5 md:p-6 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div
            className={clsx(
              "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
              tone === "warning"
                ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
                : "bg-primary-fixed text-on-primary-fixed-variant",
            )}
          >
            <AlertTriangle className="h-5 w-5" strokeWidth={2} />
          </div>
          <SectionHeading as="h2" underline="thin">
            {title}
          </SectionHeading>
        </div>
        <div className="flex flex-col gap-3">{children}</div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={secondaryBtnClass(pending)}
          >
            {isHebrew ? "ביטול" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={primaryBtnClass(pending)}
          >
            <FlaskConical className="h-4 w-4" strokeWidth={2.5} />
            {pending ? (isHebrew ? "פועל..." : "Working...") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultBanner({
  result,
  isHebrew,
  kind,
}: {
  result: PushSettingsResult | PushCodeResult | RefreshResult | null;
  isHebrew: boolean;
  kind: "settings" | "code" | "refresh";
}) {
  if (!result) return null;
  if (result.ok) {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-secondary">
        <Check className="h-4 w-4" strokeWidth={2.5} />
        {successText(result, isHebrew, kind)}
      </p>
    );
  }
  return (
    <p className="inline-flex items-center gap-2 text-sm text-error">
      <AlertCircle className="h-4 w-4" strokeWidth={2} />
      {errorText(result.error, isHebrew)}
    </p>
  );
}

function successText(
  result:
    | (PushSettingsResult & { ok: true })
    | (PushCodeResult & { ok: true })
    | (RefreshResult & { ok: true }),
  isHebrew: boolean,
  kind: "settings" | "code" | "refresh",
): string {
  if (kind === "settings") {
    const r = result as PushSettingsResult & { ok: true };
    return isHebrew
      ? r.changedColumns.length === 0
        ? "אין שינויים לדחוף"
        : `נדחפו ${r.changedColumns.length} עמודות`
      : r.changedColumns.length === 0
        ? "No changes to push"
        : `Pushed ${r.changedColumns.length} columns`;
  }
  if (kind === "code") {
    const r = result as PushCodeResult & { ok: true };
    if (!r.merged) {
      return isHebrew ? "main כבר מעודכן" : "main is up to date";
    }
    return isHebrew
      ? `מוזג (${r.mergeSha?.slice(0, 7)}) - Vercel מדפלוי`
      : `Merged (${r.mergeSha?.slice(0, 7)}) - Vercel deploying`;
  }
  const r = result as RefreshResult & { ok: true };
  const totalRows = Object.values(r.perTable).reduce((s, n) => s + n, 0);
  return isHebrew
    ? `הועתקו ${totalRows} שורות ב-${r.durationMs}ms`
    : `Copied ${totalRows} rows in ${r.durationMs}ms`;
}

function errorText(
  code:
    | "unauth"
    | "forbidden"
    | "not-sandbox"
    | "missing"
    | "db"
    | "auth"
    | "conflict"
    | "github",
  isHebrew: boolean,
): string {
  const map: Record<string, [string, string]> = {
    unauth: ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאה", "Not allowed"],
    "not-sandbox": ["לא בסאנדבוקס", "Not in sandbox"],
    missing: ["נתונים חסרים", "Missing data"],
    db: ["שגיאת DB", "Database error"],
    auth: ["טוקן GitHub לא תקין", "GitHub token invalid"],
    conflict: ["יש קונפליקט - פתור ידנית", "Conflict — resolve manually"],
    github: ["שגיאת GitHub", "GitHub error"],
  };
  return map[code]?.[isHebrew ? 0 : 1] ?? code;
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-error-container text-on-error-container text-sm flex items-start gap-2">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" strokeWidth={2} />
      <span>{children}</span>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant text-sm text-on-surface-variant flex items-start gap-2">
      <Check className="h-4 w-4 mt-0.5 shrink-0 text-secondary" strokeWidth={2.5} />
      <span>{children}</span>
    </div>
  );
}

function Pill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold",
        tone === "warning"
          ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
          : "bg-primary-fixed text-on-primary-fixed-variant",
      )}
    >
      {children}
    </span>
  );
}

function primaryBtnClass(disabled: boolean): string {
  return clsx(
    "press-down inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-primary text-on-primary font-[family-name:var(--font-label)] text-[13px] font-bold tracking-[0.05em] hover:bg-surface-tint transition-colors",
    disabled && "opacity-60 cursor-not-allowed",
  );
}

function secondaryBtnClass(disabled: boolean): string {
  return clsx(
    "press-down inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-lg bg-surface text-on-surface border border-outline font-[family-name:var(--font-label)] text-[13px] font-bold tracking-[0.05em] hover:bg-surface-container transition-colors",
    disabled && "opacity-60 cursor-not-allowed",
  );
}
