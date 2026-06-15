"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import { PickScenarios } from "@/components/PickScenarios";
import { AutoTranslateHint } from "@/components/AutoTranslateHint";
import { useAutoTranslate } from "@/lib/use-auto-translate";
import {
  formatMultiplier,
  grossPayoutOnWin,
  MULTIPLIER_MAX_PCT,
  MULTIPLIER_MIN_PCT,
  OPTION_MAX_COUNT,
  OPTION_MIN_COUNT,
  type DuelOption,
} from "@/lib/duels/options";
import {
  applyTemplate,
  DUEL_QUICK_TEMPLATES,
  defaultTemplateOptions,
} from "@/lib/duels/quick-templates";
import { localePath } from "@/lib/paths";
import type { Dictionary, Locale } from "../../dictionaries";
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
  shots:             { he: "בעיטות סה\"כ", en: "Total shots" },
  shots_on_goal:     { he: "בעיטות למסגרת", en: "Shots on goal" },
  shots_inside_box:  { he: "בעיטות מתוך הרחבה", en: "Shots inside box" },
  shots_outside_box: { he: "בעיטות מחוץ לרחבה", en: "Shots outside box" },
  fouls:             { he: "עבירות", en: "Fouls" },
  offsides:          { he: "נבדלים", en: "Offsides" },
  saves:             { he: "הצלות שוערים", en: "Goalkeeper saves" },
  total_passes:      { he: "מסירות סה\"כ", en: "Total passes" },
};

export function NewDuelForm({
  locale,
  dict,
  balance,
  maxOverdraft,
  lockedFromBetting,
  duelMaxStake,
  defaultJoinWindow,
  upcomingMatches,
  upcomingMatchdays,
}: {
  locale: Locale;
  dict: Dictionary;
  balance: number;
  maxOverdraft: number;
  lockedFromBetting: boolean;
  duelMaxStake: number;
  defaultJoinWindow: number;
  upcomingMatches: FixtureOption[];
  upcomingMatchdays: MatchdayOption[];
}) {
  const router = useRouter();
  const isHebrew = locale === "he";

  // Honest stake cap: never offer more than the user could legally place.
  // A bet may push the bank to at most -maxOverdraft, so spending power
  // is `balance + maxOverdraft` (clamped by the admin's duelMaxStake).
  const spendingPower = balance + maxOverdraft;
  const maxStake = Math.max(1, Math.min(duelMaxStake, spendingPower));

  const [scope, setScope] = useState<Scope>("match");
  const [matchId, setMatchId] = useState<string | "">("");
  const [matchdayDate, setMatchdayDate] = useState<string | "">("");
  // Answer mode: 'simple' keeps the legacy yes/no UI (sends openerAnswer
  // boolean to openDuel). 'advanced' reveals the options editor and
  // sends `options + openerOption`. Quick-template chips force advanced
  // mode because they always emit a custom-option payload.
  const [answerMode, setAnswerMode] = useState<"simple" | "advanced">("simple");
  const [openerAnswer, setOpenerAnswer] = useState<boolean>(true);
  const [options, setOptions] = useState<DuelOption[]>(() => defaultTemplateOptions());
  const [openerOptionKey, setOpenerOptionKey] = useState<string>(options[0]?.key ?? "yes");
  const [stake, setStake] = useState<number>(Math.min(3, maxStake));
  const [questionHe, setQuestionHe] = useState("");
  const [questionEn, setQuestionEn] = useState("");
  const [ruleHe, setRuleHe] = useState("");
  const [ruleEn, setRuleEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Auto-translate: type Hebrew, English fills in on blur. Skips the
  // call if the English field already has text. See
  // _plans/2026-06-12-house-edge-duel-options-translation.md part 3.
  const questionTranslate = useAutoTranslate({
    context: "question",
    isEnglishEmpty: () => questionEn.trim().length === 0,
    onTranslate: setQuestionEn,
  });
  const ruleTranslate = useAutoTranslate({
    context: "rule",
    isEnglishEmpty: () => ruleEn.trim().length === 0,
    onTranslate: setRuleEn,
  });

  // Optional auto-settle config (only when scope='match'). When the
  // toggle is on, the duel grades automatically from API-Football
  // stats after the fixture ends. Off by default - most duels are
  // narrative questions that need a human read.
  const [autoGradeOn, setAutoGradeOn] = useState(false);
  const [autoGradeStat, setAutoGradeStat] = useState<AutoStat>("corners");
  const [autoGradeComparator, setAutoGradeComparator] =
    useState<Comparator>(">");
  const [autoGradeThreshold, setAutoGradeThreshold] = useState<number>(2);

  const labels = {
    title: isHebrew ? "דו-קרב חדש" : "New duel",
    scopeQ: isHebrew ? "על מה הדו-קרב?" : "What does this duel hinge on?",
    scopeMatch: isHebrew ? "משחק" : "Match",
    scopeDay: isHebrew ? "יום משחקים" : "Match day",
    scopeTournament: isHebrew ? "טורניר" : "Tournament",
    matchPicker: isHebrew ? "בחר משחק" : "Pick a match",
    // Duels run through the semi-finals only. The picker already drops
    // final / third-place fixtures (see loadUpcomingFixtures); this line
    // explains the absence so a player near the end of the tournament
    // isn't left wondering why the final isn't listed.
    matchPickerHint: isHebrew
      ? "דו-קרבים על משחק זמינים עד חצי הגמר. הגמר והמשחק על המקום השלישי לא ניתנים לבחירה."
      : "Match duels run through the semi-finals. The final and third-place playoff aren't selectable.",
    matchdayDate: isHebrew ? "בחר תאריך יום משחקים" : "Pick a match-day date",
    answerQ: isHebrew ? "התשובה שלך" : "Your answer",
    yes: isHebrew ? "כן" : "Yes",
    no: isHebrew ? "לא" : "No",
    stakeQ: isHebrew
      ? `השקעה (עד ${maxStake})`
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
    // Per-scope deadline copy. The actions.openDuel handler picks the
    // earlier of "duelDefaultJoinWindowHours from now" and "60 minutes
    // before the resolve anchor". For match scope the anchor is the
    // kickoff; for day scope it's the earliest kickoff of that
    // matchday; tournament scope has no near anchor, so the window-
    // from-now is effectively the only cutoff. The old single line
    // ("X שעות או דקות לפני המשחק") was both ambiguous (no minute
    // count) and wrong on the two non-match scopes - the QA agent
    // flagged it 2026-06-06 on the tournament case.
    deadlineHintMatch: isHebrew
      ? `הדדליין להצטרפות נקבע ל-${defaultJoinWindow} שעות מעכשיו או שעה לפני פתיחת המשחק - המוקדם מביניהם.`
      : `Join deadline defaults to ${defaultJoinWindow}h from now or 1h before kickoff - whichever is earlier.`,
    deadlineHintDay: isHebrew
      ? `הדדליין להצטרפות נקבע ל-${defaultJoinWindow} שעות מעכשיו או שעה לפני המשחק הראשון של היום - המוקדם מביניהם.`
      : `Join deadline defaults to ${defaultJoinWindow}h from now or 1h before the day's first kickoff - whichever is earlier.`,
    deadlineHintTournament: isHebrew
      ? `הדדליין להצטרפות נקבע ל-${defaultJoinWindow} שעות מעכשיו.`
      : `Join deadline defaults to ${defaultJoinWindow}h from now.`,
    bankWarning: isHebrew
      ? `ההשקעה תינעל בבנק עד שהדו-קרב יוכרע או יבוטל. יתרה נוכחית: ${balance}.`
      : `Your stake is locked in the bank until the duel resolves or cancels. Current balance: ${balance}.`,
  };

  const optionsValid =
    answerMode === "simple"
      ? true
      : options.length >= OPTION_MIN_COUNT &&
        options.length <= OPTION_MAX_COUNT &&
        options.every(
          (o) =>
            o.labelHe.trim().length > 0 &&
            o.labelEn.trim().length > 0 &&
            o.multiplierPct >= MULTIPLIER_MIN_PCT &&
            o.multiplierPct <= MULTIPLIER_MAX_PCT,
        ) &&
        new Set(options.map((o) => o.key)).size === options.length &&
        options.some((o) => o.key === openerOptionKey);

  const valid =
    questionHe.trim().length >= 1 &&
    questionEn.trim().length >= 1 &&
    ruleHe.trim().length >= 3 &&
    ruleEn.trim().length >= 3 &&
    stake >= 1 &&
    stake <= maxStake &&
    (scope !== "match" || matchId !== "") &&
    (scope !== "day" || matchdayDate !== "") &&
    optionsValid;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!valid) {
      setError("invalid_input");
      return;
    }
    startTransition(async () => {
      const isAdvanced = answerMode === "advanced";
      const res = await openDuel({
        scope,
        matchId: scope === "match" ? matchId : null,
        matchdayDate: scope === "day" ? matchdayDate : null,
        // Legacy yes/no payload (mode='simple') OR new-style options
        // payload (mode='advanced'). Exactly one branch must be set;
        // openDuel rejects mixed shapes with invalid_input.
        openerAnswer: isAdvanced ? null : openerAnswer,
        options: isAdvanced ? options : null,
        openerOption: isAdvanced ? openerOptionKey : null,
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

  if (lockedFromBetting) {
    return (
      <Card className="p-5 md:p-6 flex flex-col gap-3 bg-error-container text-on-error-container border border-error">
        <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold">
          {isHebrew ? "נעילה זמנית: יתרה שלילית" : "Locked: negative balance"}
        </h2>
        <p className="text-sm">
          {isHebrew
            ? `יתרת הבנק שלך ${balance} נקודות. פתיחת והצטרפות לדו-קרבים תיפתח שוב ברגע שהיתרה תחזור ל-0 או מעלה.`
            : `Your bank stands at ${balance} points. Opening or joining duels reopens once you climb back to 0 or above.`}
        </p>
        <p className="text-sm">
          {isHebrew
            ? "ניחושי משחקים, הימורי טורניר ודירוגי בתים פתוחים כרגיל — הם דרך ההתאוששות שלך."
            : "Match picks, tournament bets and group rankings stay open — they're your way back to positive."}
        </p>
        <Link
          href={localePath(locale, "bets")}
          className="press-down self-start mt-1 inline-flex items-center justify-center min-h-[48px] px-5 py-2 rounded-full bg-primary text-on-primary font-bold text-sm"
        >
          {isHebrew ? "להימורים החינמיים" : "Go to free picks"}
        </Link>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <SectionHeading underline="thin" as="h2">
          {labels.scopeQ}
        </SectionHeading>
        <div className="grid grid-cols-3 gap-2">
          {(["match", "day", "tournament"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              aria-pressed={scope === s}
              className={clsx(
                "press-down min-h-[48px] rounded-lg border text-sm font-bold",
                scope === s
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface-container-lowest text-on-surface border-outline",
              )}
            >
              {s === "match"
                ? labels.scopeMatch
                : s === "day"
                  ? labels.scopeDay
                  : labels.scopeTournament}
            </button>
          ))}
        </div>

        {scope === "match" && (
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {labels.matchPicker}
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
            <span className="text-xs font-normal text-on-surface-variant">
              {labels.matchPickerHint}
            </span>
          </label>
        )}

        {scope === "day" && (
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {labels.matchdayDate}
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

      {scope === "match" && (
        <QuickTemplatesCard
          isHebrew={isHebrew}
          onApply={({ questionHe: qHe, questionEn: qEn, ruleHe: rHe, ruleEn: rEn, options: opts, autoGrade }) => {
            setQuestionHe(qHe);
            setQuestionEn(qEn);
            setRuleHe(rHe);
            setRuleEn(rEn);
            setAnswerMode("advanced");
            setOptions(opts);
            // Default the opener to "yes" (the option that satisfies
            // the comparator). The opener can still change it.
            setOpenerOptionKey(opts[0]?.key ?? "yes");
            setAutoGradeOn(true);
            setAutoGradeStat(autoGrade.stat as AutoStat);
            setAutoGradeComparator(autoGrade.comparator);
            setAutoGradeThreshold(autoGrade.threshold);
          }}
        />
      )}

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <SectionHeading underline="thin" as="h2">
          {labels.title}
        </SectionHeading>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {labels.questionHe}
            <input
              type="text"
              value={questionHe}
              onChange={(e) => setQuestionHe(e.target.value)}
              onBlur={() => questionTranslate.trigger(questionHe)}
              maxLength={200}
              className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-base"
              dir="rtl"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {labels.questionEn}
            <input
              type="text"
              value={questionEn}
              onChange={(e) => setQuestionEn(e.target.value)}
              maxLength={200}
              className="h-12 px-3 rounded-lg border border-outline bg-surface-container-lowest text-base"
              dir="ltr"
            />
            <AutoTranslateHint state={questionTranslate.state} isHebrew={isHebrew} />
          </label>
        </div>
        <p className="text-xs text-on-surface-variant -mt-2">
          {labels.questionHint}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {labels.ruleHe}
            <textarea
              value={ruleHe}
              onChange={(e) => setRuleHe(e.target.value)}
              onBlur={() => ruleTranslate.trigger(ruleHe)}
              maxLength={400}
              rows={3}
              className="px-3 py-2 rounded-lg border border-outline bg-surface-container-lowest text-base"
              dir="rtl"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-on-surface">
            {labels.ruleEn}
            <textarea
              value={ruleEn}
              onChange={(e) => setRuleEn(e.target.value)}
              maxLength={400}
              rows={3}
              className="px-3 py-2 rounded-lg border border-outline bg-surface-container-lowest text-base"
              dir="ltr"
            />
            <AutoTranslateHint state={ruleTranslate.state} isHebrew={isHebrew} />
          </label>
        </div>
        <p className="text-xs text-on-surface-variant -mt-2">
          {labels.ruleHint}
        </p>
      </Card>

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        {/* Mode switch: simple = legacy yes/no; advanced = options + ratios.
            Default stays 'simple' so the existing UX is unchanged for the
            opener who just wants a quick yes/no duel. */}
        <div className="flex flex-col gap-2">
          <SectionHeading underline="thin" as="h2">
            {labels.answerQ}
          </SectionHeading>
          <div
            role="tablist"
            aria-label={isHebrew ? "מצב תשובה" : "Answer mode"}
            className="inline-flex self-start rounded-full border border-outline bg-surface-container-lowest p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={answerMode === "simple"}
              onClick={() => setAnswerMode("simple")}
              className={clsx(
                "press-down min-h-[44px] px-4 rounded-full text-sm font-bold",
                answerMode === "simple"
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant",
              )}
            >
              {isHebrew ? "כן / לא" : "Yes / No"}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={answerMode === "advanced"}
              onClick={() => setAnswerMode("advanced")}
              className={clsx(
                "press-down min-h-[44px] px-4 rounded-full text-sm font-bold",
                answerMode === "advanced"
                  ? "bg-primary text-on-primary"
                  : "text-on-surface-variant",
              )}
            >
              {isHebrew ? "אופציות מותאמות" : "Custom options"}
            </button>
          </div>

          {answerMode === "simple" ? (
            <div className="grid grid-cols-2 gap-2 mt-2">
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
                  {v ? labels.yes : labels.no}
                </button>
              ))}
              <p className="col-span-2 text-xs text-on-surface-variant">
                {isHebrew
                  ? `תשלום סימטרי: הזוכה מקבל ${stake * 2} נק'. השני מאבד את ה-${stake}.`
                  : `Symmetric payout: winner takes ${stake * 2} pts. Loser loses ${stake}.`}
              </p>
            </div>
          ) : (
            <OptionsEditor
              options={options}
              setOptions={setOptions}
              openerOptionKey={openerOptionKey}
              setOpenerOptionKey={setOpenerOptionKey}
              stake={stake}
              isHebrew={isHebrew}
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <SectionHeading underline="thin" as="h2">
            {labels.stakeQ}
          </SectionHeading>
          <input
            type="number"
            aria-label={labels.stakeQ}
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
            {labels.bankWarning}
          </p>
          <p className="text-xs text-on-surface-variant">
            {scope === "match"
              ? labels.deadlineHintMatch
              : scope === "day"
                ? labels.deadlineHintDay
                : labels.deadlineHintTournament}
          </p>
        </div>

        {/* Live scenarios — recompute as the stake slider moves so the
            opener can see exactly what their bank will look like under
            both outcomes. Duel payouts are symmetric: winner takes the
            other side's stake (+stake net), loser keeps -stake. The
            "stake" row above the scenarios shows the immediate -stake
            deduction at duel open time. */}
        <PickScenarios
          locale={locale}
          currentBalance={balance}
          stake={stake}
          scenarios={[
            {
              label: isHebrew ? "אם תזכה" : "If you win",
              delta: 2 * stake,
              tone: "positive",
            },
            {
              label: isHebrew ? "אם תפסיד" : "If you lose",
              delta: 0,
              tone: "negative",
            },
            {
              label: isHebrew ? "אם הדו-קרב יבוטל" : "If the duel is cancelled",
              delta: stake,
              tone: "neutral",
            },
          ]}
        />
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
          {translateError(error, dict)}
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
        {pending ? labels.submitPending : labels.submit}
      </PillButton>
    </form>
  );
}

function translateError(code: string, dict: Dictionary): string {
  const map = dict.errors.duelNew as Record<string, string>;
  return map[code] ?? map.db;
}

// Inline options editor for custom-option duels. Keeps the opener's
// pick coherent with the edit state - removing an option also resets
// `openerOptionKey` to the first remaining row when needed.
function OptionsEditor({
  options,
  setOptions,
  openerOptionKey,
  setOpenerOptionKey,
  stake,
  isHebrew,
}: {
  options: DuelOption[];
  setOptions: (next: DuelOption[]) => void;
  openerOptionKey: string;
  setOpenerOptionKey: (key: string) => void;
  stake: number;
  isHebrew: boolean;
}) {
  const update = (index: number, patch: Partial<DuelOption>) => {
    setOptions(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  };
  const addOption = () => {
    if (options.length >= OPTION_MAX_COUNT) return;
    const nextKey = `opt${options.length + 1}`;
    setOptions([
      ...options,
      { key: nextKey, labelHe: "", labelEn: "", multiplierPct: 200 },
    ]);
  };
  const removeOption = (index: number) => {
    if (options.length <= OPTION_MIN_COUNT) return;
    const removed = options[index];
    const next = options.filter((_, i) => i !== index);
    setOptions(next);
    if (removed.key === openerOptionKey && next.length > 0) {
      setOpenerOptionKey(next[0].key);
    }
  };

  return (
    <div className="flex flex-col gap-3 mt-2">
      <p className="text-xs text-on-surface-variant">
        {isHebrew
          ? `הגדר 2 עד ${OPTION_MAX_COUNT} אופציות. ליחס בין 1.5× ל-3.0×. הזוכה מקבל stake × יחס של האופציה שלו.`
          : `Set 2 to ${OPTION_MAX_COUNT} options. Multipliers between 1.5x and 3.0x. Winner takes stake x their option's multiplier.`}
      </p>
      <div className="flex flex-col gap-3">
        {options.map((o, i) => {
          const grossWin = grossPayoutOnWin(stake, o.multiplierPct);
          const net = grossWin - stake;
          return (
            <div
              key={i}
              className="grid grid-cols-1 md:grid-cols-[1fr_1fr_140px_60px] gap-2 items-start p-3 rounded-lg border border-outline-variant bg-surface-container-lowest"
            >
              <label className="flex flex-col gap-1 text-xs font-bold text-on-surface">
                {isHebrew ? "תווית (עברית)" : "Label (Hebrew)"}
                <input
                  type="text"
                  value={o.labelHe}
                  onChange={(e) => update(i, { labelHe: e.target.value })}
                  maxLength={40}
                  className="h-11 px-3 rounded border border-outline bg-surface-container-lowest text-sm"
                  dir="rtl"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-on-surface">
                {isHebrew ? "תווית (אנגלית)" : "Label (English)"}
                <input
                  type="text"
                  value={o.labelEn}
                  onChange={(e) => update(i, { labelEn: e.target.value })}
                  maxLength={40}
                  className="h-11 px-3 rounded border border-outline bg-surface-container-lowest text-sm"
                  dir="ltr"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-on-surface">
                {isHebrew ? "יחס" : "Multiplier"}
                <select
                  value={o.multiplierPct}
                  onChange={(e) => update(i, { multiplierPct: Number(e.target.value) })}
                  className="h-11 px-2 rounded border border-outline bg-surface-container-lowest text-sm font-bold tabular-nums"
                  dir="ltr"
                >
                  {MULTIPLIER_CHOICES.map((m) => (
                    <option key={m} value={m}>
                      {formatMultiplier(m, isHebrew ? "he" : "en")}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] font-normal text-on-surface-variant">
                  {isHebrew
                    ? `אם זוכה: +${net} (סה״כ ${grossWin})`
                    : `If wins: +${net} (gross ${grossWin})`}
                </span>
              </label>
              <button
                type="button"
                onClick={() => removeOption(i)}
                disabled={options.length <= OPTION_MIN_COUNT}
                aria-label={isHebrew ? "הסר אופציה" : "Remove option"}
                className={clsx(
                  "press-down self-end h-11 rounded border text-sm font-bold",
                  options.length <= OPTION_MIN_COUNT
                    ? "border-outline-variant text-on-surface-variant opacity-50 cursor-not-allowed"
                    : "border-error text-error hover:bg-error-container",
                )}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addOption}
          disabled={options.length >= OPTION_MAX_COUNT}
          className={clsx(
            "press-down min-h-[44px] px-4 rounded-full border border-outline text-sm font-bold",
            options.length >= OPTION_MAX_COUNT && "opacity-50 cursor-not-allowed",
          )}
        >
          + {isHebrew ? "הוסף אופציה" : "Add option"}
        </button>
        <span className="text-xs text-on-surface-variant">
          {options.length}/{OPTION_MAX_COUNT}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold text-on-surface">
          {isHebrew ? "האופציה שלך" : "Your pick"}
        </span>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setOpenerOptionKey(o.key)}
              className={clsx(
                "press-down min-h-[48px] rounded-lg border text-sm font-bold flex flex-col items-center justify-center gap-0.5",
                openerOptionKey === o.key
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface-container-lowest text-on-surface border-outline",
              )}
            >
              <span>{isHebrew ? o.labelHe || "—" : o.labelEn || "—"}</span>
              <span className="text-[10px] tabular-nums opacity-80">
                {formatMultiplier(o.multiplierPct, isHebrew ? "he" : "en")}
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? "המצטרף יבחר אחת מהאופציות האחרות. אם האופציה שלך תנצח - תקבל את הסכום למעלה."
            : "The joiner picks one of the other options. If your option wins, you get the amount above."}
        </p>
      </div>
    </div>
  );
}

const MULTIPLIER_CHOICES = [150, 175, 200, 225, 250, 275, 300];

// Quick-template chip row for match-scope duels. Tapping a chip
// expands it into a tiny threshold stepper; "Apply" pours the
// template's full payload (HE/EN copy, options pair, auto-grade
// config) into the form state via the parent's `onApply` callback.
function QuickTemplatesCard({
  isHebrew,
  onApply,
}: {
  isHebrew: boolean;
  onApply: (payload: ReturnType<typeof applyTemplate>) => void;
}) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const [thresholdById, setThresholdById] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      DUEL_QUICK_TEMPLATES.map((t) => [t.id, t.defaultThreshold]),
    ),
  );

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SectionHeading underline="thin" as="h2">
          {isHebrew ? "תבניות מהירות (API-Football)" : "Quick templates (API-Football)"}
        </SectionHeading>
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? "תבחר תבנית, תקבע את הסף, ואני אמלא את השאלה, הכלל וההכרעה האוטומטית. השאר ידני - שדות הטקסט והאופציות פתוחים לעריכה אחרי."
            : "Pick a template, set the threshold, and I'll fill the question, rule, and auto-grade config. Everything stays editable after."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {DUEL_QUICK_TEMPLATES.map((t) => {
          const isArmed = armedId === t.id;
          const n = thresholdById[t.id] ?? t.defaultThreshold;
          return (
            <div
              key={t.id}
              className={clsx(
                "rounded-2xl border transition-colors",
                isArmed
                  ? "border-primary bg-primary-container/30"
                  : "border-outline-variant bg-surface-container-lowest",
              )}
            >
              <button
                type="button"
                onClick={() => setArmedId(isArmed ? null : t.id)}
                className="press-down min-h-[44px] px-4 inline-flex items-center gap-2 text-sm font-bold text-on-surface"
              >
                {isHebrew ? t.chipHe : t.chipEn}
              </button>
              {isArmed && (
                <div className="px-3 pb-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-label={isHebrew ? "פחות" : "Less"}
                    onClick={() =>
                      setThresholdById((prev) => ({
                        ...prev,
                        [t.id]: Math.max(t.thresholdMin, n - t.thresholdStep),
                      }))
                    }
                    className="press-down h-10 w-10 rounded-full border border-outline text-base font-bold"
                  >
                    −
                  </button>
                  <span className="min-w-[2.5rem] text-center text-base font-bold tabular-nums">
                    {n}
                  </span>
                  <button
                    type="button"
                    aria-label={isHebrew ? "יותר" : "More"}
                    onClick={() =>
                      setThresholdById((prev) => ({
                        ...prev,
                        [t.id]: Math.min(t.thresholdMax, n + t.thresholdStep),
                      }))
                    }
                    className="press-down h-10 w-10 rounded-full border border-outline text-base font-bold"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onApply(applyTemplate(t, n));
                      setArmedId(null);
                    }}
                    className="press-down min-h-[40px] px-4 rounded-full bg-primary text-on-primary text-sm font-bold"
                  >
                    {isHebrew ? "השתמש" : "Apply"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
