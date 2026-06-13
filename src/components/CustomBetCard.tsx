"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Info,
  Lock,
  Minus,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { Card, Chip, LabelCaps, MatchupLabel } from "@/components/ui";
import { SearchableChoicePicker } from "@/components/SearchableChoicePicker";
import { LocksInCountdown } from "@/components/LocksInCountdown";
import { formatDateTime } from "@/lib/format";
import {
  translateError as translateErrorCode,
  type LocalizedTuple,
} from "@/lib/error-i18n";
import type { Locale } from "@/app/[lang]/dictionaries";
import type {
  AnswerConfig,
  DynamicOptionSource,
  MultiChoiceOption,
  PickAnswer,
} from "@/lib/bets/types";
import { usePickerOptions } from "@/lib/picker-options/client";
import { usePendingAction } from "@/lib/use-pending-action";
import { withTimeout, SAVE_TIMEOUT_MS } from "@/lib/with-timeout";
import { resolvePickPayoutAtSubmit } from "@/lib/bets/payout";
import {
  liveOptionPayout,
  resolvePricingMode,
  resolveYesNoSideOdds,
} from "@/lib/bets/price-options";
import { isFreePickScope } from "@/lib/bets/free-pick-scopes";
import { liveStakeCap } from "@/lib/odds-normalize";
import type { LiveStakeUiConfig } from "@/lib/bank";
import { PickScenarios } from "@/components/PickScenarios";
import {
  cancelCustomBetPick,
  submitCustomBetPick,
} from "@/app/[lang]/play/[date]/actions";

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
  // The bet's scope. Determines whether the pick is free
  // (tournament/stage/group → no stake debit, "ללא עלות" copy) or
  // priced (match/day → standard live-odds stake). See
  // src/lib/bets/free-pick-scopes.ts.
  scope: "match" | "day" | "stage" | "group" | "tournament";
  stakeSnapshot: number;
  payoutSnapshot: number;
  // Bookmaker decimal odds (string from numeric col) captured at publish
  // for live (match/day) bets. Used by the stake picker to mirror the
  // server's variable-stake payout calc exactly. Tournament/stage/group
  // bets keep this null — their pricing comes from the outright curve.
  decimalOdds?: string | null;
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
  liveStakeConfig,
  maxOverdraft = 0,
  lockedFromBetting = false,
}: {
  locale: Locale;
  bet: CustomBetCardData;
  bankBalance: number;
  // Server computes this once per render so the client doesn't have to
  // call Date.now() (which React 19 lint rules flag as impure).
  editable: boolean;
  // Live-bet stake bounds + payout cap formula. Required when the bet's
  // scope is `match` or `day`; ignored for free-pick scopes. The parent
  // page reads it via getLiveStakeConfig() and threads it through every
  // card so the pill row + payout preview match the server byte-for-byte.
  liveStakeConfig?: LiveStakeUiConfig;
  // Negative-balance feature props. `maxOverdraft` shifts the overdrawn
  // floor from 0 to `-maxOverdraft` so live bets that dip into a
  // controlled overdraft still submit. `lockedFromBetting` mirrors the
  // server guard for the "already negative" case; when true, live-bet
  // submit is blocked client-side too with a clear explanation.
  // Both default to "feature off" so existing call sites stay correct.
  // See _plans/2026-06-11-negative-balance-lock.md.
  maxOverdraft?: number;
  lockedFromBetting?: boolean;
}) {
  const isHebrew = locale === "he";

  // The "current" answer the player has selected. Starts as their saved
  // pick if any, otherwise an empty draft of the right shape.
  const [draft, setDraft] = useState<PickAnswer | null>(bet.myAnswer);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [cancelFlash, setCancelFlash] = useState(false);
  // Two-step destructive confirm: tap "Cancel pick" → strip flips to
  // "Sure? [Yes] [No]". A second deliberate tap is what actually fires
  // the destructive action. Keeps cancel discoverable without making a
  // misclick destroy a thoughtful pick.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const { pending, run } = usePendingAction();

  // Sync the draft from the server when fresh props arrive (e.g. after
  // the "Surprise me" / deadline auto-fill / monkey-bot fill updated the
  // pick out-of-band and the parent re-fetched). useState only seeds on
  // first mount, so without this the widget would still show "no answer"
  // even though the DB now holds an answer. We track local edits via a
  // ref so that a user mid-tap on the widget isn't clobbered by a stray
  // re-render. The ref is reset after every successful save, so the next
  // server update flows through.
  const userEditedRef = useRef(false);
  useEffect(() => {
    if (userEditedRef.current) return;
    setDraft(bet.myAnswer);
  }, [bet.myAnswer]);
  const editDraft = (next: PickAnswer | null) => {
    userEditedRef.current = true;
    setDraft(next);
  };

  // Tournament/stage/group bets are free picks: stake is forced to 0
  // regardless of what bet.stakeSnapshot says, in case a legacy record
  // slipped through with a non-zero value.
  const isFreePick = isFreePickScope(bet.scope);

  // Player-chosen stake for live (match/day) bets. Seeded from the
  // player's last saved choice (if any) or the bet's snapshotted default,
  // then constrained by the admin's [minStake, maxStake] range. Free-pick
  // scopes ignore this entirely.
  const stakeDefault = bet.myStakePaid ?? bet.stakeSnapshot;
  const initialStake = isFreePick
    ? 0
    : liveStakeConfig
      ? clampStake(stakeDefault, liveStakeConfig.minStake, liveStakeConfig.maxStake)
      : stakeDefault;
  const [chosenStake, setChosenStake] = useState<number>(initialStake);

  // Resync the chosen stake when fresh server props arrive (auto-fill,
  // monkey bot, server revalidate), unless the user has un-saved edits.
  useEffect(() => {
    if (userEditedRef.current) return;
    setChosenStake(initialStake);
  }, [initialStake]);

  const effectiveStake = isFreePick ? 0 : chosenStake;
  const refund = bet.myStakePaid ?? 0;
  // If the draft is "empty" the user hasn't expressed a choice yet, so the
  // submit-cost is 0 (we render submit disabled in that case anyway).
  const hasChoice = !!draft;
  const newCost = hasChoice ? effectiveStake : 0;
  const effective = bankBalance + refund;
  const bankAfter = effective - newCost;
  // Overdraft floor: free picks never overdraw; live picks may dip to
  // `-maxOverdraft` per the negative-balance feature. `lockedFromBetting`
  // is a separate "you're already in the negative" gate — handled below.
  const overdraftFloor = isFreePick ? 0 : -maxOverdraft;
  const overdrawn = hasChoice && bankAfter < overdraftFloor;
  // Negative-balance lock applies only to priced (live) picks. Free picks
  // are the recovery path back to a positive bank, so they stay enabled.
  const locked = !isFreePick && lockedFromBetting;

  // Recompute the gross payout for the chosen stake (live bets only).
  // Free-pick scopes fall back to the legacy per-option resolver.
  const grossPayout = computeDisplayPayout(bet, draft, chosenStake, liveStakeConfig);
  const stakeDirty = !isFreePick && chosenStake !== (bet.myStakePaid ?? bet.stakeSnapshot);
  const dirty =
    JSON.stringify(draft ?? null) !== JSON.stringify(bet.myAnswer ?? null) ||
    stakeDirty;

  const onChosenStake = (next: number) => {
    userEditedRef.current = true;
    setChosenStake(next);
  };

  const onCancel = () => {
    if (!editable || pending || !bet.myAnswer) return;
    setError(null);
    setSavedFlash(false);
    setCancelFlash(false);
    void run(async () => {
      const res = await withTimeout(
        cancelCustomBetPick(bet.id),
        SAVE_TIMEOUT_MS,
      ).catch(() => null);
      if (!res) {
        setError(isHebrew ? "הביטול נתקע. נסה שוב." : "Cancel timed out. Try again.");
        setConfirmingCancel(false);
        return;
      }
      if (!res.ok) {
        setError(translateCancelError(res.error, isHebrew));
        setConfirmingCancel(false);
        return;
      }
      // The server cleared the row. Drop the local draft so the answer
      // widget renders "no answer" instead of showing the value we just
      // asked the server to delete. Reset chosenStake to the bet's
      // default so the pill row reads as a fresh choice.
      userEditedRef.current = false;
      setDraft(null);
      setChosenStake(initialStake);
      setConfirmingCancel(false);
      setCancelFlash(true);
    });
  };

  const onSubmit = () => {
    if (!draft || !editable || overdrawn || locked || pending) return;
    setError(null);
    setSavedFlash(false);
    setCancelFlash(false);
    // usePendingAction releases the button on the action response, not
    // on submitCustomBetPick's revalidation re-render, so submitting
    // several bets in a row never leaves one stuck on "שומר…". withTimeout
    // is the backstop for the other failure mode — the server never
    // responding at all (pooler saturated) — so the button still releases
    // instead of hanging. The write is an idempotent overwrite, so a retry
    // after a false-timeout cannot double-save.
    void run(async () => {
      // Only send a stake for live (priced) bets — free picks ignore it
      // on the server but it's clearer to omit at the boundary.
      const stakeArg = isFreePick ? undefined : chosenStake;
      const res = await withTimeout(
        submitCustomBetPick(bet.id, draft, stakeArg),
        SAVE_TIMEOUT_MS,
      ).catch(() => null);
      if (!res) {
        setError(isHebrew ? "השמירה נתקעה. נסה שוב." : "Save timed out. Try again.");
        return;
      }
      if (!res.ok) {
        setError(translateError(res.error, isHebrew, res));
        return;
      }
      // Drop the "user has unsaved edits" guard so the next server-side
      // change (Surprise me / auto-fill / monkey) flows back into draft.
      userEditedRef.current = false;
      setSavedFlash(true);
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
              {(() => {
                // The scope label may already be plain text ("Matchday",
                // "Group A") or a "<HOME> vs <AWAY>" matchup string. The
                // matchup form gets rendered through MatchupLabel so the
                // home code sits on the same side as the home team does
                // everywhere else (right in Hebrew, left in English),
                // instead of being frozen LTR by Latin-only text.
                const m = bet.scopeLabel.match(/^(.+?)\s+(?:vs|נגד)\s+(.+)$/);
                return m ? (
                  <MatchupLabel home={m[1]} away={m[2]} locale={locale} />
                ) : (
                  bet.scopeLabel
                );
              })()}
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
          {/* Discoverability: tell the user explicitly that picks are
              fluid until the bet closes. The cancel button itself only
              appears once a pick is saved (you can't cancel what isn't
              there), so without this line a first-time user thinks the
              "save" decision is final. Modify/cancel verbs are voiced
              in the same order they appear on screen — answer pills to
              the left (change), trash button to the right (cancel). */}
          {editable && (
            <span className="text-[11px] text-on-surface-variant/80 text-end leading-tight">
              {isHebrew
                ? "ניתן לשנות או לבטל עד הסגירה"
                : "Can change or cancel until close"}
            </span>
          )}
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
        onChange={editDraft}
        disabled={!editable || pending}
      />

      {/* Player-chosen stake picker (live scope only). Rendered above
          the scenarios so the live preview reacts to the same numbers
          the player sees on the pills. Free-pick scopes skip the row
          entirely — their cost is fixed at 0. */}
      {!isFreePick && liveStakeConfig && (
        <StakePicker
          locale={locale}
          value={chosenStake}
          baseStake={bet.stakeSnapshot}
          config={liveStakeConfig}
          disabled={!editable || pending}
          onChange={onChosenStake}
        />
      )}

      {/* "How the payout is calculated" — tap-to-expand explainer.
          Live scope only; free-pick bets already render "ללא עלות"
          on the summary so there's nothing to explain there. */}
      {!isFreePick && liveStakeConfig && (
        <PayoutExplainer
          locale={locale}
          bet={bet}
          draft={draft}
          chosenStake={chosenStake}
          config={liveStakeConfig}
        />
      )}

      {/* Scenarios: shows current bank, post-stake balance, and the
          balance under each possible outcome. The "if correct" delta is
          computed against the chosen stake for live bets so the pill
          row and the bank preview agree. Free-pick scopes use the
          per-option resolver (outright curves). */}
      {/* Scenarios always render the prospective stake row, even before the
          user has tapped an answer pill — that's the row that makes "אם תטעה"
          read as a loss of the staked points (post-stake balance) instead
          of misleadingly showing 0 → currentBalance. Free-pick scopes still
          get stake=0 because their cost is genuinely zero. */}
      <PickScenarios
        locale={locale}
        currentBalance={effective}
        stake={effectiveStake}
        scenarios={[
          {
            label: isHebrew ? "אם תפגע" : "If correct",
            delta: grossPayout,
            tone: "positive",
          },
          {
            label: isHebrew ? "אם תטעה" : "If wrong",
            delta: 0,
            tone: "neutral",
          },
        ]}
      />

      {/* Stake/payout + submit */}
      <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-3 pt-3 border-t border-outline-variant">
        <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm text-on-surface-variant">
          {isFreePick ? (
            <span className="font-bold text-on-surface">
              {isHebrew ? "ללא עלות" : "Free"}
            </span>
          ) : (
            <span>
              {isHebrew ? "סיכון" : "Risk"}:{" "}
              <bdi className="tabular-nums font-bold text-on-surface">
                {effectiveStake}
              </bdi>
            </span>
          )}
          <span aria-hidden className="opacity-40">·</span>
          <span>
            {isHebrew ? "זכייה אפשרית" : "Potential win"}:{" "}
            <bdi className="tabular-nums font-bold text-on-surface">
              +{Math.max(0, grossPayout - effectiveStake)}
            </bdi>
          </span>
          {hasChoice && dirty && newCost > 0 && (
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
          {cancelFlash && !error && (
            <p className="inline-flex items-center gap-1.5 text-xs text-secondary">
              <Check className="h-3 w-3" strokeWidth={2.5} />
              {isHebrew ? "הניחוש בוטל" : "Pick cancelled"}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Cancel pick — only when there's a saved pick and the bet
                is still editable. The two-step confirm strip prevents a
                misclick from destroying a thoughtful pick. */}
            {bet.myAnswer && editable && !confirmingCancel && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSavedFlash(false);
                  setCancelFlash(false);
                  setConfirmingCancel(true);
                }}
                disabled={pending}
                className={clsx(
                  "press-down inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-full text-sm font-bold transition-colors",
                  "bg-surface-container-lowest text-error border border-error/40",
                  "hover:bg-error-container hover:border-error",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
                aria-label={isHebrew ? "בטל את הניחוש" : "Cancel pick"}
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
                {isHebrew ? "בטל ניחוש" : "Cancel pick"}
              </button>
            )}
            {bet.myAnswer && editable && confirmingCancel && (
              <div
                role="group"
                aria-label={isHebrew ? "אישור ביטול" : "Confirm cancel"}
                className="inline-flex items-center gap-2 rounded-full bg-error-container/40 border border-error/40 ps-3 pe-1 py-1"
              >
                <span className="text-xs font-bold text-error">
                  {isHebrew ? "בטוח?" : "Sure?"}
                </span>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={pending}
                  className={clsx(
                    "press-down inline-flex items-center justify-center gap-1 min-h-9 px-3 rounded-full text-xs font-bold transition-colors",
                    "bg-error text-on-error hover:bg-error/90",
                    "disabled:opacity-60 disabled:cursor-not-allowed",
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  {pending
                    ? isHebrew ? "מבטל…" : "Cancelling…"
                    : isHebrew ? "כן, בטל" : "Yes, cancel"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={pending}
                  className={clsx(
                    "press-down inline-flex items-center justify-center gap-1 min-h-9 px-3 rounded-full text-xs font-bold transition-colors",
                    "bg-surface-container-lowest text-on-surface border border-outline hover:bg-surface-container",
                    "disabled:opacity-60 disabled:cursor-not-allowed",
                  )}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                  {isHebrew ? "השאר" : "Keep"}
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={!editable || pending || overdrawn || locked || !hasChoice || !dirty}
              className={clsx(
                "press-down inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-full text-sm font-bold transition-colors",
                "bg-primary text-on-primary shadow-md hover:bg-surface-tint",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary",
              )}
            >
              {pending && !confirmingCancel
                ? isHebrew ? "שומר…" : "Saving…"
                : locked
                  ? isHebrew ? "נעול: יתרה שלילית" : "Locked: negative bank"
                  : overdrawn
                    ? isHebrew ? "חורג מתקרת המינוס" : "Past overdraft cap"
                    : bet.myAnswer
                      ? isHebrew ? "עדכן ניחוש" : "Update pick"
                      : isHebrew ? "שמור ניחוש" : "Save pick"}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------- Stake picker (live scope only) ----------

// Pre-defined stake stops. Filtered against [minStake, maxStake] at render
// so an admin who lowers the max simply hides the higher pills — the row
// stays narrow enough to fit a 360px viewport with all 6 visible.
const STAKE_STOPS = [1, 3, 5, 10, 20, 30] as const;

function StakePicker({
  locale,
  value,
  baseStake,
  config,
  disabled,
  onChange,
}: {
  locale: Locale;
  value: number;
  baseStake: number;
  config: LiveStakeUiConfig;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  const isHebrew = locale === "he";
  const stops = STAKE_STOPS.filter(
    (s) => s >= config.minStake && s <= config.maxStake,
  );
  // Always surface the baseStake even if it's not on the canonical stop
  // list (e.g. admin set it to 4). Insert it in sorted position so the
  // pill order stays ascending.
  const stopsWithBase = Array.from(new Set([...stops, baseStake])).sort(
    (a, b) => a - b,
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wide">
          {isHebrew ? "כמה לסכן?" : "How much to risk?"}
        </span>
        <span className="text-xs text-on-surface-variant tabular-nums">
          {isHebrew
            ? `${config.minStake}–${config.maxStake} נק׳`
            : `${config.minStake}–${config.maxStake} pts`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {stopsWithBase.map((stop) => {
          const active = stop === value;
          const isDefault = stop === baseStake;
          return (
            <button
              key={stop}
              type="button"
              disabled={disabled}
              onClick={() => onChange(stop)}
              aria-pressed={active}
              aria-label={
                isHebrew
                  ? `סכן ${stop} נקודות${isDefault ? " (ברירת מחדל)" : ""}`
                  : `Risk ${stop} points${isDefault ? " (default)" : ""}`
              }
              className={clsx(
                "press-down min-h-11 min-w-11 px-3 inline-flex items-center justify-center gap-1 rounded-full border text-sm font-bold tabular-nums transition-colors",
                active
                  ? "bg-primary text-on-primary border-primary shadow-sm"
                  : "bg-surface-container-lowest text-on-surface border-outline hover:border-primary",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {stop}
              {isDefault && (
                <span
                  aria-hidden
                  className={clsx(
                    "text-[10px] font-bold",
                    active ? "text-on-primary/80" : "text-on-surface-variant",
                  )}
                >
                  ★
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Payout explainer (live scope only) ----------

// Example stakes shown in the explainer table. Filtered against the
// admin's [minStake, maxStake] range so an admin who lowers max sees a
// shorter row. Same shape as the StakePicker stops so the table reads
// like a continuation of the pill row above.
const EXPLAINER_STAKES = [1, 3, 5, 10, 20, 30] as const;

function PayoutExplainer({
  locale,
  bet,
  draft,
  chosenStake,
  config,
}: {
  locale: Locale;
  bet: CustomBetCardData;
  draft: PickAnswer | null;
  chosenStake: number;
  config: LiveStakeUiConfig;
}) {
  const isHebrew = locale === "he";
  const [open, setOpen] = useState(false);

  // The decimal odds we'll quote in the explainer. For multi_choice, this
  // is the odds of the currently-picked option (so the math the player
  // sees matches their choice). For yes/no, it's the bet-level value.
  // Null if neither is known — the panel still works, but talks about
  // the snapshot scaling instead of the exact formula.
  const oddsForExplainer = lookupLiveOptionOdds(bet, draft);
  const edgeFactor = (100 - config.houseEdgePct) / 100;
  // Ratio mode pays stake × ratio exactly — no house edge, no cap — so the
  // edge factor and cap rows below would misrepresent the math. Branch the
  // formula and hide those rows when the bet is priced on a manual ratio.
  const isRatioMode = resolvePricingMode(bet.answerConfig) === "ratio";

  const stakes = EXPLAINER_STAKES.filter(
    (s) => s >= config.minStake && s <= config.maxStake,
  );
  const examples = stakes.map((stake) => ({
    stake,
    netWin: Math.max(0, computeDisplayPayout(bet, draft, stake, config) - stake),
  }));

  const formulaLine = isRatioMode
    ? oddsForExplainer != null
      ? isHebrew
        ? `זכייה = סיכון × ${oddsForExplainer.toFixed(2)}`
        : `Payout = stake × ${oddsForExplainer.toFixed(2)}`
      : isHebrew
        ? `זכייה = סיכון × יחס`
        : `Payout = stake × ratio`
    : oddsForExplainer != null
      ? isHebrew
        ? `זכייה ברוטו = סיכון × ${oddsForExplainer.toFixed(2)} × ${edgeFactor.toFixed(2)}`
        : `Gross payout = stake × ${oddsForExplainer.toFixed(2)} × ${edgeFactor.toFixed(2)}`
      : isHebrew
        ? `זכייה ברוטו = סיכון × יחס × ${edgeFactor.toFixed(2)}`
        : `Gross payout = stake × odds × ${edgeFactor.toFixed(2)}`;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="self-start min-h-11 inline-flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface"
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2} />
        <span className="font-bold">
          {isHebrew ? "איך הזכייה מחושבת?" : "How the payout is calculated"}
        </span>
        <ChevronDown
          className={clsx(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-180",
          )}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-2 rounded-lg bg-surface-container-low border border-outline-variant p-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-on-surface-variant">
            {oddsForExplainer != null && (
              <span>
                {isHebrew ? "יחס" : "Odds"}:{" "}
                <bdi className="tabular-nums font-bold text-on-surface">
                  {oddsForExplainer.toFixed(2)}
                </bdi>
              </span>
            )}
            {isRatioMode ? (
              <span>
                {isHebrew
                  ? "יחס קבוע · ללא ניכוי בית · ללא תקרה"
                  : "Fixed ratio · no house edge · no cap"}
              </span>
            ) : (
              <>
                <span>
                  {isHebrew ? "ניכוי בית" : "House edge"}:{" "}
                  <bdi className="tabular-nums font-bold text-on-surface">
                    {config.houseEdgePct}%
                  </bdi>
                </span>
                <span>
                  {isHebrew ? "תקרת זכייה" : "Payout cap"}:{" "}
                  <bdi className="tabular-nums font-bold text-on-surface">
                    {config.maxPayoutCeiling > 0
                      ? isHebrew
                        ? `מינ׳(סיכון × ${config.maxPayoutRatio}, ${config.maxPayoutCeiling})`
                        : `min(stake × ${config.maxPayoutRatio}, ${config.maxPayoutCeiling})`
                      : isHebrew
                        ? `סיכון × ${config.maxPayoutRatio}`
                        : `stake × ${config.maxPayoutRatio}`}
                  </bdi>
                </span>
              </>
            )}
          </div>

          <div className="text-on-surface" dir="ltr">
            <code className="text-[11px] font-[family-name:var(--font-mono),monospace]">
              {formulaLine}
            </code>
          </div>

          <div className="border-t border-outline-variant pt-2">
            <div className="text-on-surface-variant mb-1.5">
              {isHebrew
                ? "זכייה נקייה לפי סכום סיכון:"
                : "Net win per stake amount:"}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {examples.map((ex) => {
                const active = ex.stake === chosenStake;
                return (
                  <div
                    key={ex.stake}
                    className={clsx(
                      "rounded px-2 py-1.5 text-center tabular-nums",
                      active
                        ? "bg-primary text-on-primary font-bold"
                        : "bg-surface-container-lowest text-on-surface",
                    )}
                  >
                    <div
                      className={clsx(
                        "text-[10px]",
                        active ? "text-on-primary/85" : "text-on-surface-variant",
                      )}
                    >
                      {isHebrew ? `סיכון ${ex.stake}` : `risk ${ex.stake}`}
                    </div>
                    <div className="text-sm font-bold">+{ex.netWin}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Compute the gross payout to show in the scenarios + summary. For live
// bets this mirrors the server's writeCustomPickTx variable-stake path
// byte-for-byte (normalizeOdds + liveStakeCap with the same config). For
// free picks it falls back to the per-option resolver.
function computeDisplayPayout(
  bet: CustomBetCardData,
  draft: PickAnswer | null,
  stake: number,
  config: LiveStakeUiConfig | undefined,
): number {
  const isFreePick = isFreePickScope(bet.scope);
  const fallbackAnswer = draft ?? ({ type: "yes_no", value: false } as PickAnswer);
  if (isFreePick || !config) {
    return resolvePickPayoutAtSubmit({
      answerType: bet.answerType,
      answerConfig: bet.answerConfig,
      answer: fallbackAnswer,
      betLevelPayout: bet.payoutSnapshot,
    });
  }
  const odds = lookupLiveOptionOdds(bet, draft);
  const cap = liveStakeCap(stake, config);
  if (odds != null) {
    // Mirror the server: ratio-mode bets pay stake × ratio exactly (no
    // edge/cap), probability-mode bets run normalizeOdds. resolvePricingMode
    // defaults to probability for every legacy/free-pick config.
    const mode = resolvePricingMode(bet.answerConfig);
    return liveOptionPayout(odds, stake, mode, {
      baseStake: stake,
      maxPayout: cap,
      houseEdgePct: config.houseEdgePct,
    });
  }
  // Legacy fallback: scale the bet's snapshotted payout linearly.
  const basePayout = resolvePickPayoutAtSubmit({
    answerType: bet.answerType,
    answerConfig: bet.answerConfig,
    answer: fallbackAnswer,
    betLevelPayout: bet.payoutSnapshot,
  });
  const baseStakeForScale = Math.max(1, bet.stakeSnapshot);
  const scaled = Math.round((basePayout * stake) / baseStakeForScale);
  return Math.min(Math.max(scaled, stake + 1), cap);
}

function lookupLiveOptionOdds(
  bet: CustomBetCardData,
  draft: PickAnswer | null,
): number | null {
  if (bet.answerType === "multi_choice" && draft?.type === "multi_choice") {
    const cfg = bet.answerConfig.kind === "multi_choice" ? bet.answerConfig : null;
    const v = cfg?.decimalOddsByValue?.[draft.value];
    if (typeof v === "number" && Number.isFinite(v) && v > 1) return v;
    return null;
  }
  if (bet.answerType === "yes_no" && draft?.type === "yes_no") {
    const cfg = bet.answerConfig.kind === "yes_no" ? bet.answerConfig : null;
    const sideOdds = resolveYesNoSideOdds(cfg, draft.value);
    if (sideOdds != null) return sideOdds;
    // No per-side odds — fall through to the shared bet-level value.
  }
  if (bet.decimalOdds) {
    const n = Number(bet.decimalOdds);
    if (Number.isFinite(n) && n > 1) return n;
  }
  return null;
}

function clampStake(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const n = Math.floor(value);
  if (n < min) return min;
  if (n > max) return max;
  return n;
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
    const payoutOverridesByValue =
      cfg.kind === "multi_choice" ? cfg.payoutOverridesByValue : undefined;
    if (dynamicSource) {
      return (
        <DynamicPickerWidget
          source={dynamicSource}
          locale={locale}
          value={value}
          onChange={onChange}
          disabled={disabled}
          payoutOverridesByValue={payoutOverridesByValue}
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
  payoutOverridesByValue,
}: {
  source: DynamicOptionSource;
  locale: Locale;
  value: PickAnswer | null;
  onChange: (v: PickAnswer | null) => void;
  disabled?: boolean;
  // Per-option payout map written by the tournament-odds publish
  // flow. When present we splice the matching payout into each
  // option's subtitle so users see "Mbappé · payout 7" vs
  // "ben­ch player · payout 25" inside the picker — making the
  // longshot premium visible at pick time.
  payoutOverridesByValue?: Record<string, number>;
}) {
  const isHebrew = locale === "he";
  const { options, loading, error } = usePickerOptions(source, locale);
  const current = value?.type === "multi_choice" ? value.value : null;

  // Decorate hydrated options with the per-option payout label when
  // we have a price map. The original subtitle (jersey / position)
  // gets kept and the payout chip joins it with a separator.
  const decoratedOptions = useMemo(() => {
    if (!payoutOverridesByValue || options.length === 0) return options;
    const labelHe = "תשלום";
    const labelEn = "payout";
    return options.map((o) => {
      const p = payoutOverridesByValue[o.value];
      if (typeof p !== "number" || !Number.isFinite(p)) return o;
      const tagHe = `${labelHe} ${p}`;
      const tagEn = `${labelEn} ${p}`;
      return {
        ...o,
        subtitleHe: o.subtitleHe ? `${o.subtitleHe} · ${tagHe}` : tagHe,
        subtitleEn: o.subtitleEn ? `${o.subtitleEn} · ${tagEn}` : tagEn,
      };
    });
  }, [options, payoutOverridesByValue]);

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
      options={decoratedOptions}
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

function translateCancelError(err: string, isHebrew: boolean): string {
  // Cancel reuses most of submitCustomBetPick's error codes (auth /
  // payment / lock / not-found / db) plus one cancel-specific outcome:
  // "nothing_to_cancel" when the row vanished between render and click
  // (e.g. another tab already cancelled it). The submit path can never
  // hit that branch, so it lives only here.
  const map: Record<string, LocalizedTuple> = {
    unauth:             ["יש להתחבר", "Sign in required"],
    not_paid:           ["תשלום עדיין לא אושר", "Payment not approved yet"],
    bet_not_found:      ["ההימור לא נמצא", "Bet not found"],
    bet_not_open:       ["ההימור עדיין לא פתוח", "Bet isn't open yet"],
    bet_locked:         ["ההימור נסגר. לא ניתן לבטל.", "Bet locked"],
    nothing_to_cancel:  ["אין ניחוש לבטל", "No pick to cancel"],
    db:                 ["שגיאת ביטול", "Cancel failed"],
    unknown:            ["שגיאה", "Error"],
  };
  return translateErrorCode(err in map ? err : "unknown", map, isHebrew);
}

function translateError(
  err: string,
  isHebrew: boolean,
  res: { needed?: number },
): string {
  // The insufficient_bank line embeds the dynamic "needed" amount, so
  // it's computed per-call rather than hoisted to a module-level map.
  const map: Record<string, LocalizedTuple> = {
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
    unknown:           ["שגיאה", "Error"],
  };
  return translateErrorCode(err in map ? err : "unknown", map, isHebrew);
}
