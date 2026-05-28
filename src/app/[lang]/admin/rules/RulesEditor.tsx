"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  Coins,
  Eye,
  Home,
  ListChecks,
  Medal,
  Radio,
  RotateCcw,
  Save,
  Swords,
  Trophy,
  User as UserIcon,
  Wallet,
} from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../dictionaries";
import { Card, LabelCaps } from "@/components/ui";
import { saveOverride } from "../content/actions";

export type RulesEntry = {
  key: string;
  labelHe: string;
  labelEn: string;
  defaultHe: string;
  defaultEn: string;
  overrideHe: string | null;
  overrideEn: string | null;
};

export type PageGuideEntry = {
  dictKey: string;
  pathLabel: string;
  nameKey: string;
  descKey: string;
  defaultNameHe: string;
  defaultNameEn: string;
  defaultDescHe: string;
  defaultDescEn: string;
  overrideNameHe: string | null;
  overrideNameEn: string | null;
  overrideDescHe: string | null;
  overrideDescEn: string | null;
};

type BodyGroup = {
  he: string;
  en: string;
  rows: RulesEntry[];
};

// Same path → icon map the public rules page uses. Kept here too so the
// admin sees the exact icon next to each row and can spot the right one
// at a glance. New entries must be added in both places.
const PAGE_GUIDE_ICONS: Record<string, React.ReactNode> = {
  home: <Home className="h-4 w-4" strokeWidth={1.75} />,
  bets: <ListChecks className="h-4 w-4" strokeWidth={1.75} />,
  live: <Radio className="h-4 w-4" strokeWidth={1.75} />,
  duels: <Swords className="h-4 w-4" strokeWidth={1.75} />,
  leaderboard: <Medal className="h-4 w-4" strokeWidth={1.75} />,
  transparency: <Eye className="h-4 w-4" strokeWidth={1.75} />,
  meBank: <Wallet className="h-4 w-4" strokeWidth={1.75} />,
  tournament: <Trophy className="h-4 w-4" strokeWidth={1.75} />,
  pay: <Coins className="h-4 w-4" strokeWidth={1.75} />,
  profile: <UserIcon className="h-4 w-4" strokeWidth={1.75} />,
  notifications: <Bell className="h-4 w-4" strokeWidth={1.75} />,
  rules: <BookOpen className="h-4 w-4" strokeWidth={1.75} />,
};

type FieldStatus = "idle" | "saving" | "saved" | "error";

export function RulesEditor({
  locale,
  bodyGroups,
  pageGuide,
}: {
  locale: Locale;
  bodyGroups: BodyGroup[];
  pageGuide: PageGuideEntry[];
}) {
  const isHebrew = locale === "he";

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionHead
          number={1}
          title={isHebrew ? "תוכן עמוד החוקים" : "Rules page content"}
          subtitle={
            isHebrew
              ? "כל סעיף בעמוד החוקים, מקובץ כמו שהוא מוצג למשתמש."
              : "Every block on the rules page, grouped the way the public page renders it."
          }
        />
        <div className="flex flex-col gap-4">
          {bodyGroups.map((g) => (
            <BodyGroupCard
              key={g.he}
              group={g}
              isHebrew={isHebrew}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead
          number={2}
          title={isHebrew ? "הסבר על הדפים" : "Page guide"}
          subtitle={
            isHebrew
              ? "12 הכרטיסים שמוצגים בתחתית עמוד החוקים. כל כרטיס מכיל שם דף + הסבר קצר."
              : "The 12 cards at the bottom of the rules page — page name + short blurb each."
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pageGuide.map((p) => (
            <PageGuideCard key={p.dictKey} entry={p} isHebrew={isHebrew} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionHead({
  number,
  title,
  subtitle,
}: {
  number: number;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold shrink-0">
        <bdi>{number}</bdi>
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <h2 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-on-surface">
          {title}
        </h2>
        <p className="text-sm text-on-surface-variant">{subtitle}</p>
      </div>
    </div>
  );
}

function BodyGroupCard({
  group,
  isHebrew,
}: {
  group: BodyGroup;
  isHebrew: boolean;
}) {
  return (
    <Card className="p-4 md:p-5 flex flex-col gap-4">
      <LabelCaps as="div">{isHebrew ? group.he : group.en}</LabelCaps>
      <div className="flex flex-col gap-5">
        {group.rows.map((row) => (
          <FieldRow key={row.key} row={row} isHebrew={isHebrew} />
        ))}
      </div>
    </Card>
  );
}

function FieldRow({ row, isHebrew }: { row: RulesEntry; isHebrew: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-sm text-on-surface">
          {isHebrew ? row.labelHe : row.labelEn}
        </span>
        <code className="text-[11px] text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded font-mono">
          {row.key}
        </code>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LocaleField
          locale="he"
          dirHint="rtl"
          fieldKey={row.key}
          defaultValue={row.defaultHe}
          initialOverride={row.overrideHe}
          isHebrew={isHebrew}
        />
        <LocaleField
          locale="en"
          dirHint="ltr"
          fieldKey={row.key}
          defaultValue={row.defaultEn}
          initialOverride={row.overrideEn}
          isHebrew={isHebrew}
        />
      </div>
    </div>
  );
}

function PageGuideCard({
  entry,
  isHebrew,
}: {
  entry: PageGuideEntry;
  isHebrew: boolean;
}) {
  const icon = PAGE_GUIDE_ICONS[entry.dictKey] ?? null;
  return (
    <Card className="p-4 md:p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant flex items-center justify-center shrink-0">
          {icon}
        </span>
        <div className="flex flex-col min-w-0">
          <LabelCaps>{entry.pathLabel}</LabelCaps>
          <span className="text-xs text-on-surface-variant truncate">
            {isHebrew
              ? "שם והסבר בשפתיים"
              : "Name & blurb in both languages"}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <LabelCaps>{isHebrew ? "שם הדף" : "Page name"}</LabelCaps>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <LocaleField
              locale="he"
              dirHint="rtl"
              fieldKey={entry.nameKey}
              defaultValue={entry.defaultNameHe}
              initialOverride={entry.overrideNameHe}
              isHebrew={isHebrew}
              singleLine
            />
            <LocaleField
              locale="en"
              dirHint="ltr"
              fieldKey={entry.nameKey}
              defaultValue={entry.defaultNameEn}
              initialOverride={entry.overrideNameEn}
              isHebrew={isHebrew}
              singleLine
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <LabelCaps>{isHebrew ? "הסבר קצר" : "Short blurb"}</LabelCaps>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <LocaleField
              locale="he"
              dirHint="rtl"
              fieldKey={entry.descKey}
              defaultValue={entry.defaultDescHe}
              initialOverride={entry.overrideDescHe}
              isHebrew={isHebrew}
            />
            <LocaleField
              locale="en"
              dirHint="ltr"
              fieldKey={entry.descKey}
              defaultValue={entry.defaultDescEn}
              initialOverride={entry.overrideDescEn}
              isHebrew={isHebrew}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

// Single locale textarea + save/reset bar. Keeps its own draft, override,
// and status state so a slow save on one row doesn't freeze the others.
function LocaleField({
  locale,
  dirHint,
  fieldKey,
  defaultValue,
  initialOverride,
  isHebrew,
  singleLine = false,
}: {
  locale: "he" | "en";
  dirHint: "rtl" | "ltr";
  fieldKey: string;
  defaultValue: string;
  initialOverride: string | null;
  isHebrew: boolean;
  singleLine?: boolean;
}) {
  const router = useRouter();
  const [override, setOverride] = useState<string | null>(initialOverride);
  const [draft, setDraft] = useState<string>(initialOverride ?? defaultValue);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isDirty = draft !== (override ?? defaultValue);
  const isOverridden = override !== null;

  const localeLabel = locale === "he"
    ? isHebrew ? "עברית" : "Hebrew"
    : isHebrew ? "אנגלית" : "English";

  const onSave = () => {
    setError(null);
    setStatus("saving");
    startTransition(async () => {
      console.info("[admin rules save] start", { key: fieldKey, locale, len: draft.length });
      const res = await saveOverride({
        key: fieldKey,
        locale,
        defaultValue,
        newValue: draft,
      });
      if (!res.ok) {
        setStatus("error");
        setError(translateError(res, isHebrew));
        console.warn("[admin rules save] failed", { key: fieldKey, locale, error: res.error });
        return;
      }
      setOverride(draft);
      setStatus("saved");
      console.info("[admin rules save] done", { key: fieldKey, locale });
      router.refresh();
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1800);
    });
  };

  const onReset = () => {
    setError(null);
    setStatus("saving");
    startTransition(async () => {
      console.info("[admin rules reset] start", { key: fieldKey, locale });
      const res = await saveOverride({
        key: fieldKey,
        locale,
        defaultValue,
        newValue: null,
      });
      if (!res.ok) {
        setStatus("error");
        setError(translateError(res, isHebrew));
        console.warn("[admin rules reset] failed", { key: fieldKey, locale, error: res.error });
        return;
      }
      setOverride(null);
      setDraft(defaultValue);
      setStatus("saved");
      console.info("[admin rules reset] done", { key: fieldKey, locale });
      router.refresh();
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1800);
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <LabelCaps>{localeLabel}</LabelCaps>
        {isOverridden && (
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-tertiary">
            {isHebrew ? "מותאם אישית" : "Overridden"}
          </span>
        )}
      </div>
      {singleLine ? (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          dir={dirHint}
          className={clsx(
            "h-12 px-3 rounded-md border bg-surface-container-lowest text-[16px] text-on-surface",
            "focus:outline-none focus:border-primary",
            status === "error" ? "border-error" : "border-outline-variant",
          )}
        />
      ) : (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          dir={dirHint}
          rows={4}
          className={clsx(
            "min-h-[96px] px-3 py-2 rounded-md border bg-surface-container-lowest text-[16px] text-on-surface resize-y",
            "focus:outline-none focus:border-primary",
            status === "error" ? "border-error" : "border-outline-variant",
          )}
        />
      )}
      <div className="flex items-center gap-2 flex-wrap min-h-[36px]">
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !isDirty}
          className={clsx(
            "press-down inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-full text-xs font-bold transition-colors",
            isDirty && !pending
              ? "bg-primary text-on-primary"
              : "bg-surface-container text-on-surface-variant cursor-not-allowed opacity-70",
          )}
        >
          <Save className="h-3.5 w-3.5" strokeWidth={2} />
          {isHebrew ? "שמור" : "Save"}
        </button>
        {isOverridden && (
          <button
            type="button"
            onClick={onReset}
            disabled={pending}
            className={clsx(
              "press-down inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-full text-xs font-bold border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container",
              pending && "opacity-60 cursor-wait",
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
            {isHebrew ? "אפס לברירת מחדל" : "Reset to default"}
          </button>
        )}
        {status === "saved" && (
          <span className="text-xs text-secondary font-bold">
            {isHebrew ? "נשמר ✓" : "Saved ✓"}
          </span>
        )}
        {status === "error" && error && (
          <span className="text-xs text-error font-bold">{error}</span>
        )}
      </div>
    </div>
  );
}

function translateError(
  res: Exclude<Awaited<ReturnType<typeof saveOverride>>, { ok: true }>,
  isHebrew: boolean,
): string {
  switch (res.error) {
    case "unauthorized":
      return isHebrew ? "יש להתחבר" : "Sign in required";
    case "forbidden":
      return isHebrew ? "נדרשת הרשאת אדמין" : "Admin access required";
    case "invalid_locale":
      return isHebrew ? "שפה לא נתמכת" : "Locale not supported";
    case "invalid_value":
      return isHebrew ? "ערך לא תקין" : "Invalid value";
    case "missing_slot": {
      const slots = res.missingSlots?.join(", ") ?? "";
      return isHebrew
        ? `חסר משתנה בטקסט: ${slots}`
        : `Missing token: ${slots}`;
    }
    case "db":
      return isHebrew ? "שגיאת שמירה" : "Save failed";
  }
}
