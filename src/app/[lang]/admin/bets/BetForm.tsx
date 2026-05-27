"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, RotateCcw, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { PillButton, LabelCaps } from "@/components/ui";
import { localePath } from "@/lib/paths";
import type { Locale } from "../../dictionaries";
import type {
  AnswerConfig,
  AutoApiFootballStat,
  GradingConfig,
} from "@/lib/bets/types";
import type { AdminAnchorMatch, AdminAnchorDay } from "@/db/admin-queries";
import type { BetTypeKey } from "@/db/schema";
import { createCustomBet, updateCustomBet } from "./actions";

// Shared bet-author form. Two modes:
//   create – default; submit hits createCustomBet, redirects to list.
//   edit   – pre-fills every field from `initialBet`, submit hits
//            updateCustomBet(betId, …). The server-side action enforces
//            draft-only edits so this form is never reachable for an
//            already-published bet.

type Scope = "match" | "day" | "stage" | "group" | "tournament";
type AnswerType = "yes_no" | "number" | "multi_choice" | "free_text";
type GradingSource = "auto_api_football" | "auto_football_data" | "manual";
type StageId = "group" | "r32" | "r16" | "qf" | "sf" | "third_place" | "final";
type AutoFdField =
  | "home_score"
  | "away_score"
  | "winner"
  | "ht_score"
  | "total_goals"
  | "ht_total"
  | "went_to_penalties";

type Defaults = {
  stakeYesNo: number; payoutYesNo: number;
  stakeNumber: number; payoutNumber: number;
  stakeMultiChoice: number; payoutMultiChoice: number;
  stakeFreeText: number; payoutFreeText: number;
  // Legacy single-knob lock minutes (settings.bet_lock_minutes). Kept
  // as a fallback for any bet type that doesn't appear in
  // `deadlineOffsets` (defensive against a partial seed).
  betLockMinutes: number;
  // Per-bet-type deadline offsets from bet_lock_defaults. Used by
  // suggestDefaultLockAt to compute the lockAt that matches what the
  // resolver in src/lib/deadlines.ts would pick for a new bet.
  deadlineOffsets: Record<BetTypeKey, number>;
  // Tournament anchor (settings.tournament_start_at). null = no
  // explicit admin choice; falls back to earliest fixture kickoff.
  tournamentStartAt: string | null;
};

export type InitialBet = {
  scope: Scope;
  matchId: string | null;
  matchdayDate: string | null;
  stage: StageId | null;
  groupId: string | null;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  answerType: AnswerType;
  answerConfig: AnswerConfig;
  stakeSnapshot: number;
  payoutSnapshot: number;
  gradingSource: GradingSource;
  gradingConfig: GradingConfig;
  lockAt: string; // ISO 8601 (UTC)
};

export function BetForm({
  locale,
  anchorMatches,
  anchorDays,
  groupIds,
  defaults,
  mode = "create",
  betId,
  initialBet,
}: {
  locale: Locale;
  anchorMatches: AdminAnchorMatch[];
  anchorDays: AdminAnchorDay[];
  groupIds: string[];
  defaults: Defaults | undefined;
  mode?: "create" | "edit";
  betId?: string;
  initialBet?: InitialBet;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();

  // ---- Scope + anchors ----
  const [scope, setScope] = useState<Scope>(initialBet?.scope ?? "day");
  const [matchId, setMatchId] = useState<string>(initialBet?.matchId ?? "");
  const [dayDate, setDayDate] = useState<string>(
    initialBet?.matchdayDate ?? anchorDays[0]?.date ?? "",
  );
  const [stage, setStage] = useState<StageId>(initialBet?.stage ?? "group");
  const [groupId, setGroupId] = useState<string>(
    initialBet?.groupId ?? groupIds[0] ?? "",
  );

  // ---- Copy ----
  const [questionHe, setQuestionHe] = useState(initialBet?.questionHe ?? "");
  const [questionEn, setQuestionEn] = useState(initialBet?.questionEn ?? "");
  const [gradingRuleHe, setGradingRuleHe] = useState(initialBet?.gradingRuleHe ?? "");
  const [gradingRuleEn, setGradingRuleEn] = useState(initialBet?.gradingRuleEn ?? "");

  // ---- Answer ----
  const [answerType, setAnswerType] = useState<AnswerType>(
    initialBet?.answerType ?? "yes_no",
  );
  const initialNumber =
    initialBet?.answerConfig.kind === "number" ? initialBet.answerConfig : null;
  const [numberUnit, setNumberUnit] = useState<string>(initialNumber?.unit ?? "");
  const [numberMin, setNumberMin] = useState<string>(
    initialNumber?.min !== undefined ? String(initialNumber.min) : "",
  );
  const [numberMax, setNumberMax] = useState<string>(
    initialNumber?.max !== undefined ? String(initialNumber.max) : "",
  );
  const initialMc =
    initialBet?.answerConfig.kind === "multi_choice" ? initialBet.answerConfig : null;
  const [mcOptions, setMcOptions] = useState<
    Array<{ value: string; labelHe: string; labelEn: string }>
  >(
    initialMc?.options ?? [
      { value: "", labelHe: "", labelEn: "" },
      { value: "", labelHe: "", labelEn: "" },
    ],
  );
  const initialFt =
    initialBet?.answerConfig.kind === "free_text" ? initialBet.answerConfig : null;
  const [freeTextPlaceholderHe, setFreeTextPlaceholderHe] = useState(
    initialFt?.placeholderHe ?? "",
  );
  const [freeTextPlaceholderEn, setFreeTextPlaceholderEn] = useState(
    initialFt?.placeholderEn ?? "",
  );

  // ---- Pricing (default by answer type, overridable) ----
  const defaultStakePayout = useMemo(() => {
    if (!defaults) return { stake: 1, payout: 3 };
    switch (answerType) {
      case "yes_no":       return { stake: defaults.stakeYesNo,        payout: defaults.payoutYesNo };
      case "number":       return { stake: defaults.stakeNumber,       payout: defaults.payoutNumber };
      case "multi_choice": return { stake: defaults.stakeMultiChoice,  payout: defaults.payoutMultiChoice };
      case "free_text":    return { stake: defaults.stakeFreeText,     payout: defaults.payoutFreeText };
    }
  }, [answerType, defaults]);
  const [stake, setStake] = useState<number>(
    initialBet?.stakeSnapshot ?? defaultStakePayout.stake,
  );
  const [payout, setPayout] = useState<number>(
    initialBet?.payoutSnapshot ?? defaultStakePayout.payout,
  );
  // Track whether the admin has manually touched stake/payout; if not, snap
  // them to whatever the new answer-type default is. In edit mode every
  // value is "touched" already because it came from the saved row.
  const [stakeTouched, setStakeTouched] = useState(mode === "edit");
  const [payoutTouched, setPayoutTouched] = useState(mode === "edit");
  if (!stakeTouched && stake !== defaultStakePayout.stake) {
    setStake(defaultStakePayout.stake);
  }
  if (!payoutTouched && payout !== defaultStakePayout.payout) {
    setPayout(defaultStakePayout.payout);
  }

  // ---- Grading ----
  const [gradingSource, setGradingSource] = useState<GradingSource>(
    initialBet?.gradingSource ?? "manual",
  );
  const initialAf =
    initialBet?.gradingConfig?.source === "auto_api_football"
      ? initialBet.gradingConfig
      : null;
  const [autoAfStat, setAutoAfStat] = useState<string>(initialAf?.stat ?? "corners");
  const [autoAfAgg, setAutoAfAgg] = useState<"sum_day" | "per_match" | "first_match">(
    initialAf?.aggregate ?? "per_match",
  );
  const initialFd =
    initialBet?.gradingConfig?.source === "auto_football_data"
      ? initialBet.gradingConfig
      : null;
  const [autoFdField, setAutoFdField] = useState<AutoFdField>(
    initialFd?.field ?? "total_goals",
  );

  // ---- Lock time ----
  // suggestDefaultLockAt reads Date.now() in its fallback branch, so the
  // React lint rule won't let us wrap this in useMemo. Compute it inline
  // every render - it's a few field reads, not expensive - and rely on
  // the `lockTouched` flag below to avoid stomping admin's manual input.
  const defaultLockAt = initialBet?.lockAt
    ? toLocalDateTimeInputValue(new Date(initialBet.lockAt))
    : suggestDefaultLockAt(
        scope,
        matchId,
        dayDate,
        stage,
        groupId,
        anchorMatches,
        anchorDays,
        defaults,
      );
  const [lockAtLocal, setLockAtLocal] = useState<string>(defaultLockAt);
  const [lockTouched, setLockTouched] = useState(mode === "edit");
  if (!lockTouched && lockAtLocal !== defaultLockAt) {
    setLockAtLocal(defaultLockAt);
  }

  // ---- Submission ----
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const answerConfig = buildAnswerConfig(
      answerType,
      { numberUnit, numberMin, numberMax },
      mcOptions,
      { freeTextPlaceholderHe, freeTextPlaceholderEn },
    );
    if (answerConfig === "invalid") {
      setError(isHebrew ? "תצורת תשובה לא תקינה" : "Invalid answer config");
      return;
    }

    const gradingConfig = buildGradingConfig(
      gradingSource,
      { autoAfStat, autoAfAgg, autoFdField },
    );
    if (gradingConfig === "invalid") {
      setError(isHebrew ? "תצורת דירוג לא תקינה" : "Invalid grading config");
      return;
    }

    // Convert the <input type="datetime-local"> string (naive local time)
    // to a proper ISO. The browser interpreted it in the user's local
    // timezone, which matches what we want.
    const lockAtIso = new Date(lockAtLocal).toISOString();

    const payload = {
      scope,
      matchId: scope === "match" ? matchId : null,
      matchdayDate: scope === "day" ? dayDate : null,
      stage: scope === "stage" ? stage : null,
      groupId: scope === "group" ? groupId : null,
      questionHe,
      questionEn,
      gradingRuleHe,
      gradingRuleEn,
      answerType,
      answerConfig,
      stakeSnapshot: stake,
      payoutSnapshot: payout,
      gradingSource,
      gradingConfig,
      lockAt: lockAtIso,
    };

    startTransition(async () => {
      if (mode === "edit") {
        if (!betId) {
          setError("Missing bet id");
          return;
        }
        const res = await updateCustomBet(betId, payload);
        if (!res.ok) {
          setError(translateError(res.error, isHebrew));
          return;
        }
        router.push(localePath(locale, `admin/bets/${betId}`));
        router.refresh();
      } else {
        const res = await createCustomBet(payload);
        if (!res.ok) {
          setError(translateError(res.error, isHebrew));
          return;
        }
        router.push(localePath(locale, "admin/bets"));
        router.refresh();
      }
    });
  };

  const cancelHref =
    mode === "edit" && betId
      ? localePath(locale, `admin/bets/${betId}`)
      : localePath(locale, "admin/bets");

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 md:gap-8">
      {/* 1. Scope */}
      <Section title={isHebrew ? "סוג הימור" : "Scope"}>
        <SegmentedRow
          options={[
            { value: "match",      label: isHebrew ? "משחק" : "Match" },
            { value: "day",        label: isHebrew ? "יום" : "Day" },
            { value: "stage",      label: isHebrew ? "שלב" : "Stage" },
            { value: "group",      label: isHebrew ? "בית" : "Group" },
            { value: "tournament", label: isHebrew ? "טורניר" : "Tournament" },
          ]}
          value={scope}
          onChange={(v) => setScope(v as Scope)}
        />
        <p className="text-xs text-on-surface-variant">
          {scopeHelp(scope, isHebrew)}
        </p>
      </Section>

      {/* 2. Anchor (depends on scope) */}
      {scope === "match" && (
        <Section title={isHebrew ? "באיזה משחק?" : "Which match?"}>
          <select
            value={matchId}
            onChange={(e) => setMatchId(e.target.value)}
            required
            className="min-h-[48px] w-full px-3 rounded border border-outline bg-surface-container-lowest text-base"
          >
            <option value="">{isHebrew ? "בחר משחק…" : "Pick a match…"}</option>
            {anchorMatches.map((m) => (
              <option key={m.id} value={m.id}>
                {isHebrew ? m.homeNameHe : m.homeNameEn} vs{" "}
                {isHebrew ? m.awayNameHe : m.awayNameEn}
                {" - "}
                {new Date(m.kickoffAt).toLocaleString(
                  isHebrew ? "he-IL" : "en-GB",
                  { timeZone: "Asia/Jerusalem", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
                )}
              </option>
            ))}
          </select>
        </Section>
      )}

      {scope === "day" && (
        <Section title={isHebrew ? "באיזה יום?" : "Which day?"}>
          {anchorDays.length === 0 ? (
            <p className="text-sm text-on-surface-variant">
              {isHebrew ? "אין משחקים מתוזמנים." : "No scheduled matches."}
            </p>
          ) : (
            <select
              value={dayDate}
              onChange={(e) => setDayDate(e.target.value)}
              required
              className="min-h-[48px] w-full px-3 rounded border border-outline bg-surface-container-lowest text-base"
            >
              {anchorDays.map((d) => (
                <option key={d.date} value={d.date}>
                  {new Date(d.date + "T12:00:00Z").toLocaleDateString(
                    isHebrew ? "he-IL" : "en-GB",
                    { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long" },
                  )}
                  {" - "}
                  {d.matchCount} {isHebrew ? "משחקים" : "matches"}
                </option>
              ))}
            </select>
          )}
        </Section>
      )}

      {scope === "stage" && (
        <Section title={isHebrew ? "באיזה שלב?" : "Which stage?"}>
          <SegmentedRow
            options={[
              { value: "group",       label: isHebrew ? "בתים" : "Group" },
              { value: "r32",         label: "R32" },
              { value: "r16",         label: "R16" },
              { value: "qf",          label: isHebrew ? "רבע" : "QF" },
              { value: "sf",          label: isHebrew ? "חצי" : "SF" },
              { value: "third_place", label: isHebrew ? "מקום 3" : "3rd place" },
              { value: "final",       label: isHebrew ? "גמר" : "Final" },
            ]}
            value={stage}
            onChange={(v) => setStage(v as StageId)}
          />
        </Section>
      )}

      {scope === "group" && (
        <Section title={isHebrew ? "באיזה בית?" : "Which group?"}>
          <div className="flex flex-wrap gap-2">
            {groupIds.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroupId(g)}
                className={clsx(
                  "min-w-[48px] min-h-[48px] px-4 rounded-full border text-base font-bold",
                  groupId === g
                    ? "border-2 border-primary bg-primary-container text-on-primary-container"
                    : "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container",
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* 3. Question (HE + EN) */}
      <Section title={isHebrew ? "השאלה לשחקנים" : "Question for players"}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LabeledInput
            label="HE"
            value={questionHe}
            onChange={setQuestionHe}
            required
            placeholder={isHebrew ? "למשל: האם תהיה הפתעה היום?" : "e.g. האם תהיה הפתעה היום?"}
            dir="rtl"
          />
          <LabeledInput
            label="EN"
            value={questionEn}
            onChange={setQuestionEn}
            required
            placeholder="e.g. Will today have a surprise?"
            dir="ltr"
          />
        </div>
      </Section>

      {/* 4. Grading rule (mandatory) */}
      <Section
        title={isHebrew ? "איך מודדים את התשובה?" : "How is this graded?"}
        hint={isHebrew
          ? "משפט אחד שאי-אפשר לפרש לרעה. מופיע לשחקנים לפני שהם מהמרים - זה המקום למנוע ויכוחים."
          : "One sentence that can't be misread. Shown to players before they stake - this is where you prevent fights."}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LabeledTextarea
            label="HE"
            value={gradingRuleHe}
            onChange={setGradingRuleHe}
            required
            placeholder={isHebrew ? "למשל: כרטיס אדום אחד או יותר ב‑90 הדקות (לא כולל הארכה) באחד המשחקים של היום." : "e.g."}
            dir="rtl"
          />
          <LabeledTextarea
            label="EN"
            value={gradingRuleEn}
            onChange={setGradingRuleEn}
            required
            placeholder="e.g. One or more red cards in regulation across today's matches."
            dir="ltr"
          />
        </div>
      </Section>

      {/* 5. Answer type */}
      <Section title={isHebrew ? "סוג תשובה" : "Answer type"}>
        <SegmentedRow
          options={[
            { value: "yes_no",       label: isHebrew ? "כן / לא" : "Yes / No" },
            { value: "number",       label: isHebrew ? "מספר" : "Number" },
            { value: "multi_choice", label: isHebrew ? "בחירה" : "Choice" },
            { value: "free_text",    label: isHebrew ? "טקסט" : "Text" },
          ]}
          value={answerType}
          onChange={(v) => setAnswerType(v as AnswerType)}
        />
      </Section>

      {/* 6. Answer config (dynamic) */}
      {answerType === "number" && (
        <Section title={isHebrew ? "הגדרות מספר" : "Number settings"}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <LabeledInput
              label={isHebrew ? "מינימום" : "Min"}
              value={numberMin}
              onChange={setNumberMin}
              placeholder="0"
              inputMode="numeric"
            />
            <LabeledInput
              label={isHebrew ? "מקסימום" : "Max"}
              value={numberMax}
              onChange={setNumberMax}
              placeholder="99"
              inputMode="numeric"
            />
            <LabeledInput
              label={isHebrew ? "יחידה" : "Unit"}
              value={numberUnit}
              onChange={setNumberUnit}
              placeholder={isHebrew ? "שערים / קרנות / …" : "goals / corners / …"}
            />
          </div>
        </Section>
      )}

      {answerType === "multi_choice" && (
        <Section title={isHebrew ? "אפשרויות בחירה" : "Choice options"}>
          <div className="flex flex-col gap-3">
            {mcOptions.map((opt, i) => (
              <div
                key={i}
                className="grid grid-cols-1 md:grid-cols-[80px_1fr_1fr_44px] gap-2 md:items-center"
              >
                <LabeledInput
                  label={isHebrew ? "ערך" : "Value"}
                  value={opt.value}
                  onChange={(v) => updateMc(i, "value", v, mcOptions, setMcOptions)}
                  placeholder="brazil"
                />
                <LabeledInput
                  label="HE"
                  value={opt.labelHe}
                  onChange={(v) => updateMc(i, "labelHe", v, mcOptions, setMcOptions)}
                  placeholder="ברזיל"
                  dir="rtl"
                />
                <LabeledInput
                  label="EN"
                  value={opt.labelEn}
                  onChange={(v) => updateMc(i, "labelEn", v, mcOptions, setMcOptions)}
                  placeholder="Brazil"
                />
                <button
                  type="button"
                  onClick={() => removeMc(i, mcOptions, setMcOptions)}
                  disabled={mcOptions.length <= 2}
                  className="self-end md:self-center min-w-[44px] min-h-[44px] rounded-full border border-outline text-on-surface-variant hover:text-error disabled:opacity-40 flex items-center justify-center"
                  aria-label={isHebrew ? "הסר אפשרות" : "Remove option"}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setMcOptions([
                  ...mcOptions,
                  { value: "", labelHe: "", labelEn: "" },
                ])
              }
              className="self-start inline-flex items-center gap-2 min-h-[44px] px-4 rounded-full border border-outline bg-surface-container-lowest text-on-surface text-sm font-bold hover:bg-surface-container"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              {isHebrew ? "הוסף אפשרות" : "Add option"}
            </button>
          </div>
        </Section>
      )}

      {answerType === "free_text" && (
        <Section title={isHebrew ? "טקסט עזר (לא חובה)" : "Placeholder (optional)"}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <LabeledInput
              label="HE"
              value={freeTextPlaceholderHe}
              onChange={setFreeTextPlaceholderHe}
              dir="rtl"
              placeholder={isHebrew ? "שם השחקן" : "Player name"}
            />
            <LabeledInput
              label="EN"
              value={freeTextPlaceholderEn}
              onChange={setFreeTextPlaceholderEn}
              placeholder="Player name"
            />
          </div>
        </Section>
      )}

      {/* 7. Pricing */}
      <Section
        title={isHebrew ? "תמחור" : "Pricing"}
        hint={isHebrew
          ? `ברירת המחדל לסוג תשובה זה: ${defaultStakePayout.stake} / ${defaultStakePayout.payout}.`
          : `Default for this answer type: stake ${defaultStakePayout.stake} / payout ${defaultStakePayout.payout}.`}
      >
        <div className="flex flex-wrap gap-3 items-end">
          <NumberStepper
            label={isHebrew ? "עלות (stake)" : "Stake"}
            value={stake}
            onChange={(n) => { setStake(n); setStakeTouched(true); }}
            min={0}
          />
          <NumberStepper
            label={isHebrew ? "תשלום (payout)" : "Payout"}
            value={payout}
            onChange={(n) => { setPayout(n); setPayoutTouched(true); }}
            min={1}
          />
          {(stakeTouched || payoutTouched) && (
            <button
              type="button"
              onClick={() => {
                setStake(defaultStakePayout.stake);
                setPayout(defaultStakePayout.payout);
                setStakeTouched(false);
                setPayoutTouched(false);
              }}
              className="self-end inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full border border-outline text-on-surface-variant text-sm hover:bg-surface-container"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
              {isHebrew ? "ברירת מחדל" : "Reset to default"}
            </button>
          )}
        </div>
      </Section>

      {/* 8. Grading source */}
      <Section title={isHebrew ? "מקור דירוג" : "Grading source"}>
        <SegmentedRow
          options={[
            { value: "manual",             label: isHebrew ? "ידני" : "Manual" },
            { value: "auto_football_data", label: isHebrew ? "אוטו (תוצאה)" : "Auto (score)" },
            { value: "auto_api_football", label: isHebrew ? "אוטו (API-Football)" : "Auto (API-Football)" },
          ]}
          value={gradingSource}
          onChange={(v) => setGradingSource(v as GradingSource)}
        />
        {gradingSource === "auto_api_football" && (
          <p className="text-xs text-tertiary-fixed-dim">
            {isHebrew
              ? "API-Football עוד לא מופעל בפרוד. עד אז ההימור ימתין בתור ידני."
              : "API-Football isn't live yet. The bet will queue for manual grading until it is."}
          </p>
        )}
      </Section>

      {/* 9. Grading config (dynamic) */}
      {gradingSource === "auto_football_data" && (
        <Section title={isHebrew ? "מה לדגום מהתוצאה?" : "Which field to read?"}>
          <select
            value={autoFdField}
            onChange={(e) => setAutoFdField(e.target.value as AutoFdField)}
            className="min-h-[48px] w-full px-3 rounded border border-outline bg-surface-container-lowest text-base"
          >
            <option value="total_goals">      {isHebrew ? "סך השערים במשחק" : "Total goals in match"}</option>
            <option value="ht_total">          {isHebrew ? "סך השערים במחצית" : "Halftime total goals"}</option>
            <option value="home_score">        {isHebrew ? "שערי בית" : "Home score"}</option>
            <option value="away_score">        {isHebrew ? "שערי חוץ" : "Away score"}</option>
            <option value="winner">            {isHebrew ? "מנצח (1/X/2)" : "Winner (1/X/2)"}</option>
            <option value="ht_score">          {isHebrew ? "תוצאת מחצית מדויקת" : "Exact halftime score"}</option>
            <option value="went_to_penalties"> {isHebrew ? "האם הוכרע בפנדלים" : "Went to penalties"}</option>
          </select>
        </Section>
      )}

      {gradingSource === "auto_api_football" && (
        <Section title={isHebrew ? "מה לדגום מ-API-Football?" : "Which API-Football stat?"}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              value={autoAfStat}
              onChange={(e) => setAutoAfStat(e.target.value)}
              className="min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base"
            >
              <option value="corners">           {isHebrew ? "קרנות" : "Corners"}</option>
              <option value="yellow_cards">      {isHebrew ? "כרטיסים צהובים" : "Yellow cards"}</option>
              <option value="red_cards">         {isHebrew ? "כרטיסים אדומים" : "Red cards"}</option>
              <option value="shots">             {isHebrew ? "בעיטות (סך הכל)" : "Total shots"}</option>
              <option value="shots_on_goal">     {isHebrew ? "בעיטות למסגרת" : "Shots on goal"}</option>
              <option value="shots_inside_box">  {isHebrew ? "בעיטות מתוך הרחבה" : "Shots inside box"}</option>
              <option value="shots_outside_box"> {isHebrew ? "בעיטות מחוץ לרחבה" : "Shots outside box"}</option>
              <option value="possession">        {isHebrew ? "אחוז כדור" : "Possession %"}</option>
              <option value="fouls">             {isHebrew ? "עבירות" : "Fouls"}</option>
              <option value="offsides">          {isHebrew ? "נבדלים" : "Offsides"}</option>
              <option value="saves">             {isHebrew ? "הצלות שוער" : "Goalkeeper saves"}</option>
              <option value="total_passes">      {isHebrew ? "מסירות (סך הכל)" : "Total passes"}</option>
              <option value="pass_accuracy">     {isHebrew ? "דיוק מסירות" : "Pass accuracy %"}</option>
            </select>
            <select
              value={autoAfAgg}
              onChange={(e) => setAutoAfAgg(e.target.value as typeof autoAfAgg)}
              className="min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base"
            >
              <option value="per_match">   {isHebrew ? "פר משחק" : "Per match"}</option>
              <option value="sum_day">     {isHebrew ? "סכום על היום" : "Sum over the day"}</option>
              <option value="first_match"> {isHebrew ? "המשחק הראשון בלבד" : "First match only"}</option>
            </select>
          </div>
        </Section>
      )}

      {/* 10. Lock time */}
      <Section
        title={isHebrew ? "מתי נסגר?" : "When does it lock?"}
        hint={isHebrew
          ? "ברירת המחדל מחושבת מהעוגן של ההיקף הזה (תאריך הטורניר / יום הימורים / משחק) פחות ברירות המחדל ב-/admin/deadlines. אפשר לעדכן ידנית."
          : "Default is derived from this scope's anchor (tournament date / matchday / match) minus the offset set in /admin/deadlines. Override manually if you like."}
      >
        <div className="flex flex-col gap-2">
          <input
            type="datetime-local"
            value={lockAtLocal}
            onChange={(e) => {
              setLockAtLocal(e.target.value);
              setLockTouched(true);
            }}
            required
            className="min-h-[48px] w-full px-3 rounded border border-outline bg-surface-container-lowest text-base"
          />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p
              className={clsx(
                "text-[11px]",
                lockTouched && lockAtLocal !== defaultLockAt
                  ? "text-on-surface-variant"
                  : "text-secondary",
              )}
            >
              {lockTouched && lockAtLocal !== defaultLockAt
                ? isHebrew
                  ? `ערך ידני. ברירת המחדל: ${defaultLockAt.replace("T", " ")}`
                  : `Manual value. Default: ${defaultLockAt.replace("T", " ")}`
                : isHebrew
                  ? "הערך תואם לברירת המחדל הנוכחית."
                  : "Value matches the current default."}
            </p>
            {lockTouched && lockAtLocal !== defaultLockAt && (
              <button
                type="button"
                onClick={() => {
                  setLockAtLocal(defaultLockAt);
                  setLockTouched(false);
                }}
                className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
              >
                <RotateCcw className="h-3 w-3" strokeWidth={2.5} />
                {isHebrew ? "השתמש בברירת המחדל" : "Use defaults"}
              </button>
            )}
          </div>
        </div>
      </Section>

      {error && (
        <p className="inline-flex items-center gap-2 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse md:flex-row md:justify-end gap-3 pt-4 border-t border-outline-variant">
        <button
          type="button"
          onClick={() => router.push(cancelHref)}
          className="min-h-[48px] px-6 rounded-full border border-outline bg-surface-container-lowest text-on-surface font-bold hover:bg-surface-container"
        >
          {isHebrew ? "ביטול" : "Cancel"}
        </button>
        <PillButton type="submit" disabled={pending} className="min-h-[48px]">
          {pending
            ? isHebrew ? "שומר…" : "Saving…"
            : mode === "edit"
              ? isHebrew ? "שמור שינויים" : "Save changes"
              : isHebrew ? "שמור כטיוטה" : "Save as draft"}
        </PillButton>
      </div>
    </form>
  );
}

// ---------- helpers ----------

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-[family-name:var(--font-display)] text-lg md:text-xl font-bold text-on-surface">
          {title}
        </h2>
        {hint && <p className="text-xs text-on-surface-variant">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function SegmentedRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            "min-h-[44px] px-4 rounded-full border text-sm font-bold transition-colors",
            value === o.value
              ? "border-2 border-primary bg-primary-container text-on-primary-container"
              : "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  required,
  dir,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  dir?: "rtl" | "ltr";
  inputMode?: "text" | "numeric" | "decimal";
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <LabelCaps>{label}</LabelCaps>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        dir={dir}
        inputMode={inputMode}
        className="min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base"
      />
    </label>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  placeholder,
  required,
  dir,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  dir?: "rtl" | "ltr";
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <LabelCaps>{label}</LabelCaps>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        dir={dir}
        rows={3}
        className="min-h-[80px] px-3 py-2 rounded border border-outline bg-surface-container-lowest text-base resize-y"
      />
    </label>
  );
}

function NumberStepper({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <LabelCaps>{label}</LabelCaps>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="min-w-[44px] min-h-[44px] rounded-full border border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container disabled:opacity-40"
        >
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value || "0", 10);
            onChange(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min);
          }}
          className="w-20 min-h-[44px] text-center rounded border border-outline bg-surface-container-lowest text-base tabular-nums"
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="min-w-[44px] min-h-[44px] rounded-full border border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

function updateMc(
  i: number,
  field: "value" | "labelHe" | "labelEn",
  value: string,
  list: Array<{ value: string; labelHe: string; labelEn: string }>,
  setter: (l: typeof list) => void,
) {
  const next = list.slice();
  next[i] = { ...next[i], [field]: value };
  setter(next);
}

function removeMc(
  i: number,
  list: Array<{ value: string; labelHe: string; labelEn: string }>,
  setter: (l: typeof list) => void,
) {
  if (list.length <= 2) return;
  setter(list.filter((_, idx) => idx !== i));
}

function buildAnswerConfig(
  answerType: AnswerType,
  numberFields: { numberUnit: string; numberMin: string; numberMax: string },
  mcOptions: Array<{ value: string; labelHe: string; labelEn: string }>,
  freeText: { freeTextPlaceholderHe: string; freeTextPlaceholderEn: string },
): AnswerConfig | "invalid" {
  switch (answerType) {
    case "yes_no":
      return { kind: "yes_no" };
    case "number": {
      const min = numberFields.numberMin === "" ? undefined : parseFloat(numberFields.numberMin);
      const max = numberFields.numberMax === "" ? undefined : parseFloat(numberFields.numberMax);
      if (min !== undefined && Number.isNaN(min)) return "invalid";
      if (max !== undefined && Number.isNaN(max)) return "invalid";
      const unit = numberFields.numberUnit.trim();
      return {
        kind: "number",
        min,
        max,
        unit: unit === "" ? undefined : (unit as "goals" | "corners" | "cards" | "shots" | "minutes" | ""),
      };
    }
    case "multi_choice": {
      const trimmed = mcOptions
        .map((o) => ({
          value: o.value.trim(),
          labelHe: o.labelHe.trim(),
          labelEn: o.labelEn.trim(),
        }))
        .filter((o) => o.value !== "" || o.labelHe !== "" || o.labelEn !== "");
      if (trimmed.length < 2) return "invalid";
      if (trimmed.some((o) => o.value === "" || o.labelHe === "" || o.labelEn === "")) {
        return "invalid";
      }
      const seen = new Set<string>();
      for (const o of trimmed) {
        if (seen.has(o.value)) return "invalid";
        seen.add(o.value);
      }
      return { kind: "multi_choice", options: trimmed };
    }
    case "free_text":
      return {
        kind: "free_text",
        placeholderHe: freeText.freeTextPlaceholderHe.trim() || undefined,
        placeholderEn: freeText.freeTextPlaceholderEn.trim() || undefined,
      };
  }
}

function buildGradingConfig(
  source: GradingSource,
  fields: {
    autoAfStat: string;
    autoAfAgg: "sum_day" | "per_match" | "first_match";
    autoFdField: AutoFdField;
  },
): GradingConfig | "invalid" {
  if (source === "manual") return null;
  if (source === "auto_api_football") {
    if (!fields.autoAfStat) return "invalid";
    return {
      source: "auto_api_football",
      stat: fields.autoAfStat as AutoApiFootballStat,
      aggregate: fields.autoAfAgg,
    };
  }
  return {
    source: "auto_football_data",
    field: fields.autoFdField,
  };
}

// Picks an anchor + offset that matches what the deadline resolver in
// src/lib/deadlines.ts would pick for a brand-new bet of this scope,
// so the value the admin sees in the form is the same value the
// resolver would compute. Falls back to the legacy single-knob
// betLockMinutes if the per-type table hasn't been seeded yet, and to
// "kickoff in 24 h" if no fixture data is available at all (rare; new
// installs before the first sync).
//
// anchorMatches is pre-sorted by kickoff_at ASC server-side, so the
// first match of each stage/group is just the first array entry that
// matches the filter.
function suggestDefaultLockAt(
  scope: Scope,
  matchId: string,
  dayDate: string,
  stage: StageId,
  groupId: string,
  anchorMatches: AdminAnchorMatch[],
  anchorDays: AdminAnchorDay[],
  defaults: Defaults | undefined,
): string {
  const fallbackMinutes = defaults?.betLockMinutes ?? 5;
  const offsets = defaults?.deadlineOffsets;
  let kickoff: Date | null = null;
  let offsetMinutes = fallbackMinutes;

  if (scope === "match" && matchId) {
    const m = anchorMatches.find((x) => x.id === matchId);
    if (m) kickoff = new Date(m.kickoffAt);
    offsetMinutes = offsets?.custom_match ?? fallbackMinutes;
  } else if (scope === "day" && dayDate) {
    const d = anchorDays.find((x) => x.date === dayDate);
    if (d) kickoff = new Date(d.earliestKickoff);
    offsetMinutes = offsets?.custom_day ?? fallbackMinutes;
  } else if (scope === "stage") {
    const first = anchorMatches.find((x) => x.stage === stage);
    if (first) kickoff = new Date(first.kickoffAt);
    offsetMinutes = offsets?.custom_stage ?? 60;
  } else if (scope === "group") {
    const first = anchorMatches.find((x) => x.groupId === groupId);
    if (first) kickoff = new Date(first.kickoffAt);
    offsetMinutes = offsets?.custom_group ?? 60;
  } else if (scope === "tournament") {
    if (defaults?.tournamentStartAt) {
      kickoff = new Date(defaults.tournamentStartAt);
    } else if (anchorMatches.length > 0) {
      kickoff = new Date(anchorMatches[0].kickoffAt);
    }
    offsetMinutes = offsets?.custom_tournament ?? 60;
  }
  if (!kickoff) {
    kickoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  const lock = new Date(kickoff.getTime() - offsetMinutes * 60 * 1000);
  return toLocalDateTimeInputValue(lock);
}

function toLocalDateTimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function scopeHelp(scope: Scope, isHebrew: boolean): string {
  switch (scope) {
    case "match":
      return isHebrew
        ? "ההימור מוצמד למשחק יחיד ויופיע בעמוד היום של אותו משחק."
        : "Attached to a single match; shows on that match's day page.";
    case "day":
      return isHebrew
        ? "ההימור מסכם את כל המשחקים באותו יום ויופיע בעמוד היום."
        : "Aggregates across all matches that day; shows on the day page.";
    case "stage":
      return isHebrew
        ? "ההימור מתייחס לשלב טורניר (רבע גמר, חצי גמר וכו'). יופיע בעמוד הימורי הטורניר."
        : "Tied to a tournament stage (QF, SF, etc.). Shows on the tournament page.";
    case "group":
      return isHebrew
        ? "ההימור מתייחס לבית אחד מתוך A..H. יופיע בעמוד הבתים."
        : "Tied to one group (A..H). Shows on the groups page.";
    case "tournament":
      return isHebrew
        ? "הימור חד-פעמי לכל הטורניר. יופיע בעמוד הימורי הטורניר."
        : "One-shot for the whole tournament. Shows on the tournament page.";
  }
}

function translateError(err: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    unauth:                ["יש להתחבר", "Sign in required"],
    forbidden:             ["אין הרשאה", "Not allowed"],
    invalid_scope_anchor:  ["סוג ההימור והעוגן אינם תואמים", "Scope and anchor don't match"],
    invalid_question:      ["שאלה ריקה בעברית או באנגלית", "Question missing in Hebrew or English"],
    invalid_grading_rule:  ["כלל דירוג חייב להיות לפחות 3 תווים", "Grading rule must be 3+ characters"],
    invalid_stake_payout:  ["עלות או תשלום לא תקין", "Invalid stake or payout"],
    invalid_answer_config: ["תצורת תשובה לא תקינה", "Invalid answer config"],
    invalid_grading_config:["תצורת דירוג לא תקינה", "Invalid grading config"],
    invalid_lock_at:       ["זמן סגירה חייב להיות בעתיד", "Lock time must be in the future"],
    match_not_found:       ["המשחק לא נמצא", "Match not found"],
    group_not_found:       ["הבית לא נמצא", "Group not found"],
    bet_not_found:         ["ההימור לא נמצא", "Bet not found"],
    invalid_status:        ["אפשר לערוך רק טיוטה. בטל את ההימור ותיצור אחד חדש.", "Only drafts can be edited. Cancel and recreate."],
    db:                    ["שגיאת שמירה", "Save failed"],
  };
  const e = map[err];
  return e ? e[isHebrew ? 0 : 1] : err;
}
