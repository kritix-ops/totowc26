"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Info, Lock, Minus, Plus } from "lucide-react";
import { clsx } from "clsx";
import { Card, Chip, LabelCaps } from "@/components/ui";
import { SearchableChoicePicker } from "@/components/SearchableChoicePicker";
import { LocksInCountdown } from "@/components/LocksInCountdown";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/app/[lang]/dictionaries";
import type {
  AnswerConfig,
  DynamicOptionSource,
  MultiChoiceOption,
  PickAnswer,
} from "@/lib/bets/types";
import { usePickerOptions } from "@/lib/picker-options/client";
import { submitCustomBetPick } from "@/app/[lang]/play/[date]/actions";

// Threshold above which the multi_choice answer widget switches
// from a pill grid to a searchable dropdown. Below the threshold a
// 2-column grid is faster (everything visible, one tap to pick);
// above it a grid becomes a wall of buttons that the user has to
// scroll through. The 48 World Cup teams comfortably exceed this,
// as does the eventual ~1,200-player roster.
const SEARCHABLE_THRESHOLD = 8;

// Player-facing card for a single custom bet. Renders the question, the
// grading-rule contract, the stake/payout chip, and the right answer
// widget for the bet's answer type. On submit it calls the server action
// and lets the parent page re-fetch via router.refresh().

export type CustomBetCardData = {
  id: string;
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  answerType: "yes_no" | "number" | "multi_choice" | "free_text";
  answerConfig: AnswerConfig;
  stakeSnapshot: number;
  payoutSnapshot: number;
  lockAt: string;
  status: "open" | "locked" | "graded" | "reversed" | "cancelled" | "draft";
  myAnswer: PickAnswer | null;
  myStakePaid: number | null;
  scopeLabel?: string;  // e.g. "BRA vs GER" for match-scope, optional
};

export function CustomBetCard({
  locale,
  bet,
  bankBalance,
  editable,
}: {
  locale: Locale;
  bet: CustomBetCardData;
  bankBalance: number;
  // Server computes this once per render so the client doesn't have to
  // call Date.now() (which React 19 lint rules flag as impure).
  editable: boolean;
}) {
  const isHebrew = locale === "he";
  const router = useRouter();

  // The "current" answer the player has selected. Starts as their saved
  // pick if any, otherwise an empty draft of the right shape.
  const [draft, setDraft] = useState<PickAnswer | null>(bet.myAnswer);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [pending, startTransition] = useTransition();

  const refund = bet.myStakePaid ?? 0;
  // If the draft is "empty" the user hasn't expressed a choice yet, so the
  // submit-cost is 0 (we render submit disabled in that case anyway).
  const hasChoice = !!draft;
  const newCost = hasChoice ? bet.stakeSnapshot : 0;
  const effective = bankBalance + refund;
  const bankAfter = effective - newCost;
  const overdrawn = hasChoice && bankAfter < 0;

  const dirty =
    JSON.stringify(draft ?? null) !== JSON.stringify(bet.myAnswer ?? null);

  const onSubmit = () => {
    if (!draft || !editable || overdrawn) return;
    setError(null);
    setSavedFlash(false);
    startTransition(async () => {
      const res = await submitCustomBetPick(bet.id, draft);
      if (!res.ok) {
        setError(translateError(res.error, isHebrew, res));
        return;
      }
      setSavedFlash(true);
      router.refresh();
    });
  };

  const lockLabel = formatDateTime(bet.lockAt, locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Card className="p-4 md:p-5 flex flex-col gap-4">
      {/* Header: question + scope chip + lock time */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <h3 className="font-[family-name:var(--font-display)] text-base md:text-lg font-bold text-on-surface leading-snug">
            {isHebrew ? bet.questionHe : bet.questionEn}
          </h3>
          {bet.scopeLabel && (
            <span className="text-xs text-on-surface-variant tabular-nums">
              {bet.scopeLabel}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Chip tone={bet.status === "open" ? "primary" : "default"}>
            {bet.status === "open"
              ? isHebrew ? "פתוח" : "Open"
              : isHebrew ? "נסגר" : "Locked"}
          </Chip>
          <span className="font-[family-name:var(--font-label)] text-xs text-on-surface-variant tabular-nums inline-flex items-center gap-1">
            <Lock className="h-3 w-3" strokeWidth={2} />
            {lockLabel}
          </span>
          <LocksInCountdown
            locale={locale}
            lockAt={bet.lockAt}
            variant="inline"
          />
        </div>
      </div>

      {/* Grading rule - the contract */}
      <div className="flex items-start gap-2 text-xs md:text-sm text-on-surface-variant bg-surface-container-low border border-outline-variant rounded p-3">
        <Info className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={2} />
        <p className="flex-1">
          {isHebrew ? bet.gradingRuleHe : bet.gradingRuleEn}
        </p>
      </div>

      {/* Answer widget per type */}
      <AnswerWidget
        locale={locale}
        bet={bet}
        value={draft}
        onChange={setDraft}
        disabled={!editable || pending}
      />

      {/* Stake/payout + submit */}
      <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-3 pt-3 border-t border-outline-variant">
        <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm text-on-surface-variant">
          <span>
            {isHebrew ? "עלות" : "Stake"}:{" "}
            <bdi className="tabular-nums font-bold text-on-surface">
              {bet.stakeSnapshot}
            </bdi>
          </span>
          <span aria-hidden className="opacity-40">·</span>
          <span>
            {isHebrew ? "זכייה" : "Payout"}:{" "}
            <bdi className="tabular-nums font-bold text-on-surface">
              {bet.payoutSnapshot}
            </bdi>
          </span>
          {hasChoice && dirty && (
            <>
              <span aria-hidden className="opacity-40">·</span>
              <span className={clsx(overdrawn && "text-error font-bold")}>
                {isHebrew ? "בנק אחרי" : "Bank after"}:{" "}
                <bdi className="tabular-nums">{bankAfter}</bdi>
              </span>
            </>
          )}
        </div>
        <div className="flex flex-col items-stretch md:items-end gap-1.5">
          {error && (
            <p className="inline-flex items-center gap-1.5 text-xs text-error">
              <AlertCircle className="h-3 w-3" strokeWidth={2} />
              {error}
            </p>
          )}
          {savedFlash && !error && (
            <p className="inline-flex items-center gap-1.5 text-xs text-secondary">
              <Check className="h-3 w-3" strokeWidth={2.5} />
              {isHebrew ? "נשמר" : "Saved"}
            </p>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={!editable || pending || overdrawn || !hasChoice || !dirty}
            className={clsx(
              "press-down inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-full text-sm font-bold transition-colors",
              "bg-primary text-on-primary shadow-md hover:bg-surface-tint",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary",
            )}
          >
            {pending
              ? isHebrew ? "שומר…" : "Saving…"
              : overdrawn
                ? isHebrew ? "אין מספיק בבנק" : "Insufficient bank"
                : bet.myAnswer
                  ? isHebrew ? "עדכן ניחוש" : "Update pick"
                  : isHebrew ? "שמור ניחוש" : "Save pick"}
          </button>
        </div>
      </div>
    </Card>
  );
}

// ---------- Answer widgets ----------

function AnswerWidget({
  locale,
  bet,
  value,
  onChange,
  disabled,
}: {
  locale: Locale;
  bet: CustomBetCardData;
  value: PickAnswer | null;
  onChange: (v: PickAnswer | null) => void;
  disabled?: boolean;
}) {
  const isHebrew = locale === "he";
  const cfg = bet.answerConfig;

  if (bet.answerType === "yes_no") {
    const current = value?.type === "yes_no" ? value.value : null;
    return (
      <div className="grid grid-cols-2 gap-3">
        <ChoicePill
          active={current === true}
          disabled={disabled}
          onClick={() =>
            onChange(current === true ? null : { type: "yes_no", value: true })
          }
        >
          {isHebrew ? "כן" : "Yes"}
        </ChoicePill>
        <ChoicePill
          active={current === false}
          disabled={disabled}
          onClick={() =>
            onChange(current === false ? null : { type: "yes_no", value: false })
          }
        >
          {isHebrew ? "לא" : "No"}
        </ChoicePill>
      </div>
    );
  }

  if (bet.answerType === "number") {
    const c = cfg.kind === "number" ? cfg : null;
    const min = c?.min ?? 0;
    const max = c?.max ?? 99;
    const current =
      value?.type === "number" && Number.isFinite(value.value) ? value.value : min;
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 md:gap-3">
          <button
            type="button"
            disabled={disabled || current <= min}
            onClick={() =>
              onChange({ type: "number", value: Math.max(min, current - 1) })
            }
            className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-full bg-surface-container-lowest border border-outline text-on-surface hover:bg-surface-container disabled:opacity-40"
            aria-label={isHebrew ? "פחות" : "Less"}
          >
            <Minus className="h-5 w-5" strokeWidth={2.5} />
          </button>
          {/* The dark scoreboard input is also a real <input>. Tap
              or click to type the number directly — useful on
              mobile (inputMode="numeric" surfaces the numeric
              keypad) and for entering large numbers like total-
              goals predictions where +/- would be tedious. Focus
              ring makes the editable affordance obvious. */}
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            min={min}
            max={max}
            enterKeyHint="done"
            value={value?.type === "number" ? value.value : ""}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d-]/g, "");
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
            onFocus={(e) => e.currentTarget.select()}
            disabled={disabled}
            placeholder="0"
            aria-label={
              isHebrew
                ? `הקלד מספר בין ${min} ל-${max}`
                : `Type a number between ${min} and ${max}`
            }
            className={clsx(
              "w-24 md:w-28 h-14 md:h-16 text-center cursor-text",
              "font-[family-name:var(--font-score)] text-3xl md:text-4xl font-bold tabular-nums",
              "bg-[#1C140F] text-[#FBF6EB] placeholder:text-[#FBF6EB]/30",
              "border-2 border-outline rounded-lg transition-colors",
              "hover:border-[#FBF6EB]/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40",
              "disabled:opacity-60 disabled:cursor-not-allowed",
              "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            )}
            dir="ltr"
          />
          <button
            type="button"
            disabled={disabled || current >= max}
            onClick={() =>
              onChange({ type: "number", value: Math.min(max, current + 1) })
            }
            className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-full bg-surface-container-lowest border border-outline text-on-surface hover:bg-surface-container disabled:opacity-40"
            aria-label={isHebrew ? "יותר" : "More"}
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          {c?.unit && <LabelCaps>{c.unit}</LabelCaps>}
          <span className="text-[10px] text-on-surface-variant">
            {isHebrew
              ? `הקש או השתמש בכפתורים · טווח ${min}–${max}`
              : `Tap to type or use the buttons · range ${min}–${max}`}
          </span>
        </div>
      </div>
    );
  }

  if (bet.answerType === "multi_choice") {
    // Bets with `dynamicSource` (e.g. tournament top-scorer over the
    // full 1,357-player roster) load their option list from the API
    // at render time — see DynamicPickerWidget below. Static
    // multi_choice bets keep the pill-grid / dropdown threshold logic.
    const dynamicSource =
      cfg.kind === "multi_choice" ? cfg.dynamicSource : undefined;
    if (dynamicSource) {
      return (
        <DynamicPickerWidget
          source={dynamicSource}
          locale={locale}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    }
    const opts: MultiChoiceOption[] =
      cfg.kind === "multi_choice" ? cfg.options : [];
    const current = value?.type === "multi_choice" ? value.value : null;
    // Long lists become a searchable single-select dropdown — pill
    // grids stop being usable once you have to scroll through them
    // (48 WC teams, ~1,200 players).
    if (opts.length > SEARCHABLE_THRESHOLD) {
      return (
        <SearchableChoicePicker
          options={opts}
          currentValue={current}
          locale={locale}
          disabled={disabled}
          placeholder={isHebrew ? "בחר תשובה…" : "Pick an answer…"}
          onChange={(v) =>
            onChange(v == null ? null : { type: "multi_choice", value: v })
          }
        />
      );
    }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {opts.map((o) => (
          <ChoicePill
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
          </ChoicePill>
        ))}
      </div>
    );
  }

  // free_text
  const c = cfg.kind === "free_text" ? cfg : null;
  const placeholder = isHebrew ? c?.placeholderHe : c?.placeholderEn;
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
      placeholder={placeholder ?? (isHebrew ? "התשובה שלך" : "Your answer")}
      dir={isHebrew ? "rtl" : "ltr"}
      className="min-h-[48px] w-full px-3 rounded border border-outline bg-surface-container-lowest text-base"
    />
  );
}

// Tournament-scope bets with `dynamicSource: "players"` hydrate the
// option list from /api/picker-options at render time. Keeps the
// bet's answer_config JSONB small (no 1,357-row payload per bet) and
// lets the LIST itself update server-side (squad re-sync, translation
// fixes) without rewriting every bet record.
function DynamicPickerWidget({
  source,
  locale,
  value,
  onChange,
  disabled,
}: {
  source: DynamicOptionSource;
  locale: Locale;
  value: PickAnswer | null;
  onChange: (v: PickAnswer | null) => void;
  disabled?: boolean;
}) {
  const isHebrew = locale === "he";
  const { options, loading, error } = usePickerOptions(source, locale);
  const current = value?.type === "multi_choice" ? value.value : null;

  if (loading) {
    return (
      <div
        className="w-full min-h-[52px] px-4 inline-flex items-center justify-start rounded-full border border-outline bg-surface-container-lowest text-on-surface-variant text-sm"
        aria-busy="true"
      >
        {isHebrew ? "טוען רשימה…" : "Loading…"}
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full min-h-[52px] px-4 inline-flex items-center justify-start rounded-full border border-error bg-error-container text-on-error-container text-sm">
        {isHebrew ? "טעינה נכשלה - סגור ופתח מחדש" : "Failed to load — close and reopen"}
      </div>
    );
  }

  return (
    <SearchableChoicePicker
      options={options}
      currentValue={current}
      locale={locale}
      disabled={disabled}
      placeholder={isHebrew ? "בחר שחקן…" : "Pick a player…"}
      lazyChunkSize={10}
      onChange={(v) =>
        onChange(v == null ? null : { type: "multi_choice", value: v })
      }
    />
  );
}

function ChoicePill({
  children,
  active,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
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

function translateError(
  err: string,
  isHebrew: boolean,
  res: { needed?: number },
): string {
  const map: Record<string, [string, string]> = {
    unauth:            ["יש להתחבר", "Sign in required"],
    not_paid:          ["תשלום עדיין לא אושר", "Payment not approved yet"],
    bet_not_found:     ["ההימור לא נמצא", "Bet not found"],
    bet_not_open:      ["ההימור עדיין לא פתוח להגשה", "Bet isn't open yet"],
    bet_locked:        ["ההימור נסגר. לא ניתן לעדכן.", "Bet locked"],
    invalid_answer:    ["תשובה לא תקינה", "Invalid answer"],
    insufficient_bank:
      res.needed && res.needed > 0
        ? [`חסר: ${res.needed} נק'`, `Need ${res.needed} more pts`]
        : ["אין מספיק נקודות בבנק", "Not enough points in bank"],
    db:                ["שגיאת שמירה", "Save failed"],
  };
  return (map[err] ?? ["שגיאה", "Error"])[isHebrew ? 0 : 1];
}
