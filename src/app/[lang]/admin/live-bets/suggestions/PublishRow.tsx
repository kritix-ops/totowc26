"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, AlertCircle, Pencil } from "lucide-react";
import { clsx } from "clsx";
import type { Locale } from "../../../dictionaries";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import { publishSuggestion } from "./actions";

// One row inside a market group. Shows the selection, computed
// stake/payout, an optional inline editor (for question text + stake +
// payout) and a Publish button. After a successful publish the row
// collapses into a confirmation chip so the admin sees what landed.

type Props = {
  locale: Locale;
  matchId: string;
  marketName: string;
  selectionLabel: string;
  decimalOdds: number;
  stake: number;
  payout: number;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
};

export function PublishRow(props: Props) {
  const router = useRouter();
  const isHebrew = props.locale === "he";

  const [pending, startTransition] = useTransition();
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [stake, setStake] = useState(props.stake);
  const [payout, setPayout] = useState(props.payout);
  const [questionHe, setQuestionHe] = useState(props.questionHe);
  const [questionEn, setQuestionEn] = useState(props.questionEn);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await publishSuggestion({
        matchId: props.matchId,
        marketName: props.marketName,
        selectionLabel: props.selectionLabel,
        decimalOdds: props.decimalOdds,
        stake,
        payout,
        questionHe,
        questionEn,
        gradingRuleHe: props.gradingRuleHe,
        gradingRuleEn: props.gradingRuleEn,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPublished(true);
      router.refresh();
    });
  };

  if (published) {
    return (
      <div className="flex items-center justify-between gap-2 p-2 px-3 rounded-md bg-secondary-container text-on-secondary-container">
        <span className="text-sm font-bold inline-flex items-center gap-1.5">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          {props.selectionLabel}
        </span>
        <span className="text-xs">
          {isHebrew ? "פורסם" : "Published"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2 px-3 rounded-md bg-surface-container-lowest border border-outline-variant">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-sm font-bold text-on-surface truncate">
            {props.selectionLabel}
          </span>
          <span className="text-[11px] text-on-surface-variant">
            {isHebrew ? "יחס" : "Odds"}:{" "}
            <span className="tabular-nums bidi-ltr">
              {props.decimalOdds.toFixed(2)}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2 tabular-nums bidi-ltr">
          <span className="text-xs text-on-surface-variant">
            {isHebrew ? "השקעה" : "Stake"}
          </span>
          <span className="text-base font-bold">{stake}</span>
          <span className="text-on-surface-variant">→</span>
          <span className="text-xs text-on-surface-variant">
            {isHebrew ? "תשלום" : "Payout"}
          </span>
          <span className="text-base font-bold text-surface-tint">
            {payout}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            aria-label={isHebrew ? "ערוך" : "Edit"}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-surface-container-low text-on-surface hover:bg-surface-container"
          >
            <Pencil className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className={clsx(
              "h-9 px-4 rounded-full bg-primary text-on-primary text-sm font-bold press-down",
              pending && "opacity-60 cursor-not-allowed",
            )}
          >
            {pending
              ? isHebrew ? "מפרסם..." : "Publishing..."
              : isHebrew ? "פרסם" : "Publish"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t border-outline-variant">
          <label className="flex flex-col gap-1 text-[11px] font-bold text-on-surface">
            {isHebrew ? "שאלה (עברית)" : "Question (Hebrew)"}
            <input
              type="text"
              value={questionHe}
              onChange={(e) => setQuestionHe(e.target.value)}
              className="h-10 px-2 rounded-md border border-outline bg-surface-container-lowest text-sm"
              dir="rtl"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold text-on-surface">
            {isHebrew ? "שאלה (אנגלית)" : "Question (English)"}
            <input
              type="text"
              value={questionEn}
              onChange={(e) => setQuestionEn(e.target.value)}
              className="h-10 px-2 rounded-md border border-outline bg-surface-container-lowest text-sm"
              dir="ltr"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold text-on-surface">
            {isHebrew ? "השקעה" : "Stake"}
            <input
              type="number"
              min={1}
              max={32000}
              value={stake}
              onChange={(e) =>
                setStake(Math.max(1, Math.trunc(Number(e.target.value) || 0)))
              }
              className="h-10 px-2 rounded-md border border-outline bg-surface-container-lowest text-sm tabular-nums"
              dir="ltr"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold text-on-surface">
            {isHebrew ? "תשלום" : "Payout"}
            <input
              type="number"
              min={stake + 1}
              max={32000}
              value={payout}
              onChange={(e) =>
                setPayout(
                  Math.max(stake + 1, Math.trunc(Number(e.target.value) || 0)),
                )
              }
              className="h-10 px-2 rounded-md border border-outline bg-surface-container-lowest text-sm tabular-nums"
              dir="ltr"
            />
          </label>
        </div>
      )}

      {error && (
        <p className="text-xs text-error inline-flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
          {translateError(error, isHebrew)}
        </p>
      )}
    </div>
  );
}

const ERROR_MAP = {
  ...COMMON_ADMIN_ERRORS,
  match_not_found: ["המשחק לא נמצא", "Match not found"],
  match_locked:    ["המשחק כבר נעול", "Match is locked"],
  invalid_input:   ["נתונים לא תקינים", "Invalid values"],
} as const satisfies Record<string, LocalizedTuple>;

function translateError(code: string, isHebrew: boolean): string {
  return translateAdminError(code in ERROR_MAP ? code : "db", ERROR_MAP, isHebrew);
}
