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
    title: { he: "הימור משחק (1/X/2 חינם)", en: "Match bet (1/X/2 free)" },
    fields: [
      { key: "scoringExact", label: { he: "תוצאה מדויקת", en: "Exact score" } },
      { key: "scoringOutcome", label: { he: "כיוון נכון", en: "Correct outcome" } },
    ],
  },
  {
    title: { he: "BTTS / Over 2.5 / מחצית", en: "BTTS / Over 2.5 / HT" },
    fields: [
      { key: "stakeBtts", label: { he: "עלות BTTS", en: "BTTS stake" } },
      { key: "scoringBtts", label: { he: "תשלום BTTS", en: "BTTS payout" } },
      { key: "stakeOver25", label: { he: "עלות Over 2.5", en: "Over 2.5 stake" } },
      { key: "scoringOver25", label: { he: "תשלום Over 2.5", en: "Over 2.5 payout" } },
      { key: "stakeHt", label: { he: "עלות מחצית", en: "Halftime stake" } },
      { key: "scoringHtExact", label: { he: "תשלום מחצית מדויק", en: "HT exact payout" } },
      { key: "scoringHtOutcome", label: { he: "תשלום כיוון מחצית", en: "HT outcome payout" } },
    ],
  },
  {
    title: { he: "דירוג קבוצות", en: "Group ranking" },
    fields: [
      {
        key: "stakeGroupTeam",
        label: { he: "עלות לכל קבוצה", en: "Stake per team" },
        hint: {
          he: "המשתתף משלם פעם אחת לכל קבוצה שמדרג",
          en: "Charged once per team in a group prediction",
        },
      },
      { key: "scoringGroupTeam", label: { he: "תשלום קבוצה נכונה", en: "Per-team payout" } },
      {
        key: "scoringGroupPerfect",
        label: { he: "בונוס בית מושלם", en: "Perfect group bonus" },
        hint: {
          he: "בונוס נוסף כשכל 4 הקבוצות בבית נכונות",
          en: "Extra when all 4 ranks are correct",
        },
      },
    ],
  },
  {
    title: { he: "ארבעת הגדולים", en: "Bracket" },
    fields: [
      { key: "stakeBracketChampion", label: { he: "עלות אלוף", en: "Champion stake" } },
      { key: "scoringChampion", label: { he: "תשלום אלוף", en: "Champion payout" } },
      { key: "stakeBracketRunnerUp", label: { he: "עלות סגן", en: "Runner-up stake" } },
      { key: "scoringRunnerUp", label: { he: "תשלום סגן", en: "Runner-up payout" } },
      { key: "stakeBracketThird", label: { he: "עלות שלישי", en: "Third stake" } },
      { key: "scoringThird", label: { he: "תשלום שלישי", en: "Third payout" } },
      { key: "stakeBracketFourth", label: { he: "עלות רביעי", en: "Fourth stake" } },
      { key: "scoringFourth", label: { he: "תשלום רביעי", en: "Fourth payout" } },
    ],
  },
  {
    title: { he: "הימורי על", en: "Special bets" },
    fields: [
      { key: "stakeTopScorer", label: { he: "עלות מלך שערים", en: "Top scorer stake" } },
      { key: "scoringTopScorer", label: { he: "תשלום מלך שערים", en: "Top scorer payout" } },
      { key: "stakeFinalPenalties", label: { he: "עלות פנדלים בגמר", en: "Final penalties stake" } },
      { key: "scoringFinalPenalties", label: { he: "תשלום פנדלים בגמר", en: "Final penalties payout" } },
    ],
  },
];

export function ScoringForm({
  initial,
  locale,
}: {
  initial: ScoringPayload;
  locale: Locale;
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
          <SectionHeading underline="thin" as="h2">
            {isHebrew ? group.title.he : group.title.en}
          </SectionHeading>
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
            ? isHebrew
              ? "שומר..."
              : "Saving..."
            : isHebrew
              ? "שמור הגדרות"
              : "Save settings"}
        </PillButton>
      </div>
    </form>
  );
}

function translateError(code: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    invalid: [
      "ערכים לא תקינים. כל ערך חייב להיות מספר שלם בין 0 ל-32000.",
      "Invalid values. Each must be an integer between 0 and 32000.",
    ],
    unauth: ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאות אדמין", "Admin role required"],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return (map[code] ?? map.db)[isHebrew ? 0 : 1];
}
