"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { clsx } from "clsx";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import type { Locale } from "../../../dictionaries";
import { saveScoringSettings, type ScoringPayload } from "./actions";

type Group = {
  title: { he: string; en: string };
  hint?: { he: string; en: string };
  fields: Array<{
    key: keyof ScoringPayload;
    label: { he: string; en: string };
    hint?: { he: string; en: string };
  }>;
};

const GROUPS: Group[] = [
  {
    title: { he: "כללי", en: "General" },
    fields: [
      {
        key: "startingBank",
        label: { he: "בנק התחלתי", en: "Starting bank" },
        hint: {
          he: "סכום נקודות התחלתי לכל משתתף",
          en: "Points each player starts with",
        },
      },
    ],
  },
  {
    title: {
      he: "הימור משחק (1/X/2 חינם)",
      en: "Match bet (1/X/2 free)",
    },
    fields: [
      {
        key: "scoringExact",
        label: { he: "תוצאה מדויקת", en: "Exact score" },
      },
      {
        key: "scoringOutcome",
        label: { he: "כיוון נכון", en: "Correct outcome" },
      },
    ],
  },
  {
    title: {
      he: "ברירות מחדל להימורים מותאמים",
      en: "Custom-bet defaults",
    },
    hint: {
      he: "כשתיצור הימור חדש דרך /admin/bets/new הטופס יציע את ערכי ברירת המחדל לפי סוג התשובה. ניתן לשנות פר-הימור.",
      en: "Used as the starting stake/payout when you author a new custom bet. You can override per bet at creation time.",
    },
    fields: [
      { key: "stakeYesNo",        label: { he: "עלות כן/לא", en: "Yes/No stake" } },
      { key: "payoutYesNo",       label: { he: "תשלום כן/לא", en: "Yes/No payout" } },
      { key: "stakeNumber",       label: { he: "עלות מספר", en: "Number stake" } },
      { key: "payoutNumber",      label: { he: "תשלום מספר", en: "Number payout" } },
      { key: "stakeMultiChoice",  label: { he: "עלות בחירה", en: "Choice stake" } },
      { key: "payoutMultiChoice", label: { he: "תשלום בחירה", en: "Choice payout" } },
      { key: "stakeFreeText",     label: { he: "עלות טקסט", en: "Text stake" } },
      { key: "payoutFreeText",    label: { he: "תשלום טקסט", en: "Text payout" } },
    ],
  },
];

const PRIZE_FIELDS: Array<{
  key: keyof ScoringPayload;
  label: { he: string; en: string };
}> = [
  { key: "prizePct1", label: { he: "מקום ראשון %", en: "1st place %" } },
  { key: "prizePct2", label: { he: "מקום שני %", en: "2nd place %" } },
  { key: "prizePct3", label: { he: "מקום שלישי %", en: "3rd place %" } },
  { key: "prizePct4", label: { he: "מקום רביעי %", en: "4th place %" } },
];

export function ScoringForm({
  initial,
  locale,
  potIls,
}: {
  initial: ScoringPayload;
  locale: Locale;
  potIls: number;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [values, setValues] = useState<ScoringPayload>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const update = (k: keyof ScoringPayload, v: string) => {
    const n = v === "" ? 0 : Number(v);
    if (!Number.isFinite(n)) return;
    setValues((prev) => ({ ...prev, [k]: Math.max(0, Math.trunc(n)) }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveScoringSettings(values);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      {GROUPS.map((group) => (
        <Card key={group.title.en} className="p-5 md:p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <SectionHeading underline="thin" as="h2">
              {isHebrew ? group.title.he : group.title.en}
            </SectionHeading>
            {group.hint && (
              <p className="text-xs text-on-surface-variant">
                {isHebrew ? group.hint.he : group.hint.en}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {group.fields.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <label
                  htmlFor={`set-${f.key}`}
                  className="font-bold text-sm text-on-surface"
                >
                  {isHebrew ? f.label.he : f.label.en}
                </label>
                <input
                  id={`set-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={32000}
                  step={1}
                  value={values[f.key]}
                  onChange={(e) => update(f.key, e.target.value)}
                  className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold tabular-nums focus:outline-none focus:border-primary"
                  dir="ltr"
                />
                {f.hint && (
                  <p className="text-[11px] text-on-surface-variant">
                    {isHebrew ? f.hint.he : f.hint.en}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      <PrizeSplitCard
        values={values}
        update={update}
        potIls={potIls}
        isHebrew={isHebrew}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap sticky bottom-2 bg-surface-container-low/95 backdrop-blur p-3 rounded-xl border border-outline-variant shadow-lg">
        <div>
          {error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-error">
              <AlertCircle className="h-4 w-4" strokeWidth={2} />
              {translateError(error, isHebrew)}
            </p>
          )}
          {saved && !error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-secondary">
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew ? "ההגדרות נשמרו" : "Settings saved"}
            </p>
          )}
        </div>
        <PillButton
          type="submit"
          disabled={pending}
          className={clsx("px-10 py-3", pending && "opacity-60 cursor-not-allowed")}
        >
          {pending
            ? isHebrew ? "שומר..." : "Saving..."
            : isHebrew ? "שמור הגדרות" : "Save settings"}
        </PillButton>
      </div>
    </form>
  );
}

function translateError(code: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    invalid: [
      "ערכים לא תקינים. כל ערך חייב להיות מספר שלם בין 0 ל-32000. תשלומים חייבים להיות ≥ 1. סכום אחוזי הזכייה ≤ 100.",
      "Invalid values. Each must be an integer between 0 and 32000. Payouts must be ≥ 1. Prize percentages must sum to ≤ 100.",
    ],
    unauth:    ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאות אדמין", "Admin role required"],
    db:        ["שגיאת שמירה", "Save failed"],
  };
  return (map[code] ?? map.db)[isHebrew ? 0 : 1];
}

function PrizeSplitCard({
  values,
  update,
  potIls,
  isHebrew,
}: {
  values: ScoringPayload;
  update: (k: keyof ScoringPayload, v: string) => void;
  potIls: number;
  isHebrew: boolean;
}) {
  const total =
    values.prizePct1 + values.prizePct2 + values.prizePct3 + values.prizePct4;
  const over = total > 100;
  const remainder = 100 - total;
  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <SectionHeading underline="thin" as="h2">
        {isHebrew ? "חלוקת הקופה (1-4)" : "Prize split (1st-4th)"}
      </SectionHeading>
      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "האחוז של כל מקום מהקופה הנוכחית. הסכומים מתעדכנים אוטומטית כל פעם שמתקבל תשלום חדש."
          : "Each rank's share of the current pot. Amounts auto-update whenever a payment is approved."}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PRIZE_FIELDS.map((f) => {
          const pct = Number(values[f.key]) || 0;
          const ils = Math.floor((potIls * pct) / 100);
          return (
            <div key={f.key} className="flex flex-col gap-1.5">
              <label
                htmlFor={`set-${f.key}`}
                className="font-bold text-sm text-on-surface"
              >
                {isHebrew ? f.label.he : f.label.en}
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  id={`set-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  value={values[f.key]}
                  onChange={(e) => update(f.key, e.target.value)}
                  className="w-24 h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold tabular-nums text-center focus:outline-none focus:border-primary"
                  dir="ltr"
                />
                <span className="flex-1 h-12 px-3 flex items-center justify-between rounded-lg bg-surface-container-low border border-outline-variant">
                  <span className="text-xs text-on-surface-variant">
                    {isHebrew ? "מקופה נוכחית" : "of current pot"}
                  </span>
                  <span className="font-[family-name:var(--font-score)] text-lg font-bold tabular-nums">
                    <bdi>
                      {ils.toLocaleString()} {isHebrew ? "ש״ח" : "ILS"}
                    </bdi>
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={clsx(
          "flex items-center justify-between gap-3 p-3 rounded-lg border",
          over
            ? "bg-error-container text-on-error-container border-error"
            : remainder === 0
              ? "bg-secondary-container text-on-secondary-container border-secondary-fixed"
              : "bg-surface-container-low text-on-surface-variant border-outline-variant",
        )}
      >
        <span className="text-sm font-bold">
          {isHebrew ? "סה״כ אחוזים" : "Total %"}
        </span>
        <span className="font-[family-name:var(--font-score)] text-lg font-bold tabular-nums">
          <bdi>{total}%</bdi>
          {!over && remainder > 0 && (
            <span className="opacity-60">
              {" "}
              · {isHebrew ? "לא חולק" : "unallocated"} {remainder}%
            </span>
          )}
          {over && (
            <span>
              {" "}
              · {isHebrew ? "חורג מ-100%" : "exceeds 100%"}
            </span>
          )}
        </span>
      </div>
    </Card>
  );
}
