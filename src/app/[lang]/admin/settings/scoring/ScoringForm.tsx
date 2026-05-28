"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { clsx } from "clsx";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import type { Locale } from "../../../dictionaries";
import { saveScoringSettings, type ScoringPayload } from "./actions";

// Field type - number input by default, toggle for boolean settings.
// The kind discriminator lets the renderer pick the right widget while
// keeping a single GROUPS source of truth.
type Field =
  | {
      kind?: "number";
      key: NumberKey;
      label: { he: string; en: string };
      hint?: { he: string; en: string };
    }
  | {
      kind: "toggle";
      key: BooleanKey;
      label: { he: string; en: string };
      hint?: { he: string; en: string };
    };

// Subset of ScoringPayload keys whose value is a number.
type NumberKey = Exclude<keyof ScoringPayload, BooleanKey>;
// Subset whose value is a boolean.
type BooleanKey = "matchRiskEnabled" | "dailyRenewalEnabled";

type Group = {
  title: { he: string; en: string };
  hint?: { he: string; en: string };
  fields: Field[];
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
    title: { he: "עלות API (קופה)", en: "API cost (pot)" },
    hint: {
      he: "סכום קבוע בש״ח שמנוכה מהקופה לפני שהאחוזים מתחלקים. מכסה את עלות מנוי API-Football למשך התקופה. אפס = ללא ניכוי. ברירת מחדל: 100.",
      en: "Fixed ILS amount pulled off the pot before the category percentages run. Covers the API-Football subscription for the tournament window. Zero = no deduction. Default: 100.",
    },
    fields: [
      {
        key: "adminOverheadIls",
        label: { he: "עלות API (ש״ח)", en: "API cost (ILS)" },
      },
    ],
  },
  {
    title: {
      he: "ניקוד משחקים (1/X/2)",
      en: "Match scoring (1/X/2)",
    },
    hint: {
      he: "תוצאה מדויקת מזכה במלוא הניקוד, כיוון נכון בלבד בניקוד נמוך יותר. אם תפעיל מצב סיכון, ניחוש שגוי יוריד נקודות מהבנק.",
      en: "An exact score earns the full payout, the right direction earns less. With risk mode on, a wrong pick subtracts points from the bank.",
    },
    fields: [
      {
        key: "scoringExact",
        label: { he: "תוצאה מדויקת", en: "Exact score" },
      },
      {
        key: "scoringOutcome",
        label: { he: "כיוון נכון", en: "Correct direction" },
      },
      {
        kind: "toggle",
        key: "matchRiskEnabled",
        label: { he: "מצב סיכון פעיל", en: "Risk mode enabled" },
        hint: {
          he: "כשמופעל, ניחוש שגוי גורר ניכוי של 'עונש סיכון' מהבנק. ברירת מחדל: כבוי.",
          en: "When on, a wrong pick subtracts the risk penalty from the bank. Default: off.",
        },
      },
      {
        key: "matchRiskPenalty",
        label: { he: "עונש סיכון (לכל משחק)", en: "Risk penalty (per match)" },
        hint: {
          he: "תקף רק כשמצב סיכון פעיל. הערך הזה גם נשמר על ההימור עצמו לצורך הצגה בבנק.",
          en: "Used only when risk mode is on. Also snapshotted onto each pick for the bank breakdown display.",
        },
      },
    ],
  },
  {
    title: { he: "התחדשות יומית", en: "Daily renewal" },
    hint: {
      he: "כשמופעל, כל משתתף מקבל את הסכום הזה כתוספת לבנק בכל יום בחצות (Asia/Jerusalem). כל תוספת נרשמת כשורת התאמה באודיט.",
      en: "When on, every player gets this many points added to their bank at 00:00 Asia/Jerusalem. Each tick lands as a point_adjustments audit row.",
    },
    fields: [
      {
        kind: "toggle",
        key: "dailyRenewalEnabled",
        label: { he: "התחדשות פעילה", en: "Renewal enabled" },
      },
      {
        key: "dailyRenewalAmount",
        label: { he: "תוספת יומית", en: "Daily amount" },
      },
    ],
  },
  {
    title: { he: "דו-קרב", en: "Duels" },
    hint: {
      he: "מגבלות על הימור 1 על 1. הטבלה עצמה נוצרה במיגרציה 0014; הפיצ'ר יפעל ב-PR הבא.",
      en: "Caps for 1v1 duels. The table itself lands in migration 0014; the feature ships in PR 3.",
    },
    fields: [
      {
        key: "duelMaxStake",
        label: { he: "השקעה מקסימלית", en: "Max stake" },
        hint: {
          he: "סף עליון 1-20 (אכוף גם בבסיס הנתונים).",
          en: "Hard ceiling 1-20 (DB CHECK mirrors this).",
        },
      },
      {
        key: "duelDefaultJoinWindowHours",
        label: {
          he: "חלון הצטרפות ברירת מחדל (שעות)",
          en: "Default join window (hours)",
        },
      },
      {
        key: "duelDailyLimit",
        label: {
          he: "מגבלת דו-קרבים ליום",
          en: "Daily duels per user",
        },
        hint: {
          he: "מקסימום דו-קרבים שמשתמש יכול לפתוח ב-24 שעות.",
          en: "Cap on duels one user can open in any 24h window.",
        },
      },
    ],
  },
  {
    title: { he: "הימורי לייב - יחסים", en: "Live bets - ratios" },
    hint: {
      he: "פרמטרי המרה מ-odds של בוקמייקרים ל-stake/payout בנקודות שלנו. בכל הימור אדמין יכול לעקוף את החישוב האוטומטי.",
      en: "How bookmaker odds map to our stake/payout. Admin can override per bet at publish time.",
    },
    fields: [
      {
        key: "liveOddsBaseStake",
        label: { he: "השקעת בסיס", en: "Base stake" },
      },
      {
        key: "liveOddsMaxPayout",
        label: { he: "תקרת תשלום", en: "Max payout cap" },
      },
      {
        key: "liveOddsHouseEdgePct",
        label: { he: "house edge (%)", en: "House edge (%)" },
        hint: {
          he: "מקטין את התשלום הגולמי באחוז הזה. 0 = יחס בוקמייקר מלא; 5 = ברירת מחדל.",
          en: "Trims the raw bookmaker payout by this %. 0 = full bookmaker odds; 5 = default.",
        },
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

// Legacy top-4 split (still rendered for backwards compatibility with
// the existing PrizeStrip until PR 5 swaps the public prize UI).
const LEGACY_PRIZE_FIELDS: Array<{
  key: NumberKey;
  label: { he: string; en: string };
}> = [
  { key: "prizePct1", label: { he: "מקום ראשון %", en: "1st place %" } },
  { key: "prizePct2", label: { he: "מקום שני %", en: "2nd place %" } },
  { key: "prizePct3", label: { he: "מקום שלישי %", en: "3rd place %" } },
  { key: "prizePct4", label: { he: "מקום רביעי %", en: "4th place %" } },
];

// 7-way category split (must sum to exactly 100; the save button is
// disabled while the sum is off and the form surfaces the delta).
const CATEGORY_PRIZE_FIELDS: Array<{
  key: NumberKey;
  label: { he: string; en: string };
}> = [
  { key: "prizeKingFirstPct",     label: { he: "מלך - מקום 1", en: "King - 1st" } },
  { key: "prizeKingSecondPct",    label: { he: "מלך - מקום 2", en: "King - 2nd" } },
  { key: "prizeKingThirdPct",     label: { he: "מלך - מקום 3", en: "King - 3rd" } },
  { key: "prizeMatchesWinnerPct", label: { he: "אלוף הניחושים", en: "Matches winner" } },
  { key: "prizeLiveWinnerPct",    label: { he: "אלוף הלייב", en: "Live winner" } },
  { key: "prizeDuelsWinnerPct",   label: { he: "אלוף הדו-קרב", en: "Duels winner" } },
  { key: "prizeReservePct",       label: { he: "רזרבה", en: "Reserve" } },
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

  const updateNumber = (k: NumberKey, v: string) => {
    const n = v === "" ? 0 : Number(v);
    if (!Number.isFinite(n)) return;
    setValues((prev) => ({ ...prev, [k]: Math.max(0, Math.trunc(n)) }));
  };
  const updateBoolean = (k: BooleanKey, v: boolean) => {
    setValues((prev) => ({ ...prev, [k]: v }));
  };

  const categorySum =
    values.prizeKingFirstPct +
    values.prizeKingSecondPct +
    values.prizeKingThirdPct +
    values.prizeMatchesWinnerPct +
    values.prizeLiveWinnerPct +
    values.prizeDuelsWinnerPct +
    values.prizeReservePct;
  const categorySumOk = categorySum === 100;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (!categorySumOk) {
      setError("invalid");
      return;
    }
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
            {group.fields.map((f) =>
              f.kind === "toggle" ? (
                <ToggleField
                  key={f.key}
                  field={f}
                  value={values[f.key]}
                  onChange={(v) => updateBoolean(f.key, v)}
                  isHebrew={isHebrew}
                />
              ) : (
                <NumberField
                  key={f.key}
                  field={f}
                  value={values[f.key]}
                  onChange={(v) => updateNumber(f.key, v)}
                  isHebrew={isHebrew}
                />
              ),
            )}
          </div>
        </Card>
      ))}

      <CategoryPrizeCard
        values={values}
        update={updateNumber}
        potIls={potIls}
        sum={categorySum}
        isHebrew={isHebrew}
      />

      <LegacyPrizeSplitCard
        values={values}
        update={updateNumber}
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
          disabled={pending || !categorySumOk}
          className={clsx(
            "px-10 py-3",
            (pending || !categorySumOk) && "opacity-60 cursor-not-allowed",
          )}
        >
          {pending
            ? isHebrew ? "שומר..." : "Saving..."
            : isHebrew ? "שמור הגדרות" : "Save settings"}
        </PillButton>
      </div>
    </form>
  );
}

function NumberField({
  field,
  value,
  onChange,
  isHebrew,
}: {
  field: { key: NumberKey; label: { he: string; en: string }; hint?: { he: string; en: string } };
  value: number;
  onChange: (v: string) => void;
  isHebrew: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={`set-${field.key}`}
        className="font-bold text-sm text-on-surface"
      >
        {isHebrew ? field.label.he : field.label.en}
      </label>
      <input
        id={`set-${field.key}`}
        type="number"
        inputMode="numeric"
        min={0}
        max={32000}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold tabular-nums focus:outline-none focus:border-primary"
        dir="ltr"
      />
      {field.hint && (
        <p className="text-[11px] text-on-surface-variant">
          {isHebrew ? field.hint.he : field.hint.en}
        </p>
      )}
    </div>
  );
}

function ToggleField({
  field,
  value,
  onChange,
  isHebrew,
}: {
  field: { key: BooleanKey; label: { he: string; en: string }; hint?: { he: string; en: string } };
  value: boolean;
  onChange: (v: boolean) => void;
  isHebrew: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-bold text-sm text-on-surface">
        {isHebrew ? field.label.he : field.label.en}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={clsx(
          "h-12 min-w-[44px] px-4 inline-flex items-center justify-between gap-3 rounded-lg border text-sm font-bold transition-colors",
          value
            ? "bg-primary text-on-primary border-primary"
            : "bg-surface-container-lowest text-on-surface border-outline",
        )}
      >
        <span>{value ? (isHebrew ? "פעיל" : "On") : isHebrew ? "כבוי" : "Off"}</span>
        <span
          className={clsx(
            "inline-block w-10 h-6 rounded-full relative transition-colors",
            value ? "bg-on-primary/30" : "bg-outline-variant",
          )}
          aria-hidden
        >
          <span
            className={clsx(
              "absolute top-0.5 w-5 h-5 rounded-full bg-surface-container-lowest transition-all",
              value ? (isHebrew ? "left-0.5" : "right-0.5") : isHebrew ? "right-0.5" : "left-0.5",
            )}
          />
        </span>
      </button>
      {field.hint && (
        <p className="text-[11px] text-on-surface-variant">
          {isHebrew ? field.hint.he : field.hint.en}
        </p>
      )}
    </div>
  );
}

// `invalid` overrides the COMMON wording with the long range-spec hint
// the scoring form needs; the rest reuse the shared admin error map.
const ERROR_MAP = {
  ...COMMON_ADMIN_ERRORS,
  invalid: [
    "ערכים לא תקינים. כל ערך מספרי שלם בין 0-32000, תשלומים ≥ 1, מקסימום השקעה בדו-קרב 1-20. סכום אחוזי הקטגוריות חייב להיות בדיוק 100. אחוזי הליגה הישנים ≤ 100.",
    "Invalid values. Integers 0-32000, payouts ≥ 1, duel stake 1-20. Category prize percentages must sum to exactly 100. Legacy split must sum to ≤ 100.",
  ],
} as const satisfies Record<string, LocalizedTuple>;

function translateError(code: string, isHebrew: boolean): string {
  return translateAdminError(code in ERROR_MAP ? code : "db", ERROR_MAP, isHebrew);
}

function CategoryPrizeCard({
  values,
  update,
  potIls,
  sum,
  isHebrew,
}: {
  values: ScoringPayload;
  update: (k: NumberKey, v: string) => void;
  potIls: number;
  sum: number;
  isHebrew: boolean;
}) {
  const over = sum > 100;
  const under = sum < 100;
  const ok = sum === 100;
  // Distributable pot = pot − admin overhead, floored at 0. Each
  // category's ILS preview runs on this so the admin sees the same
  // numbers players will see on the public prize strip.
  const distributableIls = Math.max(0, potIls - (Number(values.adminOverheadIls) || 0));
  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SectionHeading underline="thin" as="h2">
          {isHebrew ? "פרסים - חלוקה לפי קטגוריות" : "Prizes - category split"}
        </SectionHeading>
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? "מלך המונדיאל זוכה במקומות 1/2/3, ובנוסף יש אלוף בודד לכל קטגוריה (משחקים/לייב/דו-קרב). הסכום חייב להיות בדיוק 100%."
            : "The overall king gets 1st/2nd/3rd; each category (matches/live/duels) also has a single winner. Total must be exactly 100%."}
        </p>
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? `קופה ${potIls.toLocaleString()} ש״ח · עלות API ${(Number(values.adminOverheadIls) || 0).toLocaleString()} ש״ח · לחלוקה ${distributableIls.toLocaleString()} ש״ח`
            : `Pot ${potIls.toLocaleString()} ILS · API cost ${(Number(values.adminOverheadIls) || 0).toLocaleString()} ILS · Distributable ${distributableIls.toLocaleString()} ILS`}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CATEGORY_PRIZE_FIELDS.map((f) => {
          const pct = Number(values[f.key]) || 0;
          const ils = Math.floor((distributableIls * pct) / 100);
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
                    {isHebrew ? "מהסכום לחלוקה" : "of distributable"}
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
          ok
            ? "bg-secondary-container text-on-secondary-container border-secondary-fixed"
            : "bg-error-container text-on-error-container border-error",
        )}
      >
        <span className="text-sm font-bold">
          {isHebrew ? "סה״כ אחוזים" : "Total %"}
        </span>
        <span className="font-[family-name:var(--font-score)] text-lg font-bold tabular-nums">
          <bdi>{sum}%</bdi>
          {under && (
            <span>
              {" "}
              · {isHebrew ? "חסר" : "missing"} {100 - sum}%
            </span>
          )}
          {over && (
            <span>
              {" "}
              · {isHebrew ? "עודף" : "excess"} {sum - 100}%
            </span>
          )}
        </span>
      </div>
    </Card>
  );
}

function LegacyPrizeSplitCard({
  values,
  update,
  potIls,
  isHebrew,
}: {
  values: ScoringPayload;
  update: (k: NumberKey, v: string) => void;
  potIls: number;
  isHebrew: boolean;
}) {
  const total =
    values.prizePct1 + values.prizePct2 + values.prizePct3 + values.prizePct4;
  const over = total > 100;
  const remainder = 100 - total;
  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SectionHeading underline="thin" as="h2">
          {isHebrew ? "חלוקת הקופה הישנה (1-4)" : "Legacy prize split (1st-4th)"}
        </SectionHeading>
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? "נשמר זמנית לתאימות עם תצוגת הפרסים הקיימת. ייעלם בעדכון תצוגת הפרסים."
            : "Kept temporarily for the existing PrizeStrip. Will be removed once the new prize UI ships."}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {LEGACY_PRIZE_FIELDS.map((f) => {
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
