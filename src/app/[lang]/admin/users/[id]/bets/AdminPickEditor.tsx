"use client";

import {
  useState,
  useRef,
  useEffect,
  useTransition,
  useId,
} from "react";
import { clsx } from "clsx";
import {
  Pencil,
  X as XIcon,
  AlertCircle,
  AlertTriangle,
  Check,
  Trash2,
} from "lucide-react";
import type { Locale } from "../../../../dictionaries";
import {
  adminClearCustomBetPick,
  adminClearMatchPick,
  adminSetCustomBetPick,
  adminSetMatchPick,
  type AdminWriteResult,
} from "./actions";
import type { PickAnswer } from "@/lib/bets/types";

// AdminPickEditor: a small dialog that lets an admin set or clear a
// target user's pick on one specific bet. Surfaces are two:
//   - "custom" — a custom_bets row with an answer_type/config-driven
//                input (yes_no / number / multi_choice / free_text)
//   - "match"  — a 1/X/2 score pick (two number inputs)
// In both cases the dialog requires a non-empty reason and, when the
// bet's lock has already passed, an explicit "bypass lock" checkbox.

type CustomKind = {
  surface: "custom";
  customBetId: string;
  questionHe: string;
  questionEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  currentAnswer: PickAnswer | null;
  stake: number;
  payout: number;
};

type MatchKind = {
  surface: "match";
  matchId: string;
  matchupHe: string;
  matchupEn: string;
  currentHomeScore: number | null;
  currentAwayScore: number | null;
};

type Props = (CustomKind | MatchKind) & {
  targetUserId: string;
  targetUserName: string;
  locale: Locale;
  lockAt?: string;
};

const ERROR_HE: Record<string, string> = {
  unauthorized: "צריך להתחבר מחדש",
  forbidden: "אין הרשאת אדמין",
  missing_reason: "חובה לכתוב סיבה",
  self_target: "אדמין לא יכול לערוך את הניחוש של עצמו דרך כאן",
  invalid_input: "ערכים לא תקינים",
  bet_not_found: "ההימור לא נמצא",
  invalid_answer: "תשובה לא תואמת את ההימור",
  not_found: "המשחק לא נמצא",
  invalid: "ערך לא תקין",
  db: "שגיאת מסד נתונים — נסה שוב",
  not_allowed: "אסור",
  closed: "ההימור או המשחק כבר נסגר",
  locked: "ההימור נעול — צריך לסמן 'עקיפת נעילה'",
  already_filled: "אין מה למחוק",
  unaffordable: "אין מספיק נקודות בבנק של המשתמש",
};
const ERROR_EN: Record<string, string> = {
  unauthorized: "Sign in again",
  forbidden: "Admin only",
  missing_reason: "Reason is required",
  self_target: "Admin can't edit their own pick from here",
  invalid_input: "Invalid values",
  bet_not_found: "Bet not found",
  invalid_answer: "Answer doesn't match the bet",
  not_found: "Match not found",
  invalid: "Invalid value",
  db: "Database error — try again",
  not_allowed: "Forbidden",
  closed: "Bet or match is closed",
  locked: "Bet is locked — tick 'bypass lock'",
  already_filled: "Nothing to clear",
  unaffordable: "User's bank is insufficient",
};

export function AdminPickEditor(props: Props) {
  const [open, setOpen] = useState(false);
  const isHebrew = props.locale === "he";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-full border border-outline-variant text-xs font-bold text-on-surface hover:bg-surface-container-low transition-colors"
        aria-label={isHebrew ? "ערוך הימור עבור המשתמש" : "Edit bet for user"}
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
        {isHebrew ? "ערוך" : "Edit"}
      </button>
      {open && <Dialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function Dialog(props: Props & { onClose: () => void }) {
  const isHebrew = props.locale === "he";
  const reasonId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [lockBypassed, setLockBypassed] = useState(false);

  // Snapshot the lock state when the dialog opens. The bet's `lockAt` is
  // a fixed instant, so a re-render mid-edit doesn't change whether the
  // checkbox is needed. Computing inside useState keeps Date.now() pure
  // from React's lint perspective.
  const [lockHasPassed] = useState(
    () => props.lockAt != null && new Date(props.lockAt).getTime() <= Date.now(),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const errMap = isHebrew ? ERROR_HE : ERROR_EN;
  function translateResult(result: AdminWriteResult): string | null {
    if (!result.ok) return errMap[result.error] ?? result.error;
    if (result.outcome.status === "filled") return null;
    if (result.outcome.status === "skipped") {
      return errMap[result.outcome.reason] ?? result.outcome.reason;
    }
    return errMap[result.outcome.error] ?? result.outcome.error;
  }

  function handleSaveCustom(answer: PickAnswer) {
    if (props.surface !== "custom") return;
    setError(null);
    startTransition(async () => {
      const result = await adminSetCustomBetPick({
        targetUserId: props.targetUserId,
        customBetId: props.customBetId,
        answer,
        reason,
        lockBypassed,
      });
      const msg = translateResult(result);
      if (msg) {
        setError(msg);
        return;
      }
      props.onClose();
    });
  }

  function handleSaveMatch(home: number, away: number) {
    if (props.surface !== "match") return;
    setError(null);
    startTransition(async () => {
      const result = await adminSetMatchPick({
        targetUserId: props.targetUserId,
        matchId: props.matchId,
        homeScore: home,
        awayScore: away,
        reason,
        lockBypassed,
      });
      const msg = translateResult(result);
      if (msg) {
        setError(msg);
        return;
      }
      props.onClose();
    });
  }

  function handleClear() {
    setError(null);
    startTransition(async () => {
      const result =
        props.surface === "custom"
          ? await adminClearCustomBetPick({
              targetUserId: props.targetUserId,
              customBetId: props.customBetId,
              reason,
              lockBypassed,
            })
          : await adminClearMatchPick({
              targetUserId: props.targetUserId,
              matchId: props.matchId,
              reason,
              lockBypassed,
            });
      const msg = translateResult(result);
      if (msg) {
        setError(msg);
        return;
      }
      props.onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end md:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={isHebrew ? "עריכת הימור עבור משתמש" : "Edit pick for user"}
    >
      <button
        type="button"
        aria-label={isHebrew ? "סגור" : "Close"}
        onClick={props.onClose}
        className="absolute inset-0 bg-on-surface/40 backdrop-blur-[2px] cursor-pointer"
      />
      <div
        ref={dialogRef}
        className="relative w-full md:max-w-md md:rounded-2xl bg-surface-container rounded-t-2xl border-t md:border border-outline-variant shadow-2xl pb-[env(safe-area-inset-bottom)] max-h-[100dvh] overflow-y-auto"
      >
        <header className="sticky top-0 bg-surface-container border-b border-outline-variant px-5 py-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-on-surface min-w-0 truncate">
            {isHebrew ? "ערוך עבור" : "Edit for"}{" "}
            <span className="text-primary">{props.targetUserName}</span>
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={isHebrew ? "סגור" : "Close"}
            className="p-2 rounded-full hover:bg-surface-container-high transition-colors min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
          >
            <XIcon className="h-5 w-5" strokeWidth={2} />
          </button>
        </header>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Question / matchup */}
          <p className="text-sm text-on-surface leading-snug font-medium">
            {props.surface === "custom"
              ? isHebrew
                ? props.questionHe
                : props.questionEn
              : isHebrew
                ? props.matchupHe
                : props.matchupEn}
          </p>

          {/* Answer input */}
          {props.surface === "custom" ? (
            <CustomAnswerInput
              answerType={props.answerType}
              answerConfig={props.answerConfig}
              currentAnswer={props.currentAnswer}
              locale={props.locale}
              pending={pending}
              onSubmit={handleSaveCustom}
            />
          ) : (
            <MatchScoreInput
              currentHomeScore={props.currentHomeScore}
              currentAwayScore={props.currentAwayScore}
              locale={props.locale}
              pending={pending}
              onSubmit={handleSaveMatch}
            />
          )}

          {/* Reason */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor={reasonId}
              className="font-[family-name:var(--font-label)] text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface-variant"
            >
              {isHebrew ? "סיבה (חובה)" : "Reason (required)"}
            </label>
            <input
              id={reasonId}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isHebrew
                  ? "השלמתי טלפונית לעודד"
                  : "Filled in over the phone for Oded"
              }
              className="min-h-[48px] px-3 rounded-lg border border-outline-variant bg-surface text-base text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary"
              disabled={pending}
            />
            <p className="text-xs text-on-surface-variant">
              {isHebrew
                ? "נשמר באודיט. לא ניתן לשנות אחרי שמירה."
                : "Stored in the audit log. Permanent after save."}
            </p>
          </div>

          {/* Lock bypass — only when the bet's lock has passed */}
          {lockHasPassed && (
            <label className="flex items-start gap-2 rounded-lg border border-error/40 bg-error-container/30 px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={lockBypassed}
                onChange={(e) => setLockBypassed(e.target.checked)}
                className="mt-1 h-5 w-5 accent-error"
                disabled={pending}
              />
              <span className="text-xs text-error leading-snug">
                <AlertTriangle
                  className="inline h-3.5 w-3.5 me-1 align-text-bottom"
                  strokeWidth={2}
                />
                {isHebrew
                  ? "עוקף את מועד הסגירה. נרשם בנפרד באודיט."
                  : "Bypass the lock deadline. Logged separately in the audit."}
              </span>
            </label>
          )}

          {error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-error">
              <AlertCircle className="h-4 w-4" strokeWidth={2} />
              {error}
            </p>
          )}

          {/* Clear pick + cancel */}
          <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-2 pt-3 border-t border-outline-variant">
            <button
              type="button"
              onClick={handleClear}
              disabled={pending || reason.trim().length === 0}
              className={clsx(
                "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-full text-sm font-bold transition-colors",
                "text-error border border-error/30 hover:bg-error-container",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
              {isHebrew ? "מחק ניחוש" : "Clear pick"}
            </button>
            <span className="text-xs text-on-surface-variant md:ms-auto md:me-2">
              {isHebrew
                ? "השמירה דרך הכפתור מעל ההזנה"
                : "Save with the button above the input"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomAnswerInput({
  answerType,
  answerConfig,
  currentAnswer,
  locale,
  pending,
  onSubmit,
}: {
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: unknown;
  currentAnswer: PickAnswer | null;
  locale: Locale;
  pending: boolean;
  onSubmit: (answer: PickAnswer) => void;
}) {
  const isHebrew = locale === "he";
  const [draft, setDraft] = useState<PickAnswer | null>(currentAnswer);

  function save(value: PickAnswer) {
    setDraft(value);
    onSubmit(value);
  }

  if (answerType === "yes_no") {
    return (
      <div className="flex gap-2">
        {[true, false].map((v) => {
          const active = draft?.type === "yes_no" && draft.value === v;
          return (
            <button
              key={String(v)}
              type="button"
              onClick={() => save({ type: "yes_no", value: v })}
              disabled={pending}
              className={clsx(
                "flex-1 min-h-[48px] rounded-full border text-base font-bold transition-colors",
                active
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface text-on-surface border-outline-variant hover:bg-surface-container-low",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              {v ? (isHebrew ? "כן" : "Yes") : isHebrew ? "לא" : "No"}
            </button>
          );
        })}
      </div>
    );
  }

  if (answerType === "multi_choice") {
    const cfg = answerConfig as
      | { options?: Array<{ value: string; labelHe: string; labelEn: string }> }
      | null;
    const options = cfg?.options ?? [];
    return (
      <div className="flex flex-col gap-2">
        {options.map((o) => {
          const active = draft?.type === "multi_choice" && draft.value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => save({ type: "multi_choice", value: o.value })}
              disabled={pending}
              className={clsx(
                "min-h-[48px] px-4 rounded-full border text-base font-bold transition-colors text-start",
                active
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface text-on-surface border-outline-variant hover:bg-surface-container-low",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              {isHebrew ? o.labelHe : o.labelEn}
            </button>
          );
        })}
      </div>
    );
  }

  if (answerType === "number") {
    return (
      <NumberInputRow
        currentValue={draft?.type === "number" ? draft.value : null}
        locale={locale}
        pending={pending}
        onSave={(n) => save({ type: "number", value: n })}
      />
    );
  }

  // free_text
  return (
    <FreeTextInputRow
      currentValue={draft?.type === "free_text" ? draft.value : ""}
      locale={locale}
      pending={pending}
      onSave={(s) => save({ type: "free_text", value: s })}
    />
  );
}

function NumberInputRow({
  currentValue,
  locale,
  pending,
  onSave,
}: {
  currentValue: number | null;
  locale: Locale;
  pending: boolean;
  onSave: (n: number) => void;
}) {
  const isHebrew = locale === "he";
  const [text, setText] = useState<string>(
    currentValue == null ? "" : String(currentValue),
  );
  const valid = text.trim().length > 0 && Number.isFinite(Number(text));
  return (
    <div className="flex gap-2 items-end">
      <input
        type="number"
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        className="flex-1 min-h-[48px] px-3 rounded-lg border border-outline-variant bg-surface text-base text-on-surface focus:outline-none focus:border-primary"
      />
      <button
        type="button"
        onClick={() => valid && onSave(Number(text))}
        disabled={pending || !valid}
        className="inline-flex items-center gap-1 min-h-[48px] px-4 rounded-full bg-primary text-on-primary text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Check className="h-4 w-4" strokeWidth={2.5} />
        {isHebrew ? "שמור" : "Save"}
      </button>
    </div>
  );
}

function FreeTextInputRow({
  currentValue,
  locale,
  pending,
  onSave,
}: {
  currentValue: string;
  locale: Locale;
  pending: boolean;
  onSave: (s: string) => void;
}) {
  const isHebrew = locale === "he";
  const [text, setText] = useState<string>(currentValue);
  const valid = text.trim().length > 0;
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        rows={3}
        className="min-h-[80px] px-3 py-2 rounded-lg border border-outline-variant bg-surface text-base text-on-surface focus:outline-none focus:border-primary"
      />
      <button
        type="button"
        onClick={() => valid && onSave(text.trim())}
        disabled={pending || !valid}
        className="inline-flex items-center justify-center gap-1 min-h-[48px] px-4 rounded-full bg-primary text-on-primary text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Check className="h-4 w-4" strokeWidth={2.5} />
        {isHebrew ? "שמור" : "Save"}
      </button>
    </div>
  );
}

function MatchScoreInput({
  currentHomeScore,
  currentAwayScore,
  locale,
  pending,
  onSubmit,
}: {
  currentHomeScore: number | null;
  currentAwayScore: number | null;
  locale: Locale;
  pending: boolean;
  onSubmit: (home: number, away: number) => void;
}) {
  const isHebrew = locale === "he";
  const [home, setHome] = useState<string>(
    currentHomeScore == null ? "" : String(currentHomeScore),
  );
  const [away, setAway] = useState<string>(
    currentAwayScore == null ? "" : String(currentAwayScore),
  );
  const hNum = Number(home);
  const aNum = Number(away);
  const valid =
    home.trim() !== "" &&
    away.trim() !== "" &&
    Number.isFinite(hNum) &&
    Number.isFinite(aNum) &&
    hNum >= 0 &&
    aNum >= 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={home}
          onChange={(e) => setHome(e.target.value)}
          aria-label={isHebrew ? "ביתית" : "Home"}
          disabled={pending}
          className="flex-1 min-h-[56px] px-3 rounded-lg border border-outline-variant bg-surface text-2xl font-bold text-center text-on-surface focus:outline-none focus:border-primary tabular-nums"
        />
        <span className="text-xl font-bold text-on-surface-variant" aria-hidden>
          –
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={away}
          onChange={(e) => setAway(e.target.value)}
          aria-label={isHebrew ? "חוצית" : "Away"}
          disabled={pending}
          className="flex-1 min-h-[56px] px-3 rounded-lg border border-outline-variant bg-surface text-2xl font-bold text-center text-on-surface focus:outline-none focus:border-primary tabular-nums"
        />
      </div>
      <button
        type="button"
        onClick={() => valid && onSubmit(hNum, aNum)}
        disabled={pending || !valid}
        className="inline-flex items-center justify-center gap-1 min-h-[48px] px-4 rounded-full bg-primary text-on-primary text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Check className="h-4 w-4" strokeWidth={2.5} />
        {isHebrew ? "שמור" : "Save"}
      </button>
    </div>
  );
}
