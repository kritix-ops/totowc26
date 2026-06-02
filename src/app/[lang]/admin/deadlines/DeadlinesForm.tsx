"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import { usePendingAction } from "@/lib/use-pending-action";
import {
  formatDateTime,
  isoToLocalInputValue,
  localInputValueToIso,
} from "@/lib/format";
import {
  BET_TYPE_KEYS,
  STAGE_KEYS,
  type BetTypeKey,
  type StageKey,
} from "@/db/schema";
import {
  saveMatchLockOverride,
  saveMatchPicksGlobalLock,
  saveMatchdayOverride,
  saveReminderOffset,
  saveStageDefaults,
  saveTournamentStart,
  saveTypeDefaults,
} from "./actions";
import type { Locale } from "../../dictionaries";

// Hebrew + English labels and helper text per bet type. The catalog is
// derived from BET_TYPE_KEYS (the schema-level source of truth) so a
// new bet type forces a compile-time entry here. `exampleHe/exampleEn`
// is a concrete user-facing bet question; the admin form uses it as the
// primary explainer because the abstract scope name alone is ambiguous.
const TYPE_LABELS: Record<BetTypeKey, {
  he: string;
  en: string;
  exampleHe: string;
  exampleEn: string;
  anchorHe: string;
  anchorEn: string;
}> = {
  match_score: {
    he: "ניחוש תוצאה (1/X/2)",
    en: "Score prediction (1/X/2)",
    exampleHe: "למשל: ארגנטינה - איטליה, 1 / X / 2?",
    exampleEn: "e.g. Argentina vs Italy, 1 / X / 2?",
    anchorHe: "בעיטת הפתיחה של המשחק",
    anchorEn: "match kickoff",
  },
  custom_match: {
    he: "משחק",
    en: "Match",
    exampleHe: "למשל: מי יבקיע ראשון במשחק הזה?",
    exampleEn: "e.g. Who scores first in this match?",
    anchorHe: "בעיטת הפתיחה של אותו משחק",
    anchorEn: "kickoff of that match",
  },
  custom_day: {
    he: "יום הימורים",
    en: "Matchday",
    exampleHe: "למשל: כמה גולים סך הכל בכל משחקי היום?",
    exampleEn: "e.g. How many goals across all of today's matches?",
    anchorHe: "המשחק הראשון של היום",
    anchorEn: "earliest kickoff of the day",
  },
  custom_group: {
    he: "בית (A..L)",
    en: "Group (A..L)",
    exampleHe: "למשל: מי תעלה ראשונה מבית A?",
    exampleEn: "e.g. Who finishes 1st in Group A?",
    anchorHe: "המשחק הראשון של אותו בית",
    anchorEn: "earliest kickoff in that group",
  },
  custom_stage: {
    he: "שלב (שלב הבתים / 1/8 / 1/4 / 1/2 / גמר)",
    en: "Stage (Groups / R16 / QF / SF / Final)",
    exampleHe: "למשל: כמה כרטיסים אדומים יוצאו בשלב הבתים?",
    exampleEn: "e.g. How many red cards in the group stage?",
    anchorHe: "המשחק הראשון של אותו שלב",
    anchorEn: "earliest kickoff in that stage",
  },
  custom_tournament: {
    he: "כל הטורניר",
    en: "Whole tournament",
    exampleHe: "למשל: מי תזכה במונדיאל?",
    exampleEn: "e.g. Who wins the tournament?",
    anchorHe: "תחילת הטורניר",
    anchorEn: "tournament start",
  },
};

// Display order inside the admin form: score bet alone at the top, then
// the five custom variants narrowest -> widest scope. Distinct from
// BET_TYPE_KEYS, which is the schema-level order and is still used for
// the save payload (order doesn't matter on the wire).
const CUSTOM_BET_DISPLAY_ORDER: BetTypeKey[] = [
  "custom_match",
  "custom_day",
  "custom_group",
  "custom_stage",
  "custom_tournament",
];

type MatchdayRow = {
  id: string;
  date: string;
  label: string | null;
  lockOffsetOverrideMinutes: number | null;
  earliestKickoffAt: string | null;
  // Stage of the earliest match on this matchday. Drives the
  // "inherited from stage default" placeholder; null when the matchday
  // has no matches scheduled yet.
  earliestStage: string | null;
};

// Hebrew + English labels per stage. STAGE_KEYS is the schema-level
// source of truth so a new stage forces a compile-time entry here.
const STAGE_LABELS: Record<StageKey, { he: string; en: string }> = {
  group: { he: "שלב הבתים", en: "Group stage" },
  r32: { he: "1/16 גמר (סבב 32)", en: "Round of 32" },
  r16: { he: "1/8 גמר (סבב 16)", en: "Round of 16" },
  qf: { he: "רבע גמר", en: "Quarter-finals" },
  sf: { he: "חצי גמר", en: "Semi-finals" },
  third_place: { he: "משחק על המקום השלישי", en: "Third-place play-off" },
  final: { he: "גמר", en: "Final" },
};

type MatchRow = {
  id: string;
  kickoffAt: string;
  lockAtOverride: string | null;
  homeTeam: string;
  awayTeam: string;
  stage: string;
};

type Props = {
  locale: Locale;
  initialDefaults: Record<BetTypeKey, number>;
  initialStageDefaults: Partial<Record<StageKey, number>>;
  initialTournamentStartAt: string | null;
  initialMatchPicksGlobalLockAt: string | null;
  derivedTournamentStartAt: string | null;
  initialReminderOffsetMinutes: number;
  matchdays: MatchdayRow[];
  matches: MatchRow[];
};

export function DeadlinesForm({
  locale,
  initialDefaults,
  initialStageDefaults,
  initialTournamentStartAt,
  initialMatchPicksGlobalLockAt,
  derivedTournamentStartAt,
  initialReminderOffsetMinutes,
  matchdays,
  matches,
}: Props) {
  const isHebrew = locale === "he";
  return (
    <div className="flex flex-col gap-6">
      <MatchPicksGlobalLockCard
        locale={locale}
        isHebrew={isHebrew}
        initial={initialMatchPicksGlobalLockAt}
        matchScoreDefault={initialDefaults.match_score}
      />
      <TournamentStartCard
        locale={locale}
        isHebrew={isHebrew}
        initial={initialTournamentStartAt}
        derived={derivedTournamentStartAt}
      />
      <ReminderOffsetCard
        isHebrew={isHebrew}
        initial={initialReminderOffsetMinutes}
      />
      <TypeDefaultsCard isHebrew={isHebrew} initial={initialDefaults} />
      <StageDefaultsCard
        isHebrew={isHebrew}
        initial={initialStageDefaults}
        dayDefault={initialDefaults.custom_day}
      />
      <MatchdayOverridesCard
        locale={locale}
        isHebrew={isHebrew}
        matchdays={matchdays}
        typeDefaults={initialDefaults}
        stageDefaults={initialStageDefaults}
      />
      <MatchOverridesCard
        locale={locale}
        isHebrew={isHebrew}
        matches={matches}
      />
    </div>
  );
}

// Master switch for 1/X/2 score picks. Empty (the default since
// migration 0039) = each match locks individually via the per-type
// default cascade. Set a datetime = every score pick across the whole
// tournament freezes at that one moment instead. This card sits first
// because it answers the highest-level question an admin has about score
// bets: "do picks close per match, or all at once?"
function MatchPicksGlobalLockCard({
  locale,
  isHebrew,
  initial,
  matchScoreDefault,
}: {
  locale: Locale;
  isHebrew: boolean;
  initial: string | null;
  // The match_score per-type default (minutes before kickoff). Shown in
  // the "per-match mode" caption so the admin sees exactly when each
  // match will lock while the global cap is off.
  matchScoreDefault: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(isoToLocalInputValue(initial));
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSave() {
    setError(null);
    setSaved(false);
    void run(async () => {
      const iso = value ? localInputValueToIso(value) : null;
      const res = await saveMatchPicksGlobalLock(iso);
      if (!res.ok) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }
  function onClear() {
    setValue("");
    setError(null);
    setSaved(false);
    void run(async () => {
      const res = await saveMatchPicksGlobalLock(null);
      if (!res.ok) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  // Live preview of the chosen cutoff so the admin sees the resolved
  // Asia/Jerusalem time before saving.
  const previewIso = value ? localInputValueToIso(value) : null;
  const isGlobal = previewIso !== null;
  const previewLabel = previewIso
    ? formatDateTime(previewIso, locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <SectionHeading underline="thin" as="h2">
        {isHebrew ? "נעילה גלובלית לניחושי תוצאה" : "Global lock for score picks"}
      </SectionHeading>
      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "קובע איך נסגרים ניחושי התוצאה (1/X/2). ריק = כל משחק נסגר בנפרד, לפני הבעיטה שלו (מצב מומלץ). הגדרת תאריך ושעה = כל הניחושים בכל הטורניר ננעלים יחד באותו רגע."
          : "Controls how score (1/X/2) picks close. Empty = each match closes individually, before its own kickoff (recommended). Set a datetime = every pick across the whole tournament locks together at that one moment."}
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="font-bold text-sm text-on-surface">
          {isHebrew
            ? "מועד נעילה גלובלי (Asia/Jerusalem)"
            : "Global lock time (Asia/Jerusalem)"}
        </span>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
            setSaved(false);
          }}
          className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold focus:outline-none focus:border-primary"
          dir="ltr"
        />
      </label>
      <div
        className={`rounded-lg px-3 py-2.5 text-sm border ${
          isGlobal
            ? "bg-tertiary-fixed text-on-tertiary-fixed-variant border-tertiary-fixed-dim"
            : "bg-secondary-container text-on-secondary-container border-transparent"
        }`}
      >
        {isGlobal
          ? isHebrew
            ? `מצב נעילה גלובלית: כל ניחושי התוצאה ייסגרו יחד ב-${previewLabel}.`
            : `Global lock mode: every score pick closes together at ${previewLabel}.`
          : isHebrew
            ? `מצב לפי משחק: כל משחק נסגר ${matchScoreDefault} דקות לפני בעיטת הפתיחה שלו.`
            : `Per-match mode: each match closes ${matchScoreDefault} minutes before its own kickoff.`}
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-h-[24px]">
          {error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-error">
              <AlertCircle className="h-4 w-4" strokeWidth={2} />
              {translateError(error, isHebrew)}
            </p>
          )}
          {saved && !error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-secondary">
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew ? "נשמר" : "Saved"}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <PillButton
            variant="ghost"
            type="button"
            disabled={pending || value === ""}
            onClick={onClear}
          >
            {isHebrew ? "כבה נעילה גלובלית" : "Turn off global lock"}
          </PillButton>
          <PillButton type="button" disabled={pending} onClick={onSave}>
            {pending ? (isHebrew ? "שומר..." : "Saving...") : isHebrew ? "שמור" : "Save"}
          </PillButton>
        </div>
      </div>
    </Card>
  );
}

function TournamentStartCard({
  locale,
  isHebrew,
  initial,
  derived,
}: {
  locale: Locale;
  isHebrew: boolean;
  initial: string | null;
  derived: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(isoToLocalInputValue(initial));
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSave() {
    setError(null);
    setSaved(false);
    void run(async () => {
      const iso = value ? localInputValueToIso(value) : null;
      const res = await saveTournamentStart(iso);
      if (!res.ok) {
        setError(res.error);
      } else {
        setSaved(true);
        router.refresh();
      }
    });
  }
  function onClear() {
    setValue("");
    setError(null);
    setSaved(false);
    void run(async () => {
      const res = await saveTournamentStart(null);
      if (!res.ok) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  const derivedLabel = derived
    ? formatDateTime(derived, locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : isHebrew
      ? "אין עדיין משחקים בלוח"
      : "no fixtures yet";

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <SectionHeading underline="thin" as="h2">
        {isHebrew ? "תאריך תחילת הטורניר" : "Tournament start"}
      </SectionHeading>
      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "כל הימור ברמת הטורניר נסגר 'X דקות לפני' התאריך הזה. אם תשאיר ריק, נשתמש בבעיטת הפתיחה של המשחק הראשון בלוח."
          : "Every tournament-scope bet locks 'X minutes before' this datetime. Leave blank to use the earliest kickoff in the fixtures table."}
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="font-bold text-sm text-on-surface">
          {isHebrew ? "תאריך ושעה (Asia/Jerusalem)" : "Date & time (Asia/Jerusalem)"}
        </span>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold focus:outline-none focus:border-primary"
          dir="ltr"
        />
        <span className="text-[11px] text-on-surface-variant">
          {isHebrew ? "ברירת מחדל אוטומטית: " : "Automatic fallback: "}
          {derivedLabel}
        </span>
      </label>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-h-[24px]">
          {error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-error">
              <AlertCircle className="h-4 w-4" strokeWidth={2} />
              {translateError(error, isHebrew)}
            </p>
          )}
          {saved && !error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-secondary">
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew ? "נשמר" : "Saved"}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <PillButton
            variant="ghost"
            type="button"
            disabled={pending}
            onClick={onClear}
          >
            {isHebrew ? "נקה" : "Clear"}
          </PillButton>
          <PillButton type="button" disabled={pending} onClick={onSave}>
            {pending ? (isHebrew ? "שומר..." : "Saving...") : isHebrew ? "שמור" : "Save"}
          </PillButton>
        </div>
      </div>
    </Card>
  );
}

function ReminderOffsetCard({
  isHebrew,
  initial,
}: {
  isHebrew: boolean;
  initial: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState<number>(initial);
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSave() {
    setError(null);
    setSaved(false);
    void run(async () => {
      const res = await saveReminderOffset(value);
      if (!res.ok) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  const disabled = value === 0;
  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <SectionHeading underline="thin" as="h2">
        {isHebrew ? "תזכורות אימייל" : "Email reminders"}
      </SectionHeading>
      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "תזכורת אחת תישלח לכל משתתף שעוד יכול להמר, X דקות לפני שההימור נסגר. 0 = ללא תזכורות. הימורי תוצאה (1/X/2) ודו-קרבים לא נכללים - רק הימורים מותאמים."
          : "One reminder per (bet, eligible player) pair, sent X minutes before the bet locks. 0 disables the feature. Score (1/X/2) bets and duels are excluded — custom bets only."}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={10080}
          step={1}
          value={value}
          onChange={(e) => {
            const n = e.target.value === "" ? 0 : Number(e.target.value);
            setValue(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
            setError(null);
            setSaved(false);
          }}
          className="h-12 w-28 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold tabular-nums focus:outline-none focus:border-primary"
          dir="ltr"
        />
        <span className="text-sm text-on-surface-variant">
          {isHebrew ? "דקות לפני הנעילה" : "minutes before lock"}
        </span>
        {disabled && (
          <span className="text-xs text-tertiary font-bold ms-1">
            {isHebrew ? "(כבוי)" : "(disabled)"}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-h-[24px]">
          {error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-error">
              <AlertCircle className="h-4 w-4" strokeWidth={2} />
              {translateError(error, isHebrew)}
            </p>
          )}
          {saved && !error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-secondary">
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew ? "נשמר" : "Saved"}
            </p>
          )}
        </div>
        <PillButton type="button" disabled={pending} onClick={onSave}>
          {pending
            ? isHebrew ? "שומר..." : "Saving..."
            : isHebrew ? "שמור" : "Save"}
        </PillButton>
      </div>
    </Card>
  );
}

function TypeDefaultRow({
  isHebrew,
  betKey,
  value,
  onChange,
}: {
  isHebrew: boolean;
  betKey: BetTypeKey;
  value: number;
  onChange: (raw: string) => void;
}) {
  const labels = TYPE_LABELS[betKey];
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={`bld-${betKey}`}
        className="font-bold text-sm text-on-surface"
      >
        {isHebrew ? labels.he : labels.en}
      </label>
      <p className="text-xs text-on-surface-variant">
        {isHebrew ? labels.exampleHe : labels.exampleEn}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          id={`bld-${betKey}`}
          type="number"
          inputMode="numeric"
          min={0}
          max={20160}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-28 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold tabular-nums focus:outline-none focus:border-primary"
          dir="ltr"
        />
        <span className="text-sm text-on-surface-variant">
          {isHebrew
            ? `דקות לפני ${labels.anchorHe}`
            : `minutes before ${labels.anchorEn}`}
        </span>
      </div>
    </div>
  );
}

function TypeDefaultsCard({
  isHebrew,
  initial,
}: {
  isHebrew: boolean;
  initial: Record<BetTypeKey, number>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<BetTypeKey, number>>({ ...initial });
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(key: BetTypeKey, raw: string) {
    const n = raw === "" ? 0 : Number(raw);
    setValues((p) => ({ ...p, [key]: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0 }));
    setError(null);
    setSaved(false);
  }
  function onSave() {
    setError(null);
    setSaved(false);
    void run(async () => {
      const rows = BET_TYPE_KEYS.map((k) => ({
        betType: k,
        offsetMinutes: values[k],
      }));
      const res = await saveTypeDefaults(rows);
      if (!res.ok) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <SectionHeading underline="thin" as="h2">
        {isHebrew ? "ברירות מחדל לפי סוג הימור" : "Defaults per bet type"}
      </SectionHeading>
      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "כמה דקות לפני העוגן נסגר כל סוג הימור. שינוי כאן משפיע מיידית על ניחושי תוצאה; הימורים מותאמים שכבר נשמרו לא יושפעו עד עריכה ידנית."
          : "How many minutes before the anchor each bet type closes. Score bets shift live; existing custom bets keep their stored time until you edit them."}
      </p>
      <div className="flex flex-col gap-5">
        <TypeDefaultRow
          isHebrew={isHebrew}
          betKey="match_score"
          value={values.match_score}
          onChange={(raw) => update("match_score", raw)}
        />
        <div className="flex flex-col gap-3 pt-2 border-t border-outline-variant">
          <h3 className="font-bold text-sm text-on-surface">
            {isHebrew ? "הימורים מותאמים" : "Custom bets"}
          </h3>
          <p className="text-xs text-on-surface-variant -mt-1">
            {isHebrew
              ? "הימורים שאתה מנסח בעצמך (עמוד 'יצירת הימור'). כל סוג נסגר ביחס לעוגן שונה."
              : "Bets you author yourself (see the 'Create bet' page). Each variant locks against a different anchor."}
          </p>
          <div className="flex flex-col gap-4">
            {CUSTOM_BET_DISPLAY_ORDER.map((key) => (
              <TypeDefaultRow
                key={key}
                isHebrew={isHebrew}
                betKey={key}
                value={values[key]}
                onChange={(raw) => update(key, raw)}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-h-[24px]">
          {error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-error">
              <AlertCircle className="h-4 w-4" strokeWidth={2} />
              {translateError(error, isHebrew)}
            </p>
          )}
          {saved && !error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-secondary">
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew ? "נשמר" : "Saved"}
            </p>
          )}
        </div>
        <PillButton type="button" disabled={pending} onClick={onSave}>
          {pending ? (isHebrew ? "שומר..." : "Saving...") : isHebrew ? "שמור ברירות מחדל" : "Save defaults"}
        </PillButton>
      </div>
    </Card>
  );
}

// Editable string per stage. Empty string = "no per-stage override"
// (DELETEs the row on save); a numeric string upserts. Keeping the
// shape as strings lets the same input value cover both "no value yet"
// and "0 minutes" without an extra null branch.
type StageDraft = Record<StageKey, string>;

function buildStageDraft(initial: Partial<Record<StageKey, number>>): StageDraft {
  const draft = {} as StageDraft;
  for (const key of STAGE_KEYS) {
    draft[key] = initial[key] != null ? String(initial[key]) : "";
  }
  return draft;
}

function StageDefaultsCard({
  isHebrew,
  initial,
  dayDefault,
}: {
  isHebrew: boolean;
  initial: Partial<Record<StageKey, number>>;
  // Shown as placeholder so the admin sees what an empty stage row will
  // inherit (= the custom_day type default, which is the same value
  // matchdays already inherit).
  dayDefault: number;
}) {
  const router = useRouter();
  const [values, setValues] = useState<StageDraft>(() => buildStageDraft(initial));
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(key: StageKey, raw: string) {
    // Only digits or empty — keeps the input from getting into invalid
    // states the server would reject anyway.
    if (raw !== "" && !/^\d+$/.test(raw)) return;
    setValues((p) => ({ ...p, [key]: raw }));
    setError(null);
    setSaved(false);
  }

  function onSave() {
    setError(null);
    setSaved(false);
    void run(async () => {
      const rows = STAGE_KEYS.map((stage) => {
        const trimmed = values[stage].trim();
        return {
          stage,
          offsetMinutes: trimmed === "" ? null : Number(trimmed),
        };
      });
      const res = await saveStageDefaults(rows);
      if (!res.ok) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <SectionHeading underline="thin" as="h2">
        {isHebrew ? "ברירות מחדל לפי שלב בטורניר" : "Defaults per tournament stage"}
      </SectionHeading>
      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "ערך כאן דורס את ברירת המחדל לסוג עבור כל המשחקים, ימי ההימורים וההימורים מותאמים שמתרחשים בשלב הזה. ריק = נופל חזרה לברירת המחדל לסוג. שימושי כשרוצים, למשל, שכל ימי שלב הנוקאאוט ייסגרו 90 דקות לפני הבעיטה, בלי לערוך כל יום בנפרד."
          : "A value here overrides the per-type default for every match, matchday and custom bet that takes place during this stage. Empty = falls back to the per-type default. Useful when you want, for example, every knockout-stage day to lock 90 min before kickoff without editing each day individually."}
      </p>
      <ul className="flex flex-col divide-y divide-outline-variant border border-outline-variant rounded-lg">
        {STAGE_KEYS.map((stage) => {
          const labels = STAGE_LABELS[stage];
          return (
            <li
              key={stage}
              className="px-3 py-3 md:px-4 md:py-4 flex flex-wrap items-center gap-3"
            >
              <div className="flex-1 min-w-[160px]">
                <label
                  htmlFor={`sld-${stage}`}
                  className="font-bold text-sm text-on-surface"
                >
                  {isHebrew ? labels.he : labels.en}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id={`sld-${stage}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20160}
                  step={1}
                  value={values[stage]}
                  onChange={(e) => update(stage, e.target.value)}
                  placeholder={String(dayDefault)}
                  className="h-12 w-24 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold tabular-nums focus:outline-none focus:border-primary"
                  dir="ltr"
                  aria-label={
                    isHebrew
                      ? `דקות לפני המשחק הראשון בשלב ${labels.he}`
                      : `Minutes before earliest kickoff of ${labels.en}`
                  }
                />
                <span className="text-xs text-on-surface-variant">
                  {isHebrew ? "דק' לפני" : "min before"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-h-[24px]">
          {error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-error">
              <AlertCircle className="h-4 w-4" strokeWidth={2} />
              {translateError(error, isHebrew)}
            </p>
          )}
          {saved && !error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-secondary">
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {isHebrew ? "נשמר" : "Saved"}
            </p>
          )}
        </div>
        <PillButton type="button" disabled={pending} onClick={onSave}>
          {pending
            ? isHebrew ? "שומר..." : "Saving..."
            : isHebrew ? "שמור ברירות שלב" : "Save stage defaults"}
        </PillButton>
      </div>
    </Card>
  );
}

function MatchdayOverridesCard({
  locale,
  isHebrew,
  matchdays,
  typeDefaults,
  stageDefaults,
}: {
  locale: Locale;
  isHebrew: boolean;
  matchdays: MatchdayRow[];
  typeDefaults: Record<BetTypeKey, number>;
  stageDefaults: Partial<Record<StageKey, number>>;
}) {
  const sorted = useMemo(
    () => [...matchdays].sort((a, b) => a.date.localeCompare(b.date)),
    [matchdays],
  );
  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <SectionHeading underline="thin" as="h2">
        {isHebrew ? "דריסות לפי יום הימורים" : "Per-matchday overrides"}
      </SectionHeading>
      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "ערך כאן דורס את ברירת המחדל של 'ניחוש תוצאה' ו'משחק / יום' עבור היום הזה בלבד. ריק = נופל חזרה לברירת המחדל לשלב (אם יש כזו) ואחר כך לברירת המחדל לסוג."
          : "A value here overrides the per-type default for score, custom-match and custom-day bets on this date only. Empty = falls back to the per-stage default (if any) and then the per-type default."}
      </p>
      {sorted.length === 0 ? (
        <p className="text-sm text-on-surface-variant italic">
          {isHebrew
            ? "אין עדיין ימי הימורים - נוצרים אוטומטית כשפותחים הימור על תאריך."
            : "No matchdays yet — they're created automatically the first time a bet opens for a date."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-outline-variant border border-outline-variant rounded-lg">
          {sorted.map((m) => {
            // Resolution mirror of pickOffsetForMatchOrDay in
            // src/lib/deadlines.ts: stage default wins over type default
            // when this matchday's earliest match is in a stage that has
            // a saved per-stage row. Drives the placeholder + caption so
            // the admin sees which number an empty row will inherit.
            const stageKey =
              m.earliestStage != null &&
              (STAGE_KEYS as readonly string[]).includes(m.earliestStage)
                ? (m.earliestStage as StageKey)
                : null;
            const stageOffset =
              stageKey != null ? stageDefaults[stageKey] ?? null : null;
            const inherited = stageOffset ?? typeDefaults.custom_day;
            return (
              <MatchdayRowEditor
                key={m.id}
                locale={locale}
                isHebrew={isHebrew}
                row={m}
                inheritedOffset={inherited}
                inheritedFromStage={stageOffset != null ? stageKey : null}
              />
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function MatchdayRowEditor({
  locale,
  isHebrew,
  row,
  inheritedOffset,
  inheritedFromStage,
}: {
  locale: Locale;
  isHebrew: boolean;
  row: MatchdayRow;
  // What the empty-value placeholder shows. Either the per-stage
  // default for this matchday's stage, or the type default when no
  // stage default is set.
  inheritedOffset: number;
  // Non-null when the placeholder is coming from a per-stage row;
  // drives the "ברירת מחדל לשלב X: 90" caption so the admin sees
  // where the inherited value came from.
  inheritedFromStage: StageKey | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(
    row.lockOffsetOverrideMinutes != null ? String(row.lockOffsetOverrideMinutes) : "",
  );
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSave() {
    setError(null);
    setSaved(false);
    const trimmed = value.trim();
    const next: number | null =
      trimmed === "" ? null : Math.max(0, Math.floor(Number(trimmed)));
    if (next !== null && !Number.isFinite(next)) {
      setError("invalid");
      return;
    }
    void run(async () => {
      const res = await saveMatchdayOverride(row.id, next);
      if (!res.ok) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  const dateLabel = formatDateTime(`${row.date}T12:00:00Z`, locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const earliestLabel = row.earliestKickoffAt
    ? formatDateTime(row.earliestKickoffAt, locale, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";
  const stageLabel =
    inheritedFromStage != null
      ? STAGE_LABELS[inheritedFromStage][isHebrew ? "he" : "en"]
      : null;

  return (
    <li className="px-3 py-3 md:px-4 md:py-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[200px]">
        <p className="font-bold text-sm text-on-surface">{dateLabel}</p>
        <p className="text-[11px] text-on-surface-variant">
          {isHebrew
            ? `המשחק הראשון של היום: ${earliestLabel}`
            : `Earliest kickoff: ${earliestLabel}`}
        </p>
        {stageLabel && (
          <p className="text-[11px] text-tertiary font-bold mt-0.5">
            {isHebrew
              ? `יורש מברירת השלב (${stageLabel}): ${inheritedOffset} דק'`
              : `Inherits from stage default (${stageLabel}): ${inheritedOffset} min`}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={20160}
          step={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
            setSaved(false);
          }}
          placeholder={String(inheritedOffset)}
          className="h-12 w-24 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold tabular-nums focus:outline-none focus:border-primary"
          dir="ltr"
          aria-label={isHebrew ? "דקות לפני" : "minutes before"}
        />
        <span className="text-xs text-on-surface-variant">
          {isHebrew ? "דק' לפני" : "min before"}
        </span>
        <PillButton
          variant="ghost"
          type="button"
          disabled={pending}
          onClick={onSave}
          className="px-4 py-2"
        >
          {pending ? (isHebrew ? "שומר..." : "Saving...") : isHebrew ? "שמור" : "Save"}
        </PillButton>
      </div>
      <div className="basis-full">
        {error && (
          <p className="inline-flex items-center gap-1.5 text-xs text-error">
            <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
            {translateError(error, isHebrew)}
          </p>
        )}
        {saved && !error && (
          <p className="inline-flex items-center gap-1.5 text-xs text-secondary">
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            {isHebrew ? "נשמר" : "Saved"}
          </p>
        )}
      </div>
    </li>
  );
}

function MatchOverridesCard(props: {
  locale: Locale;
  isHebrew: boolean;
  matches: MatchRow[];
}) {
  const { locale, isHebrew, matches } = props;
  const [expanded, setExpanded] = useState(false);
  const upcoming = useMemo(
    () => [...matches].sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt)),
    [matches],
  );
  const visible = expanded ? upcoming : upcoming.slice(0, 5);

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4">
      <SectionHeading underline="thin" as="h2">
        {isHebrew ? "דריסה לפי משחק" : "Per-match override"}
      </SectionHeading>
      <p className="text-sm text-on-surface-variant">
        {isHebrew
          ? "תאריך ושעה מוחלטים שדורסים את ברירת המחדל ואת דריסת היום, רק עבור ניחוש התוצאה (1/X/2) של המשחק הזה. השאר ריק כדי להשתמש בברירת המחדל."
          : "Absolute datetime that overrides the type default and matchday override, only for the 1/X/2 prediction on this match. Leave blank for the default."}
      </p>
      {upcoming.length === 0 ? (
        <p className="text-sm text-on-surface-variant italic">
          {isHebrew ? "אין משחקים שטרם נגמרו." : "No upcoming matches."}
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-outline-variant border border-outline-variant rounded-lg">
            {visible.map((m) => (
              <MatchRowEditor
                key={m.id}
                locale={locale}
                isHebrew={isHebrew}
                row={m}
              />
            ))}
          </ul>
          {upcoming.length > 5 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="self-start text-sm text-primary hover:underline"
            >
              {expanded
                ? isHebrew
                  ? `הסתר (${upcoming.length - 5} נוספים)`
                  : `Collapse (${upcoming.length - 5} more)`
                : isHebrew
                  ? `הצג את כל ${upcoming.length} המשחקים`
                  : `Show all ${upcoming.length} matches`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function MatchRowEditor({
  locale,
  isHebrew,
  row,
}: {
  locale: Locale;
  isHebrew: boolean;
  row: MatchRow;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(
    isoToLocalInputValue(row.lockAtOverride),
  );
  const { pending, run } = usePendingAction();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSave() {
    setError(null);
    setSaved(false);
    void run(async () => {
      const iso = value ? localInputValueToIso(value) : null;
      const res = await saveMatchLockOverride(row.id, iso);
      if (!res.ok) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }
  function onClear() {
    setValue("");
    setError(null);
    setSaved(false);
    void run(async () => {
      const res = await saveMatchLockOverride(row.id, null);
      if (!res.ok) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  const kickoffLabel = formatDateTime(row.kickoffAt, locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li className="px-3 py-3 md:px-4 md:py-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[180px]">
        <p className="font-bold text-sm text-on-surface tabular-nums">
          {row.homeTeam} - {row.awayTeam}
        </p>
        <p className="text-[11px] text-on-surface-variant">
          {kickoffLabel} · {row.stage}
        </p>
      </div>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
          setSaved(false);
        }}
        className="h-12 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-sm font-bold focus:outline-none focus:border-primary"
        dir="ltr"
        aria-label={isHebrew ? "מועד נעילה מוחלט" : "Absolute lock time"}
      />
      <div className="flex gap-1.5">
        <PillButton
          variant="ghost"
          type="button"
          disabled={pending || value === ""}
          onClick={onClear}
          className="px-3 py-2"
        >
          {isHebrew ? "נקה" : "Clear"}
        </PillButton>
        <PillButton
          type="button"
          disabled={pending}
          onClick={onSave}
          className="px-4 py-2"
        >
          {pending ? (isHebrew ? "שומר..." : "Saving...") : isHebrew ? "שמור" : "Save"}
        </PillButton>
      </div>
      <div className="basis-full">
        {error && (
          <p className="inline-flex items-center gap-1.5 text-xs text-error">
            <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
            {translateError(error, isHebrew)}
          </p>
        )}
        {saved && !error && (
          <p className="inline-flex items-center gap-1.5 text-xs text-secondary">
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            {isHebrew ? "נשמר" : "Saved"}
          </p>
        )}
      </div>
    </li>
  );
}

function translateError(code: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    invalid: [
      "ערך לא תקין. מספר שלם בין 0 ל-20160 (14 ימים).",
      "Invalid value. Whole number between 0 and 20160 (14 days).",
    ],
    unauth: ["יש להתחבר", "Sign in required"],
    forbidden: ["אין הרשאות אדמין", "Admin role required"],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return (map[code] ?? map.db)[isHebrew ? 0 : 1];
}
