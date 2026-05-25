"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Minus, Plus, RotateCcw, Trophy } from "lucide-react";
import { clsx } from "clsx";
import { Card, LabelCaps, PillButton } from "@/components/ui";
import type { Locale } from "../../../dictionaries";
import type {
  AnswerConfig,
  MultiChoiceOption,
  ResolvedValue,
} from "@/lib/bets/types";
import { gradeCustomBet, reverseCustomBetGrading } from "../actions";

type Status = "draft" | "open" | "locked" | "graded" | "reversed" | "cancelled";

export function GradeForm({
  locale,
  bet,
}: {
  locale: Locale;
  bet: {
    id: string;
    status: Status;
    answerType: "yes_no" | "number" | "multi_choice" | "free_text";
    answerConfig: unknown;
    resolvedValue: unknown;
    payoutSnapshot: number;
  };
}) {
  const isHebrew = locale === "he";
  const router = useRouter();
  const [draft, setDraft] = useState<ResolvedValue | null>(
    (bet.resolvedValue as ResolvedValue | null) ?? null,
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<
    | { kind: "graded"; picksGraded: number; winners: number }
    | { kind: "reversed"; picksReverted: number }
    | null
  >(null);
  const [pending, startTransition] = useTransition();

  const canGrade =
    bet.status === "open" || bet.status === "locked" || bet.status === "reversed";
  const canReverse = bet.status === "graded";

  if (!canGrade && !canReverse) {
    // draft / cancelled: nothing to do here. Don't render the card at all
    // so the page doesn't show a useless block.
    return null;
  }

  const onGrade = () => {
    if (!draft) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await gradeCustomBet(bet.id, draft, reason);
      if (!res.ok) {
        setError(translateError(res.error, isHebrew));
        return;
      }
      setSuccess({
        kind: "graded",
        picksGraded: res.picksGraded,
        winners: res.winners,
      });
      router.refresh();
    });
  };

  const onReverse = () => {
    if (reason.trim().length < 3) {
      setError(isHebrew ? "סיבה חייבת לפחות 3 תווים" : "Reason must be 3+ characters");
      return;
    }
    if (
      !window.confirm(
        isHebrew
          ? "להחזיר את הדירוג? כל הנקודות שניתנו יבוטלו וה-stake יוחזר לחישוב הבנק."
          : "Reverse this grading? All credited points will be revoked and stakes re-enter the bank.",
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await reverseCustomBetGrading(bet.id, reason);
      if (!res.ok) {
        setError(translateError(res.error, isHebrew));
        return;
      }
      setSuccess({ kind: "reversed", picksReverted: res.picksReverted });
      setDraft(null);
      router.refresh();
    });
  };

  return (
    <Card className="p-5 md:p-6 flex flex-col gap-4 border-2 border-primary/30">
      <div className="flex items-center gap-2">
        <Trophy className="h-5 w-5 text-tertiary-fixed-dim" strokeWidth={1.75} />
        <h2 className="font-[family-name:var(--font-display)] text-xl md:text-2xl font-bold text-on-surface">
          {canReverse
            ? isHebrew ? "תוצאה" : "Resolution"
            : isHebrew ? "דרג ידנית" : "Grade manually"}
        </h2>
      </div>

      {canReverse && (
        <p className="text-sm text-on-surface-variant">
          {isHebrew
            ? "ההימור כבר נמדד. אם זוהתה טעות, אפשר להחזיר ולדרג מחדש."
            : "Already graded. If you spot a mistake, reverse and re-grade."}
        </p>
      )}

      {/* Answer widget — same shape as the player's, but with the admin
          entering the official resolved value. */}
      <ResolvedValueInput
        locale={locale}
        answerType={bet.answerType}
        config={bet.answerConfig as AnswerConfig}
        value={draft}
        onChange={setDraft}
        disabled={pending || canReverse}
      />

      {/* Reason — required for both grade and reverse. The DB constraint
          enforces ≥3 chars; we mirror it client-side for a friendlier UX. */}
      <div className="flex flex-col gap-1.5">
        <LabelCaps>{isHebrew ? "סיבה / הערה" : "Reason / note"}</LabelCaps>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            isHebrew
              ? "מהיכן הנתון הגיע (FOX, השופט הראשי, וכו')"
              : "Where the result came from (FOX, referee, etc.)"
          }
          dir={isHebrew ? "rtl" : "ltr"}
          maxLength={500}
          className="min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base"
        />
        <p className="text-xs text-on-surface-variant">
          {isHebrew
            ? "נשמר באודיט פנימי. אל תכתוב מידע אישי — הטקסט נשמר לעד."
            : "Saved in the internal audit log. Do not enter personal info."}
        </p>
      </div>

      {error && (
        <p className="inline-flex items-center gap-2 text-sm text-error">
          <AlertCircle className="h-4 w-4" strokeWidth={2} />
          {error}
        </p>
      )}
      {success && !error && (
        <p className="inline-flex items-center gap-2 text-sm text-secondary">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          {success.kind === "graded"
            ? isHebrew
              ? `נמדד. ${success.winners} צודקים מתוך ${success.picksGraded}.`
              : `Graded. ${success.winners} winners out of ${success.picksGraded}.`
            : isHebrew
              ? `הוחזר. ${success.picksReverted} ניחושים אופסו.`
              : `Reversed. ${success.picksReverted} picks reset.`}
        </p>
      )}

      <div className="flex flex-col-reverse md:flex-row md:justify-end gap-3">
        {canReverse ? (
          <PillButton
            type="button"
            variant="ghost"
            disabled={pending || reason.trim().length < 3}
            onClick={onReverse}
            className="min-h-[48px]"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
            {pending
              ? isHebrew ? "מחזיר…" : "Reversing…"
              : isHebrew ? "החזר דירוג" : "Reverse grading"}
          </PillButton>
        ) : (
          <PillButton
            type="button"
            disabled={pending || !draft || reason.trim().length < 3}
            onClick={onGrade}
            className="min-h-[48px]"
          >
            <Trophy className="h-4 w-4" strokeWidth={2.5} />
            {pending
              ? isHebrew ? "מדרג…" : "Grading…"
              : isHebrew
                ? `דרג (+${bet.payoutSnapshot} לזוכים)`
                : `Grade (+${bet.payoutSnapshot} to winners)`}
          </PillButton>
        )}
      </div>
    </Card>
  );
}

// ---------- input widgets ----------

function ResolvedValueInput({
  locale,
  answerType,
  config,
  value,
  onChange,
  disabled,
}: {
  locale: Locale;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  config: AnswerConfig;
  value: ResolvedValue | null;
  onChange: (v: ResolvedValue | null) => void;
  disabled?: boolean;
}) {
  const isHebrew = locale === "he";

  if (answerType === "yes_no") {
    const current = value?.type === "yes_no" ? value.value : null;
    return (
      <div className="grid grid-cols-2 gap-3">
        <Pill
          active={current === true}
          disabled={disabled}
          onClick={() =>
            onChange(current === true ? null : { type: "yes_no", value: true })
          }
        >
          {isHebrew ? "כן" : "Yes"}
        </Pill>
        <Pill
          active={current === false}
          disabled={disabled}
          onClick={() =>
            onChange(current === false ? null : { type: "yes_no", value: false })
          }
        >
          {isHebrew ? "לא" : "No"}
        </Pill>
      </div>
    );
  }

  if (answerType === "number") {
    const c = config.kind === "number" ? config : null;
    const min = c?.min ?? 0;
    const max = c?.max ?? 99;
    const current =
      value?.type === "number" && Number.isFinite(value.value) ? value.value : min;
    return (
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          disabled={disabled || current <= min}
          onClick={() =>
            onChange({ type: "number", value: Math.max(min, current - 1) })
          }
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-surface-container-lowest border border-outline text-on-surface hover:bg-surface-container disabled:opacity-40"
        >
          <Minus className="h-5 w-5" strokeWidth={2.5} />
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value?.type === "number" ? value.value : ""}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              onChange(null);
              return;
            }
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n)) {
              onChange(null);
              return;
            }
            onChange({
              type: "number",
              value: Math.max(min, Math.min(max, n)),
            });
          }}
          disabled={disabled}
          placeholder="—"
          className="w-24 h-14 text-center font-[family-name:var(--font-score)] text-3xl font-bold bg-[#1C140F] border-2 border-outline rounded text-[#FBF6EB] focus:outline-none placeholder:text-[#FBF6EB]/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:opacity-60 tabular-nums"
          dir="ltr"
        />
        <button
          type="button"
          disabled={disabled || current >= max}
          onClick={() =>
            onChange({ type: "number", value: Math.min(max, current + 1) })
          }
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-surface-container-lowest border border-outline text-on-surface hover:bg-surface-container disabled:opacity-40"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  if (answerType === "multi_choice") {
    const opts: MultiChoiceOption[] =
      config.kind === "multi_choice" ? config.options : [];
    const current = value?.type === "multi_choice" ? value.value : null;
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {opts.map((o) => (
          <Pill
            key={o.value}
            active={current === o.value}
            disabled={disabled}
            onClick={() =>
              onChange(
                current === o.value
                  ? null
                  : { type: "multi_choice", value: o.value },
              )
            }
          >
            {isHebrew ? o.labelHe : o.labelEn}
          </Pill>
        ))}
      </div>
    );
  }

  // free_text
  return (
    <input
      type="text"
      maxLength={200}
      value={value?.type === "free_text" ? value.value : ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") onChange(null);
        else onChange({ type: "free_text", value: v });
      }}
      disabled={disabled}
      placeholder={isHebrew ? "התוצאה הרשמית" : "Official answer"}
      dir={isHebrew ? "rtl" : "ltr"}
      className="min-h-[48px] w-full px-3 rounded border border-outline bg-surface-container-lowest text-base"
    />
  );
}

function Pill({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "press-down min-h-[48px] py-3 px-4 rounded-full border text-base font-bold transition-colors",
        active
          ? "border-2 border-primary bg-primary-container text-on-primary-container shadow-sm"
          : "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}

function translateError(err: string, isHebrew: boolean): string {
  const map: Record<string, [string, string]> = {
    unauth:                  ["יש להתחבר", "Sign in required"],
    forbidden:               ["אין הרשאה", "Not allowed"],
    bet_not_found:           ["ההימור לא נמצא", "Bet not found"],
    invalid_status:          ["סטטוס לא תקין לפעולה", "Invalid status for this action"],
    invalid_resolved_value:  ["תוצאה לא תקינה", "Invalid resolved value"],
    invalid_reason:          ["סיבה חייבת לפחות 3 תווים", "Reason must be 3+ characters"],
    db:                      ["שגיאת שמירה", "Save failed"],
  };
  return (map[err] ?? [err, err])[isHebrew ? 0 : 1];
}
