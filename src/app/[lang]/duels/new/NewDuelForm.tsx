"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import type { Locale } from "../../dictionaries";
import { openDuel } from "../actions";

type FixtureOption = {
  id: string;
  label: string;
  kickoffAt: string;
};

type MatchdayOption = {
  date: string;
  label: string;
  fixtureCount: number;
};

type Scope = "match" | "day" | "tournament";

// Subset of AutoApiFootballStat exposed in the duel UI. Excludes
// `possession` and `pass_accuracy` because the combined sum across
// both teams isn't meaningful - same exclusion already lives in
// api-football.ts' combineStats. Labels mirror the player-facing copy.
type AutoStat =
  | "corners"
  | "yellow_cards"
  | "red_cards"
  | "shots"
  | "shots_on_goal"
  | "shots_inside_box"
  | "shots_outside_box"
  | "fouls"
  | "offsides"
  | "saves"
  | "total_passes";

type Comparator = "<" | "<=" | "=" | ">=" | ">";

const STAT_LABELS: Record<AutoStat, { he: string; en: string }> = {
  corners:           { he: "קרנות", en: "Corners" },
  yellow_cards:      { he: "כרטיסים צהובים", en: "Yellow cards" },
  red_cards:         { he: "כרטיסים אדומים", en: "Red cards" },
  shots:             { he: "בעיטות סה״כ", en: "Total shots" },
  shots_on_goal:     { he: "בעיטות למסגרת", en: "Shots on goal" },
  shots_inside_box:  { he: "בעיטות מתוך הרחבה", en: "Shots inside box" },
  shots_outside_box: { he: "בעיטות מחוץ לרחבה", en: "Shots outside box" },
  fouls:             { he: "עבירות", en: "Fouls" },
  offsides:          { he: "נבדלים", en: "Offsides" },
  saves:             { he: "הצלות שוערים", en: "Goalkeeper saves" },
  total_passes:      { he: "מסירות סה״כ", en: "Total passes" },
};

export function NewDuelForm({
  locale,
  balance,
  duelMaxStake,
  defaultJoinWindow,
  upcomingMatches,
  upcomingMatchdays,
}: {
  locale: Locale;
  balance: number;
  duelMaxStake: number;
  defaultJoinWindow: number;
  upcomingMatches: FixtureOption[];
  upcomingMatchdays: MatchdayOption[];
}) {
  const router = useRouter();
  const isHebrew = locale === "he";

  // Honest stake cap: never offer more than the user actually has.
  const maxStake = Math.max(1, Math.min(duelMaxStake, balance));

  const [scope, setScope] = useState<Scope>("match");
  const [matchId, setMatchId] = useState<string | "">("");
  const [matchdayDate, setMatchdayDate] = useState<string | "">("");
  const [openerAnswer, setOpenerAnswer] = useState<boolean>(true);
  const [stake, setStake] = useState<number>(Math.min(3, maxStake));
  const [questionHe, setQuestionHe] = useState("");
  const [questionEn, setQuestionEn] = useState("");
  const [ruleHe, setRuleHe] = useState("");
  const [ruleEn, setRuleEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Optional auto-settle config (only when scope='match'). When the
  // toggle is on, the duel grades automatically from API-Football
  // stats after the fixture ends. Off by default - most duels are
  // narrative questions that need a human read.
  const [autoGradeOn, setAutoGradeOn] = useState(false);
  const [autoGradeStat, setAutoGradeStat] = useState<AutoStat>("corners");
  const [autoGradeComparator, setAutoGradeComparator] =
    useState<Comparator>(">");
  const [autoGradeThreshold, setAutoGradeThreshold] = useState<number>(2);

  const dict = {
    title: isHebrew ? "דו-קרב חדש" : "New duel",
    scopeQ: isHebrew ? "על מה הדו-קרב?" : "What does this duel hinge on?",
    scopeMatch: isHebrew ? "משחק" : "Match",
    scopeDay: isHebrew ? "יום משחקים" : "Match day",
    scopeTournament: isHebrew ? "טורניר" : "Tournament",
    matchPicker: isHebrew ? "בחר משחק" : "Pick a match",
    matchdayDate: isHebrew ? "בחר תאריך יום משחקים" : "Pick a match-day date",
    answerQ: isHebrew ? "התשובה שלך" : "Your answer",
    yes: isHebrew ? "כן" : "Yes",
    no: isHebrew ? "לא" : "No",
    stakeQ: isHebrew
      ? `סטייק (עד ${maxStake})`
      : `Stake (up to ${maxStake})`,
    questionHe: isHebrew ? "השאלה (עברית)" : "Question (Hebrew)",
    questionEn: isHebrew ? "השאלה (אנגלית)" : "Question (English)",
    ruleHe: isHebrew ? "כלל הכרעה (עברית)" : "Grading rule (Hebrew)",
    ruleEn: isHebrew ? "כלל הכרעה (אנגלית)" : "Grading rule (English)",
    questionHint: isHebrew
      ? "משפט אחד שגם משתמש אחר יבין בלי לקרוא תקנון."
      : "One sentence another player can read without consulting a rulebook.",
    ruleHint: isHebrew
      ? "מה בדיוק ייספר? משפט שאי אפשר לפרש לרעה."
      : "Exactly what counts? Phrase it so it can't be argued.",
    submit: isHebrew ? "פתח דו-קרב" : "Open duel",
    submitPending: isHebrew ? "פותח..." : "Opening...",
    deadlineHint: isHebrew
      ? `הדדליין להצטרפות נקבע ל-${defaultJoinWindow} שעות (או דקות לפני המשחק - המוקדם מבניהם).`
      : `Join deadline defaults to ${defaultJoinWindow}h from now or the kickoff - whichever is earlier.`,
    bankWarning: isHebrew
      ? `הסטייק יינעל בבנק עד שהדו-קרב יוכרע או יבוטל. יתרה נוכחית: ${balance}.`
      : `Your stake is locked in the bank until the duel resolves or cancels. Current balance: ${balance}.`,
  };

  const valid =
    questionHe.trim().length >= 1 &&
    questionEn.trim().length >= 1 &&
    ruleHe.trim().length >= 3 &&
    ruleEn.trim().length >= 3 &&
    stake >= 1 &&
    stake <= maxStake &&
    (scope !== "match" || matchId !== "") &&
    (scope !== "day" || matchdayDate !== "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!valid) {
      setError("invalid_input");
      return;
    }
    startTransition(async () => {
      const res = await openDuel({
        scope,
        matchId: scope === "match" ? matchId : null,
        matchdayDate: scope === "day" ? matchdayDate : null,
        openerAnswer,
        stake,
        questionHe,
        questionEn,
        gradingRuleHe: ruleHe,
        gradingRuleEn: ruleEn,
        autoGrade:
          scope === "match" && autoGradeOn
            ? {
                stat: autoGradeStat,
                comparator: autoGradeComparator,
                threshold: autoGradeThreshold,
              }
            : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(window.location.pathname.replace(/\/new$/, `/${res.id}`));
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <SectionHeading underline="thin" as="h2">
          {dict.scopeQ}
        </SectionHeading>
        <div className="grid grid-cols-3 gap-2">
          {(["match", "day", "tournament"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={clsx(
                "press-down min-h-[48px] rounded-lg border text-sm font-bold",
                scope === s
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface-container-lowest text-on-surface border-outline",
              )}
            >
              {s === "match"
                ? dict.scopeMatch
                : s === "day"
                  ? dict.scopeDay
                  : dict.scopeTournament}
            </button>
          ))}
        </div>

        {scope === "match" && (
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {dict.matchPicker}
            <select
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-sm"
              dir="ltr"
            >
              <option value="">-</option>
              {upcomingMatches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {scope === "day" && (
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {dict.matchdayDate}
            <select
              value={matchdayDate}
              onChange={(e) => setMatchdayDate(e.target.value)}
              className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-sm"
              dir="ltr"
            >
              <option value="">-</option>
              {upcomingMatchdays.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.label} · {d.fixtureCount}
                </option>
              ))}
            </select>
          </label>
        )}
      </Card>

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <SectionHeading underline="thin" as="h2">
          {dict.title}
        </SectionHeading>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {dict.questionHe}
            <input
              type="text"
              value={questionHe}
              onChange={(e) => setQuestionHe(e.target.value)}
              maxLength={200}
              className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-base"
              dir="rtl"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {dict.questionEn}
            <input
              type="text"
              value={questionEn}
              onChange={(e) => setQuestionEn(e.target.value)}
              maxLength={200}
              className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-base"
              dir="ltr"
            />
          </label>
        </div>
        <p className="text-xs text-on-surface-variant -mt-2">
          {dict.questionHint}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {dict.ruleHe}
            <textarea
              value={ruleHe}
              onChange={(e) => setRuleHe(e.target.value)}
              maxLength={400}
              rows={3}
              className="px-3 py-2 rounded-lg border border-outline bg-surface-container-lowest text-base"
              dir="rtl"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {dict.ruleEn}
            <textarea
              value={ruleEn}
              onChange={(e) => setRuleEn(e.target.value)}
              maxLength={400}
              rows={3}
              className="px-3 py-2 rounded-lg border border-outline bg-surface-container-lowest text-base"
              dir="ltr"
            />
          </label>
        </div>
        <p className="text-xs text-on-surface-variant -mt-2">
          {dict.ruleHint}
        </p>
      </Card>

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <SectionHeading underline="thin" as="h2">
            {dict.answerQ}
          </SectionHeading>
          <div className="grid grid-cols-2 gap-2">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setOpenerAnswer(v)}
                className={clsx(
                  "press-down min-h-[48px] rounded-lg border text-base font-bold",
                  openerAnswer === v
                    ? "bg-primary text-on-primary border-primary"
                    : "bg-surface-container-lowest text-on-surface border-outline",
                )}
              >
                {v ? dict.yes : dict.no}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <SectionHeading underline="thin" as="h2">
            {dict.stakeQ}
          </SectionHeading>
          <input
            type="number"
            min={1}
            max={maxStake}
            step={1}
            value={stake}
            onChange={(e) =>
              setStake(
                Math.max(1, Math.min(maxStake, Math.trunc(Number(e.target.value) || 0))),
              )
            }
            className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-base font-bold tabular-nums"
            dir="ltr"
          />
          <p className="text-xs text-on-surface-variant">
            {dict.bankWarning}
          </p>
          <p className="text-xs text-on-surface-variant">
            {dict.deadlineHint}
          </p>
        </div>
      </Card>

      {scope === "match" && (
        <Card className="p-5 md:p-6 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <SectionHeading underline="thin" as="h2">
                {isHebrew
                  ? "הכרעה אוטומטית מסטטיסטיקות"
                  : "Auto-settle from match stats"}
              </SectionHeading>
              <p className="text-xs text-on-surface-variant">
                {isHebrew
                  ? "במקום שאדמין יכריע ידנית, הדו-קרב יוכרע אוטומטית מהסטטיסטיקות של API-Football אחרי שהמשחק יסתיים. רק לדו-קרב על משחק יחיד."
                  : "Instead of an admin settling manually, the duel resolves automatically from the fixture's API-Football stats once the match ends. Match-scope only."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoGradeOn}
              onClick={() => setAutoGradeOn((v) => !v)}
              className={clsx(
                "shrink-0 min-h-[44px] px-4 inline-flex items-center gap-2 rounded-lg border text-sm font-bold",
                autoGradeOn
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface-container-lowest text-on-surface border-outline",
              )}
            >
              {autoGradeOn
                ? isHebrew ? "פעיל" : "On"
                : isHebrew ? "כבוי" : "Off"}
            </button>
          </div>

          {autoGradeOn && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1.5 text-xs font-bold text-on-surface">
                {isHebrew ? "סטטיסטיקה" : "Stat"}
                <select
                  value={autoGradeStat}
                  onChange={(e) => setAutoGradeStat(e.target.value as AutoStat)}
                  className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-sm"
                  dir="ltr"
                >
                  {(Object.keys(STAT_LABELS) as AutoStat[]).map((s) => (
                    <option key={s} value={s}>
                      {isHebrew ? STAT_LABELS[s].he : STAT_LABELS[s].en}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-bold text-on-surface">
                {isHebrew ? "השוואה" : "Comparator"}
                <select
                  value={autoGradeComparator}
                  onChange={(e) =>
                    setAutoGradeComparator(e.target.value as Comparator)
                  }
                  className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-sm tabular-nums"
                  dir="ltr"
                >
                  <option value=">">&gt;</option>
                  <option value=">=">&ge;</option>
                  <option value="=">=</option>
                  <option value="<=">&le;</option>
                  <option value="<">&lt;</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-bold text-on-surface">
                {isHebrew ? "סף" : "Threshold"}
                <input
                  type="number"
                  min={0}
                  max={500}
                  step={1}
                  value={autoGradeThreshold}
                  onChange={(e) =>
                    setAutoGradeThreshold(
                      Math.max(
                        0,
                        Math.min(500, Math.trunc(Number(e.target.value) || 0)),
                      ),
                    )
                  }
                  className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-base tabular-nums"
                  dir="ltr"
                />
              </label>
              <p className="sm:col-span-3 text-xs text-on-surface-variant">
                {isHebrew
                  ? "כן יזכה אם הערך של הסטטיסטיקה (סכום שני הצדדים) מקיים את ההשוואה."
                  : "Yes wins if the combined stat across both teams satisfies the comparator."}
              </p>
            </div>
          )}
        </Card>
      )}

      {error && (
        <p className="inline-flex items-center gap-1.5 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {translateError(error, isHebrew)}
        </p>
      )}

      <PillButton
        type="submit"
        disabled={pending || !valid}
        className={clsx(
          "self-end px-10 py-3 min-h-[48px]",
          (pending || !valid) && "opacity-60 cursor-not-allowed",
        )}
      >
        {pending ? dict.submitPending : dict.submit}
      </PillButton>
    </form>
  );
}

function translateError(code: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    unauth: ["יש להתחבר", "Sign in required"],
    not_paid: [
      "התשלום שלך עדיין לא אושר",
      "Your entry payment is not approved yet",
    ],
    invalid_input: [
      "חסרים פרטים. ודא שכל השדות מלאים והכלל הוא לפחות 3 תווים.",
      "Missing fields. Make sure every field is filled and the rule is 3+ characters.",
    ],
    stake_too_high: [
      "הסטייק חורג מהמקסימום שהוגדר באדמין.",
      "Stake exceeds the admin-configured max.",
    ],
    stake_too_low: ["הסטייק חייב להיות לפחות 1.", "Stake must be at least 1."],
    insufficient_funds: [
      "אין מספיק נקודות בבנק.",
      "Not enough points in your bank.",
    ],
    rate_limited: [
      "פתחת יותר מדי דו-קרבים בעת האחרונה. נסה שוב מאוחר יותר.",
      "You've opened too many duels recently. Try again later.",
    ],
    match_not_found: ["המשחק לא נמצא.", "Match not found."],
    match_locked: ["המשחק כבר נעול.", "Match is locked."],
    matchday_empty: [
      "אין משחקים מתוזמנים בתאריך הזה.",
      "No scheduled matches on this date.",
    ],
    deadline_past: [
      "תאריך ההכרעה כבר עבר.",
      "Resolution date already passed.",
    ],
    db: ["שגיאת שמירה", "Save failed"],
  };
  return (map[code] ?? map.db)[isHebrew ? 0 : 1];
}
