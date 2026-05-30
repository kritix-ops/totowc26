"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import { Card, PillButton, SectionHeading } from "@/components/ui";
import { PickScenarios } from "@/components/PickScenarios";
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
  corners:           { he: "׳§׳¨׳ ׳•׳×", en: "Corners" },
  yellow_cards:      { he: "׳›׳¨׳˜׳™׳¡׳™׳ ׳¦׳”׳•׳‘׳™׳", en: "Yellow cards" },
  red_cards:         { he: "׳›׳¨׳˜׳™׳¡׳™׳ ׳׳“׳•׳׳™׳", en: "Red cards" },
  shots:             { he: "׳‘׳¢׳™׳˜׳•׳× ׳¡׳”\"׳›", en: "Total shots" },
  shots_on_goal:     { he: "׳‘׳¢׳™׳˜׳•׳× ׳׳׳¡׳’׳¨׳×", en: "Shots on goal" },
  shots_inside_box:  { he: "׳‘׳¢׳™׳˜׳•׳× ׳׳×׳•׳ ׳”׳¨׳—׳‘׳”", en: "Shots inside box" },
  shots_outside_box: { he: "׳‘׳¢׳™׳˜׳•׳× ׳׳—׳•׳¥ ׳׳¨׳—׳‘׳”", en: "Shots outside box" },
  fouls:             { he: "׳¢׳‘׳™׳¨׳•׳×", en: "Fouls" },
  offsides:          { he: "׳ ׳‘׳“׳׳™׳", en: "Offsides" },
  saves:             { he: "׳”׳¦׳׳•׳× ׳©׳•׳¢׳¨׳™׳", en: "Goalkeeper saves" },
  total_passes:      { he: "׳׳¡׳™׳¨׳•׳× ׳¡׳”\"׳›", en: "Total passes" },
};

export function NewDuelForm({
  locale,
  dict,
  balance,
  duelMaxStake,
  defaultJoinWindow,
  upcomingMatches,
  upcomingMatchdays,
}: {
  locale: Locale;
  dict: Dictionary;
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

  const labels = {
    title: isHebrew ? "׳“׳•-׳§׳¨׳‘ ׳—׳“׳©" : "New duel",
    scopeQ: isHebrew ? "׳¢׳ ׳׳” ׳”׳“׳•-׳§׳¨׳‘?" : "What does this duel hinge on?",
    scopeMatch: isHebrew ? "׳׳©׳—׳§" : "Match",
    scopeDay: isHebrew ? "׳™׳•׳ ׳׳©׳—׳§׳™׳" : "Match day",
    scopeTournament: isHebrew ? "׳˜׳•׳¨׳ ׳™׳¨" : "Tournament",
    matchPicker: isHebrew ? "׳‘׳—׳¨ ׳׳©׳—׳§" : "Pick a match",
    matchdayDate: isHebrew ? "׳‘׳—׳¨ ׳×׳׳¨׳™׳ ׳™׳•׳ ׳׳©׳—׳§׳™׳" : "Pick a match-day date",
    answerQ: isHebrew ? "׳”׳×׳©׳•׳‘׳” ׳©׳׳" : "Your answer",
    yes: isHebrew ? "׳›׳" : "Yes",
    no: isHebrew ? "׳׳" : "No",
    stakeQ: isHebrew
      ? `׳”׳©׳§׳¢׳” (׳¢׳“ ${maxStake})`
      : `Stake (up to ${maxStake})`,
    questionHe: isHebrew ? "׳”׳©׳׳׳” (׳¢׳‘׳¨׳™׳×)" : "Question (Hebrew)",
    questionEn: isHebrew ? "׳”׳©׳׳׳” (׳׳ ׳’׳׳™׳×)" : "Question (English)",
    ruleHe: isHebrew ? "׳›׳׳ ׳”׳›׳¨׳¢׳” (׳¢׳‘׳¨׳™׳×)" : "Grading rule (Hebrew)",
    ruleEn: isHebrew ? "׳›׳׳ ׳”׳›׳¨׳¢׳” (׳׳ ׳’׳׳™׳×)" : "Grading rule (English)",
    questionHint: isHebrew
      ? "׳׳©׳₪׳˜ ׳׳—׳“ ׳©׳’׳ ׳׳©׳×׳׳© ׳׳—׳¨ ׳™׳‘׳™׳ ׳‘׳׳™ ׳׳§׳¨׳•׳ ׳×׳§׳ ׳•׳."
      : "One sentence another player can read without consulting a rulebook.",
    ruleHint: isHebrew
      ? "׳׳” ׳‘׳“׳™׳•׳§ ׳™׳™׳¡׳₪׳¨? ׳׳©׳₪׳˜ ׳©׳׳™ ׳׳₪׳©׳¨ ׳׳₪׳¨׳© ׳׳¨׳¢׳”."
      : "Exactly what counts? Phrase it so it can't be argued.",
    submit: isHebrew ? "׳₪׳×׳— ׳“׳•-׳§׳¨׳‘" : "Open duel",
    submitPending: isHebrew ? "׳₪׳•׳×׳—..." : "Opening...",
    deadlineHint: isHebrew
      ? `׳”׳“׳“׳׳™׳™׳ ׳׳”׳¦׳˜׳¨׳₪׳•׳× ׳ ׳§׳‘׳¢ ׳-${defaultJoinWindow} ׳©׳¢׳•׳× (׳׳• ׳“׳§׳•׳× ׳׳₪׳ ׳™ ׳”׳׳©׳—׳§ - ׳”׳׳•׳§׳“׳ ׳׳‘׳™׳ ׳™׳”׳).`
      : `Join deadline defaults to ${defaultJoinWindow}h from now or the kickoff - whichever is earlier.`,
    bankWarning: isHebrew
      ? `׳”׳”׳©׳§׳¢׳” ׳×׳™׳ ׳¢׳ ׳‘׳‘׳ ׳§ ׳¢׳“ ׳©׳”׳“׳•-׳§׳¨׳‘ ׳™׳•׳›׳¨׳¢ ׳׳• ׳™׳‘׳•׳˜׳. ׳™׳×׳¨׳” ׳ ׳•׳›׳—׳™׳×: ${balance}.`
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
          {labels.scopeQ}
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
                  {d.label} ֲ· {d.fixtureCount}
                </option>
              ))}
            </select>
          </label>
        )}
      </Card>

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
          </label>
        </div>
        <p className="text-xs text-on-surface-variant -mt-2">
          {labels.ruleHint}
        </p>
      </Card>

      <Card className="p-5 md:p-6 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <SectionHeading underline="thin" as="h2">
            {labels.answerQ}
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
                {v ? labels.yes : labels.no}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <SectionHeading underline="thin" as="h2">
            {labels.stakeQ}
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
            {labels.bankWarning}
          </p>
          <p className="text-xs text-on-surface-variant">
            {labels.deadlineHint}
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
                  ? "׳”׳›׳¨׳¢׳” ׳׳•׳˜׳•׳׳˜׳™׳× ׳׳¡׳˜׳˜׳™׳¡׳˜׳™׳§׳•׳×"
                  : "Auto-settle from match stats"}
              </SectionHeading>
              <p className="text-xs text-on-surface-variant">
                {isHebrew
                  ? "׳‘׳׳§׳•׳ ׳©׳׳“׳׳™׳ ׳™׳›׳¨׳™׳¢ ׳™׳“׳ ׳™׳×, ׳”׳“׳•-׳§׳¨׳‘ ׳™׳•׳›׳¨׳¢ ׳׳•׳˜׳•׳׳˜׳™׳× ׳׳”׳¡׳˜׳˜׳™׳¡׳˜׳™׳§׳•׳× ׳©׳ API-Football ׳׳—׳¨׳™ ׳©׳”׳׳©׳—׳§ ׳™׳¡׳×׳™׳™׳. ׳¨׳§ ׳׳“׳•-׳§׳¨׳‘ ׳¢׳ ׳׳©׳—׳§ ׳™׳—׳™׳“."
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
                ? isHebrew ? "׳₪׳¢׳™׳" : "On"
                : isHebrew ? "׳›׳‘׳•׳™" : "Off"}
            </button>
          </div>

          {autoGradeOn && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1.5 text-xs font-bold text-on-surface">
                {isHebrew ? "׳¡׳˜׳˜׳™׳¡׳˜׳™׳§׳”" : "Stat"}
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
                {isHebrew ? "׳”׳©׳•׳•׳׳”" : "Comparator"}
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
                {isHebrew ? "׳¡׳£" : "Threshold"}
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
                  ? "׳›׳ ׳™׳–׳›׳” ׳׳ ׳”׳¢׳¨׳ ׳©׳ ׳”׳¡׳˜׳˜׳™׳¡׳˜׳™׳§׳” (׳¡׳›׳•׳ ׳©׳ ׳™ ׳”׳¦׳“׳“׳™׳) ׳׳§׳™׳™׳ ׳׳× ׳”׳”׳©׳•׳•׳׳”."
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
