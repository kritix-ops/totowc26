"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "@/app/[lang]/dictionaries";
import { Card, LabelCaps, SectionHeading } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import { formatDateTime } from "@/lib/format";
import {
  pullCodeFromProd,
  pushCodeToProd,
  pushSettingsToProd,
  refreshSandboxFromProd,
  type CodeSyncResult,
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
  pushCommits: { sha: string; message: string; author: string | null }[];
  pullCommits: { sha: string; message: string; author: string | null }[];
};

type AnyResult = PushSettingsResult | CodeSyncResult | RefreshResult;

type ActionKey =
  | "push-settings"
  | "push-code"
  | "pull-code"
  | "refresh-data";

const LS_PREFIX = "toto.sandbox.lastRun.v1.";

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
      <PushSettingsCard locale={locale} isHebrew={isHebrew} initialDiff={settingsDiff} />
      <CodeSyncCard locale={locale} isHebrew={isHebrew} initialCompare={gitCompare} />
      <RefreshDataCard locale={locale} isHebrew={isHebrew} />
    </div>
  );
}

// ===========================================================================
// Push settings
// ===========================================================================

function PushSettingsCard({
  locale,
  isHebrew,
  initialDiff,
}: {
  locale: Locale;
  isHebrew: boolean;
  initialDiff: SettingsDiffRow[] | null;
}) {
  const router = useRouter();
  const [diff, setDiff] = useState<SettingsDiffRow[] | null>(initialDiff);
  const [confirming, setConfirming] = useState(false);
  const { pending, run } = usePendingAction();
  const { last, runWithLog, clear } = useLastRun<PushSettingsResult>("push-settings");

  const empty = diff !== null && diff.length === 0;
  const loadFailed = diff === null;

  const onConfirm = () => {
    void run(async () => {
      await runWithLog(async () => {
        const res = await pushSettingsToProd();
        if (res.ok) {
          setDiff([]);
          setConfirming(false);
          router.refresh();
        }
        return res;
      });
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

      <ActionRow>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={loadFailed || empty || pending}
          className={primaryBtnClass(loadFailed || empty || pending)}
        >
          <Upload className="h-4 w-4" strokeWidth={2.5} />
          {isHebrew ? `דחוף ${diff?.length ?? 0} עמודות` : `Push ${diff?.length ?? 0} columns`}
        </button>
      </ActionRow>

      <LastRunSection
        actionKey="push-settings"
        locale={locale}
        isHebrew={isHebrew}
        pending={pending}
        last={last}
        onClear={clear}
        renderSuccess={(res) => <PushSettingsSuccessBody result={res} isHebrew={isHebrew} />}
        runningLabel={
          isHebrew
            ? "כותב עמודות שונות לפרודקשן..."
            : "Writing changed columns to production..."
        }
      />

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

function PushSettingsSuccessBody({
  result,
  isHebrew,
}: {
  result: PushSettingsResult & { ok: true };
  isHebrew: boolean;
}) {
  if (result.changedColumns.length === 0) {
    return (
      <p className="text-sm text-on-surface-variant">
        {isHebrew ? "אין שינויים — לא נכתב כלום ל-DB." : "No diff — nothing was written to the DB."}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-on-surface">
        {isHebrew
          ? `${result.changedColumns.length} עמודות נכתבו לטבלת settings בפרוד:`
          : `${result.changedColumns.length} columns written to the prod settings table:`}
      </p>
      <ul className="text-xs text-on-surface-variant max-h-44 overflow-y-auto bg-surface-container-lowest rounded-lg p-3 flex flex-col gap-1.5" dir="ltr">
        {result.diff.map((d) => (
          <li key={d.column} className="font-mono flex flex-wrap items-baseline gap-2">
            <span className="text-on-surface font-bold">{d.column}</span>
            <span className="text-error">{stringifyVal(d.prodValue)}</span>
            <span className="text-outline">→</span>
            <span className="text-secondary">{stringifyVal(d.sandboxValue)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// Code sync (push + pull in one card)
// ===========================================================================

function CodeSyncCard({
  locale,
  isHebrew,
  initialCompare,
}: {
  locale: Locale;
  isHebrew: boolean;
  initialCompare: GitCompareSummary | null;
}) {
  const router = useRouter();
  const compare = initialCompare;
  const loadFailed = compare === null;

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-5">
      <CardHeader
        icon={<GitBranch className="h-5 w-5" strokeWidth={2} />}
        title={isHebrew ? "סנכרון קוד" : "Code sync"}
        subtitle={
          isHebrew
            ? "שני כיוונים: דחיפה (sandbox ← master) או משיכה (master → sandbox). שניהם דרך GitHub merge API. Vercel תפרוס אוטומטית, migrations ירוצו."
            : "Two directions: push (sandbox → master) or pull (master → sandbox). Both via GitHub merge API. Vercel auto-deploys, migrations run."
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
        <CodeSyncSummary compare={compare} isHebrew={isHebrew} />
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <CodeDirectionPanel
          locale={locale}
          isHebrew={isHebrew}
          direction="push"
          compare={compare}
          onAfter={() => router.refresh()}
        />
        <CodeDirectionPanel
          locale={locale}
          isHebrew={isHebrew}
          direction="pull"
          compare={compare}
          onAfter={() => router.refresh()}
        />
      </div>
    </Card>
  );
}

function CodeSyncSummary({
  compare,
  isHebrew,
}: {
  compare: GitCompareSummary;
  isHebrew: boolean;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <SyncStatusBox
        icon={<Upload className="h-4 w-4" strokeWidth={2} />}
        label={isHebrew ? "ל-master לדחוף" : "To push to master"}
        count={compare.aheadBy}
        tone={compare.aheadBy > 0 ? "warning" : "default"}
        empty={isHebrew ? "מעודכן" : "Up to date"}
        commits={compare.pushCommits}
      />
      <SyncStatusBox
        icon={<ArrowDownToLine className="h-4 w-4" strokeWidth={2} />}
        label={isHebrew ? "מ-master למשוך" : "To pull from master"}
        count={compare.behindBy}
        tone={compare.behindBy > 0 ? "warning" : "default"}
        empty={isHebrew ? "מעודכן" : "Up to date"}
        commits={compare.pullCommits}
      />
    </div>
  );
}

function SyncStatusBox({
  icon,
  label,
  count,
  tone,
  empty,
  commits,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  tone: "default" | "warning";
  empty: string;
  commits: { sha: string; message: string; author: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg bg-surface-container-low border border-outline-variant p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            "inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0",
            tone === "warning"
              ? "bg-tertiary-fixed text-on-tertiary-fixed-variant"
              : "bg-surface text-on-surface-variant border border-outline-variant",
          )}
        >
          {icon}
        </span>
        <LabelCaps className="flex-1">{label}</LabelCaps>
        <span
          className={clsx(
            "font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums",
            count > 0 ? "text-primary" : "text-on-surface-variant",
          )}
        >
          <bdi>{count}</bdi>
        </span>
      </div>
      {count === 0 && (
        <p className="text-xs text-on-surface-variant inline-flex items-center gap-1">
          <Check className="h-3 w-3 text-secondary" strokeWidth={2.5} />
          {empty}
        </p>
      )}
      {count > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="self-start text-xs text-primary hover:underline inline-flex items-center gap-1 min-h-[28px]"
          >
            {open ? (
              <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
            ) : (
              <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
            )}
            {open ? "סגור" : `הצג ${count} קומיטים`}
          </button>
          {open && (
            <ul className="text-xs text-on-surface-variant max-h-36 overflow-y-auto bg-surface-container-lowest rounded p-2 flex flex-col gap-1" dir="ltr">
              {commits.length === 0 ? (
                <li className="text-outline">(commits not returned)</li>
              ) : (
                commits.map((c) => (
                  <li key={c.sha} className="font-mono truncate">
                    {c.sha.slice(0, 7)} · {c.message}
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function CodeDirectionPanel({
  locale,
  isHebrew,
  direction,
  compare,
  onAfter,
}: {
  locale: Locale;
  isHebrew: boolean;
  direction: "push" | "pull";
  compare: GitCompareSummary | null;
  onAfter: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const { pending, run } = usePendingAction();
  const actionKey: ActionKey = direction === "push" ? "push-code" : "pull-code";
  const { last, runWithLog, clear } = useLastRun<CodeSyncResult>(actionKey);

  const count = direction === "push" ? compare?.aheadBy ?? 0 : compare?.behindBy ?? 0;
  const upToDate = compare !== null && count === 0;
  const loadFailed = compare === null;

  const titleHe = direction === "push" ? "דחוף sandbox → master" : "משוך master → sandbox";
  const titleEn = direction === "push" ? "Push sandbox → master" : "Pull master → sandbox";
  const btnHe = direction === "push" ? "דחוף לפרוד" : "משוך מהפרוד";
  const btnEn = direction === "push" ? "Push to prod" : "Pull from prod";
  const confirmTitleHe = direction === "push" ? "אישור דחיפת קוד" : "אישור משיכת קוד";
  const confirmTitleEn = direction === "push" ? "Confirm code push" : "Confirm code pull";
  const confirmBtnHe = direction === "push" ? "כן, מזג ופרוס" : "כן, מזג לסאנדבוקס";
  const confirmBtnEn = direction === "push" ? "Yes, merge & deploy" : "Yes, merge into sandbox";
  const runningHe = direction === "push" ? "ממזג לתוך master..." : "ממזג master לתוך sandbox...";
  const runningEn = direction === "push" ? "Merging into master..." : "Merging master into sandbox...";

  const onConfirm = () => {
    void run(async () => {
      await runWithLog(async () => {
        const action = direction === "push" ? pushCodeToProd : pullCodeFromProd;
        const res = await action(message);
        if (res.ok) {
          setConfirming(false);
          setMessage("");
          onAfter();
        }
        return res;
      });
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-outline-variant p-4 bg-surface">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-primary-fixed text-on-primary-fixed-variant">
          {direction === "push" ? (
            <Upload className="h-4 w-4" strokeWidth={2} />
          ) : (
            <ArrowDownToLine className="h-4 w-4" strokeWidth={2} />
          )}
        </div>
        <SectionHeading as="h3" underline="thin">
          {isHebrew ? titleHe : titleEn}
        </SectionHeading>
      </div>

      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={loadFailed || upToDate || pending}
        className={primaryBtnClass(loadFailed || upToDate || pending)}
      >
        {direction === "push" ? (
          <Upload className="h-4 w-4" strokeWidth={2.5} />
        ) : (
          <ArrowDownToLine className="h-4 w-4" strokeWidth={2.5} />
        )}
        {upToDate
          ? isHebrew
            ? "אין מה לעדכן"
            : "Nothing to sync"
          : isHebrew
            ? `${btnHe} (${count})`
            : `${btnEn} (${count})`}
      </button>

      <LastRunSection
        actionKey={actionKey}
        locale={locale}
        isHebrew={isHebrew}
        pending={pending}
        last={last}
        onClear={clear}
        renderSuccess={(res) => <CodeSyncSuccessBody result={res} isHebrew={isHebrew} />}
        runningLabel={isHebrew ? runningHe : runningEn}
      />

      {confirming && (
        <ConfirmModal
          title={isHebrew ? confirmTitleHe : confirmTitleEn}
          isHebrew={isHebrew}
          onCancel={() => setConfirming(false)}
          onConfirm={onConfirm}
          pending={pending}
          confirmLabel={isHebrew ? confirmBtnHe : confirmBtnEn}
          tone="warning"
        >
          <p className="text-sm text-on-surface">
            {isHebrew
              ? direction === "push"
                ? `${count} קומיטים ימוזגו מ-sandbox ל-master. Vercel תפרוס לפרודקשן והמיגרציות ירוצו על ה-DB של הפרוד.`
                : `${count} קומיטים ימוזגו מ-master ל-sandbox. Vercel תפרוס לסאנדבוקס והמיגרציות ירוצו על ה-DB של הסאנדבוקס.`
              : direction === "push"
                ? `${count} commits will be merged from sandbox into master. Vercel will deploy to prod and run migrations against the prod DB.`
                : `${count} commits will be merged from master into sandbox. Vercel will deploy to sandbox and run migrations against the sandbox DB.`}
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
                direction === "push"
                  ? "chore: promote sandbox to production (date)"
                  : "chore: sync master into sandbox (date)"
              }
              maxLength={200}
              className="h-12 px-4 rounded-lg bg-surface-container-lowest border border-outline focus:border-primary focus:outline-none text-base text-on-surface placeholder:text-outline-variant"
            />
          </label>
        </ConfirmModal>
      )}
    </div>
  );
}

function CodeSyncSuccessBody({
  result,
  isHebrew,
}: {
  result: CodeSyncResult & { ok: true };
  isHebrew: boolean;
}) {
  if (!result.merged) {
    return (
      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? `${result.base} כבר מעודכן ביחס ל-${result.head} — לא נוצר merge.`
          : `${result.base} is up to date with ${result.head} — no merge needed.`}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-on-surface">
          {isHebrew ? "merge הצליח." : "Merge succeeded."}
        </span>
        <span className="text-on-surface-variant">
          {isHebrew
            ? `${result.aheadBy} קומיטים מ-${result.head} ל-${result.base}`
            : `${result.aheadBy} commits from ${result.head} into ${result.base}`}
        </span>
      </div>
      {result.mergeSha && result.mergeUrl && (
        <a
          href={result.mergeUrl}
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline self-start font-mono"
        >
          {result.mergeSha.slice(0, 12)}
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
        </a>
      )}
      <p className="text-xs text-on-surface-variant">
        {isHebrew
          ? result.direction === "push"
            ? "Vercel-prod מדפלוי עכשיו. ה-migrations ירוצו אוטומטית במהלך ה-build (prebuild)."
            : "Vercel-sandbox מדפלוי עכשיו. ה-migrations ירוצו על DB הסאנדבוקס."
          : result.direction === "push"
            ? "Vercel-prod is deploying now. Migrations run automatically during the build (prebuild)."
            : "Vercel-sandbox is deploying now. Migrations will run against the sandbox DB."}
      </p>
      {result.commits.length > 0 && (
        <details className="text-xs">
          <summary className="text-on-surface-variant cursor-pointer min-h-[28px] inline-flex items-center">
            {isHebrew ? `${result.commits.length} קומיטים מוזגו` : `${result.commits.length} commits merged`}
          </summary>
          <ul className="mt-2 max-h-44 overflow-y-auto bg-surface-container-lowest rounded p-2 flex flex-col gap-1 font-mono" dir="ltr">
            {result.commits.map((c) => (
              <li key={c.sha} className="truncate">
                {c.sha.slice(0, 7)} · {c.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ===========================================================================
// Refresh data
// ===========================================================================

function RefreshDataCard({
  locale,
  isHebrew,
}: {
  locale: Locale;
  isHebrew: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const { pending, run } = usePendingAction();
  const { last, runWithLog, clear } = useLastRun<RefreshResult>("refresh-data");

  const onConfirm = () => {
    void run(async () => {
      await runWithLog(async () => {
        const res = await refreshSandboxFromProd();
        if (res.ok) {
          setConfirming(false);
          router.refresh();
        }
        return res;
      });
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
  // Genuinely untouched: no foreign key into the truncated tables, so
  // the TRUNCATE ... CASCADE does not reach them.
  const preservedTables = [
    "profiles",
    "payments",
    "signup_requests",
    "point_adjustments",
    "user_notifications",
  ];
  // Emptied as a side effect: these FK into the refreshed tables, so the
  // TRUNCATE CASCADE wipes them and nothing reloads them. The operator
  // must know their sandbox bets/test data are reset, not preserved.
  const wipedTables = [
    "match_bets",
    "custom_bets",
    "user_custom_bet_picks",
    "duels",
    "live_odds_snapshot",
    "bet_grading_audit",
    "bet_reminder_sent",
  ];

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <CardHeader
        icon={<Database className="h-5 w-5" strokeWidth={2} />}
        title={isHebrew ? "רענון נתוני סאנדבוקס מפרוד" : "Refresh sandbox data from prod"}
        subtitle={
          isHebrew
            ? "מעתיק את הנתונים התפעוליים מהפרוד אל הסאנדבוקס. שים לב: בדרך גם הימורי ונתוני הבדיקה בסאנדבוקס מתאפסים. חשבונות, תשלומים ובקשות הרשמה נשמרים."
            : "Copies operational data from prod into the sandbox. Note: sandbox bets and test data are reset in the process. Accounts, payments and signup requests are preserved."
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
              {isHebrew ? "נשמר" : "Preserved"}
            </span>
          </LabelCaps>
          <ul className="text-xs text-on-surface-variant flex flex-col gap-0.5 font-mono" dir="ltr">
            {preservedTables.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-3 rounded-lg bg-error-container/50 border border-error/30">
        <LabelCaps>
          <span className="inline-flex items-center gap-1 text-error">
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
            {isHebrew ? "יימחק (איפוס נתוני בדיקה)" : "Wiped (test data reset)"}
          </span>
        </LabelCaps>
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? "הטבלאות האלה מצביעות על הנתונים התפעוליים, אז ה-TRUNCATE מוחק אותן ושום דבר לא טוען אותן מחדש. כל הימורי הבדיקה בסאנדבוקס יילכו לאיבוד."
            : "These tables point at the operational data, so the TRUNCATE empties them and nothing reloads them. All sandbox test bets are lost."}
        </p>
        <ul className="text-xs text-on-surface-variant flex flex-col gap-0.5 font-mono" dir="ltr">
          {wipedTables.map((t) => (
            <li key={t}>· {t}</li>
          ))}
        </ul>
      </div>

      <ActionRow>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending}
          className={primaryBtnClass(pending)}
        >
          <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
          {isHebrew ? "רענן מפרוד" : "Refresh from prod"}
        </button>
      </ActionRow>

      <LastRunSection
        actionKey="refresh-data"
        locale={locale}
        isHebrew={isHebrew}
        pending={pending}
        last={last}
        onClear={clear}
        renderSuccess={(res) => <RefreshSuccessBody result={res} isHebrew={isHebrew} />}
        runningLabel={
          isHebrew
            ? "שואב טבלאות מפרוד, מאפס סאנדבוקס וכותב מחדש..."
            : "Fetching tables from prod, truncating sandbox, reloading..."
        }
      />

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
              ? "הנתונים התפעוליים ייבנו מחדש מהפרוד. שים לב: כל הימורי ונתוני הבדיקה בסאנדבוקס (match_bets, custom_bets, duels ועוד) יימחקו בתהליך. חשבונות (profiles), תשלומים ובקשות הרשמה נשמרים."
              : "Operational data will be rebuilt from prod. Note: all sandbox bets and test data (match_bets, custom_bets, duels and more) are deleted in the process. Accounts (profiles), payments and signup requests are preserved."}
          </p>
        </ConfirmModal>
      )}
    </Card>
  );
}

function RefreshSuccessBody({
  result,
  isHebrew,
}: {
  result: RefreshResult & { ok: true };
  isHebrew: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-on-surface">
        {isHebrew
          ? `הועתקו ${result.totalRows.toLocaleString()} שורות מהפרוד לסאנדבוקס.`
          : `Copied ${result.totalRows.toLocaleString()} rows from prod to sandbox.`}
        <span className="text-on-surface-variant"> </span>
        <span className="text-on-surface-variant text-xs">
          {isHebrew
            ? `(TRUNCATE: ${result.truncateMs}ms · סה״כ: ${result.durationMs}ms)`
            : `(TRUNCATE: ${result.truncateMs}ms · total: ${result.durationMs}ms)`}
        </span>
      </p>
      <table className="text-xs w-full bg-surface-container-lowest rounded-lg overflow-hidden">
        <thead>
          <tr className="text-on-surface-variant">
            <th className="text-start p-2 font-bold">{isHebrew ? "טבלה" : "Table"}</th>
            <th className="text-end p-2 font-bold tabular-nums">{isHebrew ? "שורות" : "Rows"}</th>
            <th className="text-end p-2 font-bold tabular-nums">{isHebrew ? "Fetch" : "Fetch"}</th>
            <th className="text-end p-2 font-bold tabular-nums">{isHebrew ? "Insert" : "Insert"}</th>
          </tr>
        </thead>
        <tbody>
          {result.steps.map((s) => (
            <tr
              key={s.table}
              className="border-t border-outline-variant"
            >
              <td className="p-2 font-mono text-on-surface" dir="ltr">
                {s.table}
              </td>
              <td className="p-2 text-end tabular-nums text-on-surface">
                <bdi>{s.rowsCopied.toLocaleString()}</bdi>
              </td>
              <td className="p-2 text-end tabular-nums text-on-surface-variant">
                <bdi>{s.fetchMs}</bdi>ms
              </td>
              <td className="p-2 text-end tabular-nums text-on-surface-variant">
                <bdi>{s.insertMs}</bdi>ms
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// Last-run feedback infrastructure
// ===========================================================================

// Module-level pub/sub so multiple components reading the same action key
// re-render when localStorage is written from any one of them (the native
// `storage` event only fires for OTHER tabs). Subscribers per key.
const lastRunSubscribers = new Map<ActionKey, Set<() => void>>();

function notifyLastRunChanged(key: ActionKey) {
  const subs = lastRunSubscribers.get(key);
  if (!subs) return;
  for (const fn of subs) fn();
}

function readLastRunRaw(key: ActionKey): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LS_PREFIX + key);
  } catch {
    return null;
  }
}

function writeLastRunRaw(key: ActionKey, raw: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (raw === null) localStorage.removeItem(LS_PREFIX + key);
    else localStorage.setItem(LS_PREFIX + key, raw);
  } catch {
    // localStorage disabled / quota — best-effort persistence.
  }
}

// Persists the last action result to localStorage so a page refresh
// (or returning to the page later) still shows "this is what happened".
// One slot per action key. Survives across navigation but not log-out.
// Uses useSyncExternalStore so React 19's strict effect-purity rules
// don't flag a "setState in effect" hydration shim.
function useLastRun<T extends AnyResult>(key: ActionKey) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      let set = lastRunSubscribers.get(key);
      if (!set) {
        set = new Set();
        lastRunSubscribers.set(key, set);
      }
      set.add(onChange);
      return () => {
        set!.delete(onChange);
      };
    },
    [key],
  );
  const getSnapshot = useCallback(() => readLastRunRaw(key), [key]);
  const getServerSnapshot = useCallback(() => null, []);
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const last = useMemo<T | null>(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }, [raw]);

  const clear = useCallback(() => {
    writeLastRunRaw(key, null);
    notifyLastRunChanged(key);
  }, [key]);

  const runWithLog = useCallback(
    async (fn: () => Promise<T>) => {
      const res = await fn();
      writeLastRunRaw(key, JSON.stringify(res));
      notifyLastRunChanged(key);
      console.info(`[admin sandbox ${key}] client result`, res);
      return res;
    },
    [key],
  );

  return { last, runWithLog, clear };
}

function LastRunSection<T extends AnyResult>({
  actionKey,
  locale,
  isHebrew,
  pending,
  last,
  onClear,
  renderSuccess,
  runningLabel,
}: {
  actionKey: ActionKey;
  locale: Locale;
  isHebrew: boolean;
  pending: boolean;
  last: T | null;
  onClear: () => void;
  renderSuccess: (result: T & { ok: true }) => React.ReactNode;
  runningLabel: string;
}) {
  if (pending) {
    return <RunningBanner label={runningLabel} actionKey={actionKey} />;
  }
  if (!last) return null;
  return (
    <LastRunCard
      locale={locale}
      isHebrew={isHebrew}
      last={last}
      onClear={onClear}
      renderSuccess={renderSuccess}
    />
  );
}

function RunningBanner({
  label,
  actionKey,
}: {
  label: string;
  actionKey: ActionKey;
}) {
  // Date.now() and setState live inside the effect (setInterval callback
  // is an external-event source, not the render body) to satisfy
  // react-hooks/purity and react-hooks/set-state-in-effect.
  const startRef = useRef<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    startRef.current = Date.now();
    const id = setInterval(() => {
      if (startRef.current === null) return;
      setElapsedSec((Date.now() - startRef.current) / 1000);
    }, 100);
    return () => {
      clearInterval(id);
      startRef.current = null;
    };
  }, [actionKey]);
  return (
    <div className="rounded-lg bg-primary-fixed text-on-primary-fixed-variant p-4 flex items-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin shrink-0" strokeWidth={2} />
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="text-sm font-bold truncate">{label}</p>
        <p className="text-xs opacity-80 tabular-nums">
          <bdi>{elapsedSec.toFixed(1)}s</bdi>
        </p>
      </div>
    </div>
  );
}

function LastRunCard<T extends AnyResult>({
  locale,
  isHebrew,
  last,
  onClear,
  renderSuccess,
}: {
  locale: Locale;
  isHebrew: boolean;
  last: T;
  onClear: () => void;
  renderSuccess: (result: T & { ok: true }) => React.ReactNode;
}) {
  const finished = new Date(last.finishedAt);
  const successTone = last.ok;
  return (
    <div
      className={clsx(
        "rounded-lg p-4 flex flex-col gap-3 border",
        successTone
          ? "bg-surface-container-low border-secondary/30"
          : "bg-error-container/40 border-error/30",
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={clsx(
            "w-8 h-8 rounded-full inline-flex items-center justify-center shrink-0",
            successTone
              ? "bg-secondary/15 text-secondary"
              : "bg-error/15 text-error",
          )}
        >
          {successTone ? (
            <Check className="h-4 w-4" strokeWidth={2.5} />
          ) : (
            <AlertCircle className="h-4 w-4" strokeWidth={2} />
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <p className={clsx("text-sm font-bold", successTone ? "text-secondary" : "text-error")}>
            {successTone
              ? isHebrew
                ? "הפעולה הצליחה"
                : "Action succeeded"
              : isHebrew
                ? "הפעולה נכשלה"
                : "Action failed"}
          </p>
          <p className="text-xs text-on-surface-variant inline-flex items-center gap-1.5 flex-wrap">
            <Clock className="h-3 w-3" strokeWidth={2} />
            <span>
              {formatDateTime(finished, locale, {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <span className="text-outline">·</span>
            <span dir="ltr" className="tabular-nums">
              {last.durationMs}ms
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label={isHebrew ? "נקה לוג" : "Clear log"}
          className="inline-flex items-center justify-center w-9 h-9 rounded-full text-on-surface-variant hover:bg-surface-container shrink-0"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      {last.ok ? renderSuccess(last as T & { ok: true }) : <FailureBody result={last} isHebrew={isHebrew} />}
    </div>
  );
}

function FailureBody({
  result,
  isHebrew,
}: {
  result: AnyResult & { ok: false };
  isHebrew: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-on-surface">
        <span className="font-bold">{errorText(result.error, isHebrew)}</span>
      </p>
      {"detail" in result && result.detail && (
        <details className="text-xs">
          <summary className="text-on-surface-variant cursor-pointer min-h-[28px] inline-flex items-center">
            {isHebrew ? "פרטים טכניים" : "Technical detail"}
          </summary>
          <pre
            dir="ltr"
            className="mt-1 p-3 bg-surface-container-lowest rounded text-xs overflow-x-auto whitespace-pre-wrap"
          >
            {result.detail}
          </pre>
        </details>
      )}
      <p className="text-xs text-on-surface-variant">
        {isHebrew
          ? "לוגים מלאים בשרת: חפש בקונסול של Vercel את הניימספייס '[admin sandbox ...]'."
          : "Full server logs: search Vercel console for the '[admin sandbox ...]' namespace."}
      </p>
    </div>
  );
}

// ===========================================================================
// Shared primitives
// ===========================================================================

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

function ActionRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
      {children}
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
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                {isHebrew ? "פועל..." : "Working..."}
              </>
            ) : (
              <>
                <FlaskConical className="h-4 w-4" strokeWidth={2.5} />
                {confirmLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small UI primitives
// ---------------------------------------------------------------------------

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

function stringifyVal(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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
