"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { BET_TYPE_KEYS, type BetTypeKey } from "@/db/schema";
import {
  saveMatchLockOverride,
  saveMatchdayOverride,
  saveReminderOffset,
  saveTournamentStart,
  saveTypeDefaults,
} from "./actions";
import type { Locale } from "../../dictionaries";

// Hebrew + English labels and helper text per bet type. The catalog is
// derived from BET_TYPE_KEYS (the schema-level source of truth) so a
// new bet type forces a compile-time entry here.
const TYPE_LABELS: Record<BetTypeKey, { he: string; en: string; hintHe: string; hintEn: string; anchorHe: string; anchorEn: string }> = {
  match_score: {
    he: "ניחוש תוצאה (1/X/2)",
    en: "Score prediction (1/X/2)",
    hintHe: "כמה דקות לפני בעיטת הפתיחה של המשחק נסגר ניחוש התוצאה.",
    hintEn: "How many minutes before kickoff the 1/X/2 prediction closes.",
    anchorHe: "בעיטת הפתיחה של המשחק",
    anchorEn: "match kickoff",
  },
  custom_match: {
    he: "הימור מותאם — משחק בודד",
    en: "Custom bet — single match",
    hintHe: "הימור שמצמיד למשחק אחד (למשל 'מי יבקיע ראשון').",
    hintEn: "A custom bet attached to one match (e.g. 'who scores first').",
    anchorHe: "בעיטת הפתיחה של אותו משחק",
    anchorEn: "kickoff of that match",
  },
  custom_day: {
    he: "הימור מותאם — יום הימורים",
    en: "Custom bet — matchday",
    hintHe: "הימור שמצרף את כל משחקי היום (למשל 'כמה גולים סך הכל היום').",
    hintEn: "Custom bet that aggregates across all matches on a date.",
    anchorHe: "המשחק הראשון של היום",
    anchorEn: "earliest kickoff of the day",
  },
  custom_stage: {
    he: "הימור מותאם — שלב בטורניר",
    en: "Custom bet — tournament stage",
    hintHe: "הימור שמצורף לשלב שלם (שלב הבתים / שמינית / רבע וכו').",
    hintEn: "Custom bet attached to a tournament stage (group/r16/qf/...).",
    anchorHe: "המשחק הראשון של אותו שלב",
    anchorEn: "earliest kickoff in that stage",
  },
  custom_group: {
    he: "הימור מותאם — בית בטורניר",
    en: "Custom bet — group",
    hintHe: "הימור שמצורף לבית שלם בשלב הבתים.",
    hintEn: "Custom bet attached to a single group letter (A..L).",
    anchorHe: "המשחק הראשון של הבית",
    anchorEn: "earliest kickoff in that group",
  },
  custom_tournament: {
    he: "הימור מותאם — כל הטורניר",
    en: "Custom bet — whole tournament",
    hintHe: "הימורים ארוכי טווח כמו 'מי יזכה בטורניר'.",
    hintEn: "Long-range bets like 'who wins the tournament'.",
    anchorHe: "תאריך תחילת הטורניר",
    anchorEn: "tournament start date",
  },
};

type MatchdayRow = {
  id: string;
  date: string;
  label: string | null;
  lockOffsetOverrideMinutes: number | null;
  earliestKickoffAt: string | null;
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
  initialTournamentStartAt: string | null;
  derivedTournamentStartAt: string | null;
  initialReminderOffsetMinutes: number;
  matchdays: MatchdayRow[];
  matches: MatchRow[];
};

export function DeadlinesForm({
  locale,
  initialDefaults,
  initialTournamentStartAt,
  derivedTournamentStartAt,
  initialReminderOffsetMinutes,
  matchdays,
  matches,
}: Props) {
  const isHebrew = locale === "he";
  return (
    <div className="flex flex-col gap-6">
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
      <MatchdayOverridesCard
        locale={locale}
        isHebrew={isHebrew}
        matchdays={matchdays}
        typeDefaults={initialDefaults}
      />
      <MatchOverridesCard
        locale={locale}
        isHebrew={isHebrew}
        matches={matches}
      />
    </div>
  );
}

// Convert a UTC ISO string to the "YYYY-MM-DDTHH:mm" string that the
// <input type="datetime-local"> widget consumes, in Asia/Jerusalem time
// so the admin sees the IL clock. The widget then echoes a local string
// back which we convert back to UTC via Date constructor at save time.
function isoToLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // Intl gives us parts in the target tz. We rebuild "YYYY-MM-DDTHH:mm".
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// Re-interpret a "YYYY-MM-DDTHH:mm" string from the widget as
// Asia/Jerusalem wall time and return its UTC ISO. We construct a UTC
// date with the same wall components and then offset by IL's offset at
// that moment so DST transitions stay correct.
function localInputValueToIso(value: string): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, da, h, mi] = m;
  // Build a UTC date with the wall-clock components, then ask Intl
  // what UTC instant that wall-clock corresponds to in IL by
  // round-tripping through formatToParts.
  const utcGuess = Date.UTC(+y, +mo - 1, +da, +h, +mi);
  // The offset of Asia/Jerusalem at this instant (in minutes east of UTC).
  const tzMinutes = ilOffsetMinutesAt(utcGuess);
  return new Date(utcGuess - tzMinutes * 60_000).toISOString();
}

function ilOffsetMinutesAt(utcMs: number): number {
  // Format the UTC instant as IL wall-clock, parse it back as if it
  // were UTC, and the delta is the IL offset. ±60 for DST safety
  // automatic because the formatter knows the TZDB rules.
  const d = new Date(utcMs);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  const wallUtcMs = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
  );
  return Math.round((wallUtcMs - utcMs) / 60_000);
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
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
    startTransition(async () => {
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
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
          ? "תזכורת אחת תישלח לכל שחקן שעוד יכול להמר, X דקות לפני שההימור נסגר. 0 = ללא תזכורות. הימורי תוצאה (1/X/2) ודואלים לא נכללים — רק הימורים מותאמים."
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

function TypeDefaultsCard({
  isHebrew,
  initial,
}: {
  isHebrew: boolean;
  initial: Record<BetTypeKey, number>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<BetTypeKey, number>>({ ...initial });
  const [pending, startTransition] = useTransition();
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
    startTransition(async () => {
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
      <div className="grid grid-cols-1 gap-4">
        {BET_TYPE_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <label
              htmlFor={`bld-${key}`}
              className="font-bold text-sm text-on-surface"
            >
              {isHebrew ? TYPE_LABELS[key].he : TYPE_LABELS[key].en}
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`bld-${key}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={20160}
                step={1}
                value={values[key]}
                onChange={(e) => update(key, e.target.value)}
                className="h-12 w-28 px-3 bg-surface-container-lowest border border-outline rounded-lg text-on-surface text-base font-bold tabular-nums focus:outline-none focus:border-primary"
                dir="ltr"
              />
              <span className="text-sm text-on-surface-variant">
                {isHebrew
                  ? `דקות לפני ${TYPE_LABELS[key].anchorHe}`
                  : `minutes before ${TYPE_LABELS[key].anchorEn}`}
              </span>
            </div>
            <p className="text-[11px] text-on-surface-variant">
              {isHebrew ? TYPE_LABELS[key].hintHe : TYPE_LABELS[key].hintEn}
            </p>
          </div>
        ))}
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

function MatchdayOverridesCard({
  locale,
  isHebrew,
  matchdays,
  typeDefaults,
}: {
  locale: Locale;
  isHebrew: boolean;
  matchdays: MatchdayRow[];
  typeDefaults: Record<BetTypeKey, number>;
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
          ? "ערך כאן דורס את ברירת המחדל של 'ניחוש תוצאה' ו-'הימור מותאם — משחק/יום' עבור היום הזה בלבד. ריק = נופל חזרה לברירת המחדל לסוג."
          : "A value here overrides the per-type default for score, custom-match and custom-day bets on this date only. Empty = falls back to the type default."}
      </p>
      {sorted.length === 0 ? (
        <p className="text-sm text-on-surface-variant italic">
          {isHebrew
            ? "אין עדיין ימי הימורים — נוצרים אוטומטית כשפותחים הימור על תאריך."
            : "No matchdays yet — they're created automatically the first time a bet opens for a date."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-outline-variant border border-outline-variant rounded-lg">
          {sorted.map((m) => (
            <MatchdayRowEditor
              key={m.id}
              locale={locale}
              isHebrew={isHebrew}
              row={m}
              dayDefault={typeDefaults.custom_day}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function MatchdayRowEditor({
  locale,
  isHebrew,
  row,
  dayDefault,
}: {
  locale: Locale;
  isHebrew: boolean;
  row: MatchdayRow;
  dayDefault: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(
    row.lockOffsetOverrideMinutes != null ? String(row.lockOffsetOverrideMinutes) : "",
  );
  const [pending, startTransition] = useTransition();
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
    startTransition(async () => {
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
    : "—";

  return (
    <li className="px-3 py-3 md:px-4 md:py-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[200px]">
        <p className="font-bold text-sm text-on-surface">{dateLabel}</p>
        <p className="text-[11px] text-on-surface-variant">
          {isHebrew
            ? `המשחק הראשון של היום: ${earliestLabel}`
            : `Earliest kickoff: ${earliestLabel}`}
        </p>
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
          placeholder={String(dayDefault)}
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
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
    startTransition(async () => {
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
          {row.homeTeam} — {row.awayTeam}
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
