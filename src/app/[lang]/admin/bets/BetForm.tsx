"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, RotateCcw, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { Chip, PillButton, LabelCaps } from "@/components/ui";
import {
  COMMON_ADMIN_ERRORS,
  translateAdminError,
  type LocalizedTuple,
} from "@/lib/admin/errors";
import {
  formatDateTime,
  isoToLocalInputValue,
  localInputValueToIso,
} from "@/lib/format";
import { localePath } from "@/lib/paths";
import { daysFromNow } from "@/lib/time";
import type { Locale } from "../../dictionaries";
import type {
  AnswerConfig,
  AutoApiFootballStat,
  GradingConfig,
  PricingMode,
} from "@/lib/bets/types";
import type { EventMetric, EventOp } from "@/lib/bets/events-grade";
import { isFreePickScope } from "@/lib/bets/free-pick-scopes";
import { liveStakeCap, normalizeOdds, type OddsNormConfig } from "@/lib/odds-normalize";
import {
  liveOptionPayout,
  MAX_MANUAL_RATIO,
  priceOptionsFromProbabilities,
  priceYesNo,
  resolvePricingMode,
} from "@/lib/bets/price-options";
import type { AdminAnchorMatch, AdminAnchorDay, BetTemplate } from "@/db/admin-queries";
import type { BetTypeKey } from "@/db/schema";
import { useAutoTranslate } from "@/lib/use-auto-translate";
import { AutoTranslateHint } from "@/components/AutoTranslateHint";
import { useAutosave } from "@/lib/use-autosave";
import { usePendingAction } from "@/lib/use-pending-action";
import { withTimeout, SAVE_TIMEOUT_MS } from "@/lib/with-timeout";
import { toast } from "@/lib/toast";
import { SaveStatus } from "@/components/SaveStatus";
import { createCustomBet, publishCustomBet, updateCustomBet } from "./actions";

// Build payload type, shared by createCustomBet (arg 0) and updateCustomBet
// (arg 1) — both take the same CreateCustomBetInput shape.
type BetPayload = Parameters<typeof createCustomBet>[0];
type BuildResult =
  | { ok: true; payload: BetPayload }
  | { ok: false; error: string };

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
  | "went_to_penalties"
  | "went_to_extra_time"
  | "advancing_team"
  | "btts"
  | "home_scored"
  | "away_scored"
  | "clean_sheet_home"
  | "clean_sheet_away"
  | "first_half_goal"
  | "second_half_goal"
  | "both_halves_scored"
  | "over_0_5_goals"
  | "over_1_5_goals"
  | "over_2_5_goals"
  | "over_3_5_goals"
  | "over_4_5_goals"
  | "winning_margin"
  | "second_half_total";

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
  // Live-bet pricing knobs — drive the decimal-odds → stake/payout
  // preview for match/day scopes and mirror the user-side payout cap
  // math byte-for-byte.
  liveOddsBaseStake: number;
  liveOddsHouseEdgePct: number;
  liveOddsMaxPayoutRatio: number;
  liveOddsMaxPayoutCeiling: number;
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
  // Bookmaker decimal odds as a NUMERIC-mapped string (e.g. "2.50"), or
  // null when the bet pre-dates the variable-stake feature or is a
  // free-pick scope. Edit-mode seeds the form from this.
  decimalOdds: string | null;
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
  templates,
  returnQs,
}: {
  locale: Locale;
  anchorMatches: AdminAnchorMatch[];
  anchorDays: AdminAnchorDay[];
  groupIds: string[];
  defaults: Defaults | undefined;
  mode?: "create" | "edit";
  betId?: string;
  initialBet?: InitialBet;
  // Sanitized bets-list filter query (e.g. "status=draft&matchday=...") carried
  // in via the edit page's `?return=`. After save/publish the form returns to
  // the filtered list so the admin lands back where they were — no hunting for
  // the bet they just edited. Undefined → plain list.
  returnQs?: string;
  // Past custom_bets the admin can clone into this new draft. Server
  // pre-fetches them; the picker swaps the form's text/grading state on
  // selection. Edit mode hides the picker (mutating a draft we're
  // editing would clobber whatever the admin came in to fix).
  templates?: BetTemplate[];
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

  // Auto-translate: when the admin types Hebrew and leaves the field,
  // fill the English counterpart if it's still empty. Manual edits are
  // never clobbered (the hook re-checks isEnglishEmpty before applying).
  const questionTranslate = useAutoTranslate({
    context: "question",
    isEnglishEmpty: () => questionEn.trim().length === 0,
    onTranslate: setQuestionEn,
  });
  const ruleTranslate = useAutoTranslate({
    context: "rule",
    isEnglishEmpty: () => gradingRuleEn.trim().length === 0,
    onTranslate: setGradingRuleEn,
  });

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
  // Seed each option's probability (live-scope pricing) from the stored
  // decimal odds when editing — p = 1 / odds, shown as a whole percent.
  // Falls back to "" so a fresh draft prompts the admin to fill it.
  const [mcOptions, setMcOptions] = useState<McOption[]>(
    initialMc?.options?.map((o) => ({
      value: o.value,
      labelHe: o.labelHe,
      labelEn: o.labelEn,
      probability: oddsToPercentString(initialMc.decimalOddsByValue?.[o.value]),
      ratio: oddsToRatioString(initialMc.decimalOddsByValue?.[o.value]),
    })) ?? [
      { value: "", labelHe: "", labelEn: "", probability: "", ratio: "" },
      { value: "", labelHe: "", labelEn: "", probability: "", ratio: "" },
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

  // Yes-probability for live (match/day) yes/no bets, as a whole-percent
  // string. Drives priceYesNo so each side prices on its own odds instead
  // of sharing one bet-level number. Seeded from decimalOddsYes when
  // editing; empty on a fresh draft.
  const initialYesNo =
    initialBet?.answerConfig.kind === "yes_no" ? initialBet.answerConfig : null;
  const [yesProbability, setYesProbability] = useState<string>(
    oddsToPercentString(initialYesNo?.decimalOddsYes),
  );

  // Live pricing mode (match/day multi-choice + yes/no). "probability" is
  // the default: a % per option that the system renormalises + prices via
  // normalizeOdds (house edge + cap). "ratio" lets the admin type the
  // multiplier directly — the player wins stake × ratio with no edge/cap.
  // Seeded from whichever live config the bet carries. See
  // _plans/2026-06-13-live-bet-manual-ratio.md.
  const [pricingMode, setPricingMode] = useState<PricingMode>(
    resolvePricingMode(initialMc ?? initialYesNo ?? null),
  );
  // Per-side ratios for a live yes/no in ratio mode. Seeded from the stored
  // per-side odds (which ARE the ratios in ratio mode).
  const [yesRatio, setYesRatio] = useState<string>(
    oddsToRatioString(initialYesNo?.decimalOddsYes),
  );
  const [noRatio, setNoRatio] = useState<string>(
    oddsToRatioString(initialYesNo?.decimalOddsNo),
  );

  // ---- Pricing (scope-aware) ----
  //
  // Three modes, picked by the bet's scope:
  //   • Live (match/day) with decimal_odds   → admin enters the bookmaker
  //     odds; the form auto-computes stake (= liveOddsBaseStake) and the
  //     payout via normalizeOdds. This is the path that gives the user-
  //     facing bet card exact variable-stake math.
  //   • Live (match/day) without decimal_odds → falls back to manual
  //     stake/payout entry. Submit-time math then linearly scales from
  //     this snapshot — works but with rounding drift at non-default
  //     stakes (logged on the server as `no_odds_fallback`).
  //   • Free pick (tournament/stage/group)   → stake is force-zero at
  //     submit time; the form only collects payout as a flat fallback for
  //     bets without per-option pricing.
  const isLiveScope = scope === "match" || scope === "day";
  const isFreePickFormScope = isFreePickScope(scope);

  const defaultStakePayout = useMemo(() => {
    if (!defaults) return { stake: 1, payout: 3 };
    switch (answerType) {
      case "yes_no":       return { stake: defaults.stakeYesNo,        payout: defaults.payoutYesNo };
      case "number":       return { stake: defaults.stakeNumber,       payout: defaults.payoutNumber };
      case "multi_choice": return { stake: defaults.stakeMultiChoice,  payout: defaults.payoutMultiChoice };
      case "free_text":    return { stake: defaults.stakeFreeText,     payout: defaults.payoutFreeText };
    }
  }, [answerType, defaults]);

  const [decimalOddsInput, setDecimalOddsInput] = useState<string>(
    initialBet?.decimalOdds ?? "",
  );

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

  // Parse the live decimal-odds input and, when valid, derive the
  // stake/payout the user-facing card will land on at the default ★ pill.
  // Same math as src/lib/odds-normalize.ts so admin and player agree.
  const parsedDecimalOdds = useMemo(() => {
    if (!isLiveScope) return null;
    const trimmed = decimalOddsInput.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 1) return null;
    return n;
  }, [decimalOddsInput, isLiveScope]);

  const liveOddsPreview = useMemo(() => {
    if (parsedDecimalOdds == null || !defaults) return null;
    const { stake: previewStake, payout: previewPayout } = normalizeOdds(
      parsedDecimalOdds,
      {
        baseStake: defaults.liveOddsBaseStake,
        maxPayout: liveStakeCap(defaults.liveOddsBaseStake, {
          maxPayoutRatio: defaults.liveOddsMaxPayoutRatio,
          maxPayoutCeiling: defaults.liveOddsMaxPayoutCeiling,
        }),
        houseEdgePct: defaults.liveOddsHouseEdgePct,
      },
    );
    return { stake: previewStake, payout: previewPayout };
  }, [parsedDecimalOdds, defaults]);

  // Shared pricing config for the probability→odds path (live multi-choice
  // and live yes/no). Same baseStake / cap / edge the user-facing card
  // uses at the default ★ pill, so the admin preview matches what a player
  // sees when they stake the default amount.
  const livePricingConfig = useMemo(() => {
    if (!defaults) return null;
    return {
      baseStake: defaults.liveOddsBaseStake,
      maxPayout: liveStakeCap(defaults.liveOddsBaseStake, {
        maxPayoutRatio: defaults.liveOddsMaxPayoutRatio,
        maxPayoutCeiling: defaults.liveOddsMaxPayoutCeiling,
      }),
      houseEdgePct: defaults.liveOddsHouseEdgePct,
    };
  }, [defaults]);

  // Per-option live pricing for a multi-choice exotic market. Two modes:
  //   - probability: parse each option's %, renormalise + price via the
  //     shared module (house edge + cap).
  //   - ratio: parse each option's typed multiplier and price it exactly
  //     (stake × ratio, no edge/cap) and independently — no renormalisation.
  // Returns an array aligned to mcOptions; an entry is null when that option
  // has no usable value yet (so the chip just doesn't render for it), and
  // the whole memo is null until at least one option is priced. So the UI
  // degrades cleanly in both modes.
  const isLiveMultiChoice = isLiveScope && answerType === "multi_choice";
  const liveMcPricing = useMemo<
    Array<{ payout: number; decimalOdds: number; probability: number } | null> | null
  >(() => {
    if (!isLiveMultiChoice || !livePricingConfig) return null;
    if (pricingMode === "ratio") {
      const ratios = mcOptions.map((o) => parseRatio(o.ratio));
      if (!ratios.some((r) => r != null)) return null;
      return ratios.map((r) =>
        r == null
          ? null
          : {
              payout: liveOptionPayout(r, livePricingConfig.baseStake, "ratio", livePricingConfig),
              decimalOdds: r,
              probability: 1 / r,
            },
      );
    }
    const parsed = mcOptions.map((o) => ({
      value: o.value.trim(),
      probability: parsePercent(o.probability),
    }));
    if (!parsed.some((p) => p.probability != null)) return null;
    const priced = priceOptionsFromProbabilities(
      parsed.map((p) => ({
        value: p.value || "_",
        probability: p.probability ?? 0,
      })),
      livePricingConfig,
    );
    return priced.map((pr) => ({
      payout: pr.payout,
      decimalOdds: pr.decimalOdds,
      probability: pr.probability,
    }));
  }, [isLiveMultiChoice, livePricingConfig, mcOptions, pricingMode]);

  // Per-side live pricing for a yes/no exotic market.
  const isLiveYesNo = isLiveScope && answerType === "yes_no";
  const parsedYesProbability = useMemo(
    () => parsePercent(yesProbability),
    [yesProbability],
  );
  const parsedYesRatio = useMemo(() => parseRatio(yesRatio), [yesRatio]);
  const parsedNoRatio = useMemo(() => parseRatio(noRatio), [noRatio]);
  // Shape kept identical across modes so the render reads one object:
  // per-side decimal odds + payout, each null when that side isn't priced
  // yet (only possible in ratio mode — probability derives both sides from
  // one number). null until at least one side is priced.
  const liveYesNoPricing = useMemo<
    {
      decimalOddsYes: number | null;
      decimalOddsNo: number | null;
      payoutYes: number | null;
      payoutNo: number | null;
    } | null
  >(() => {
    if (!isLiveYesNo || !livePricingConfig) return null;
    if (pricingMode === "ratio") {
      if (parsedYesRatio == null && parsedNoRatio == null) return null;
      const priceSide = (r: number | null) =>
        r == null ? null : liveOptionPayout(r, livePricingConfig.baseStake, "ratio", livePricingConfig);
      return {
        decimalOddsYes: parsedYesRatio,
        decimalOddsNo: parsedNoRatio,
        payoutYes: priceSide(parsedYesRatio),
        payoutNo: priceSide(parsedNoRatio),
      };
    }
    if (parsedYesProbability == null) return null;
    const yn = priceYesNo(parsedYesProbability, livePricingConfig);
    return {
      decimalOddsYes: yn.decimalOddsYes,
      decimalOddsNo: yn.decimalOddsNo,
      payoutYes: yn.payoutYes,
      payoutNo: yn.payoutNo,
    };
  }, [
    isLiveYesNo,
    livePricingConfig,
    pricingMode,
    parsedYesProbability,
    parsedYesRatio,
    parsedNoRatio,
  ]);

  // Snap stake/payout to the computed preview when decimal_odds is the
  // source of truth — keeps the saved snapshot consistent with what the
  // user-facing card will show at the default pill.
  if (liveOddsPreview && (stake !== liveOddsPreview.stake || payout !== liveOddsPreview.payout)) {
    setStake(liveOddsPreview.stake);
    setPayout(liveOddsPreview.payout);
  }

  const liveFallbackStake = defaults?.liveOddsBaseStake ?? 3;

  // Live multi-choice / yes-no priced from probabilities OR ratios: the
  // bet-level snapshot stake is the base stake and the snapshot payout is
  // the HIGHEST priced outcome. Per-option/per-side payouts live in
  // answer_config; this bet-level pair is only the grade/fallback anchor.
  // Filters out unpriced (null) entries so a partially-filled ratio market
  // still produces a sensible max from whatever is priced.
  const livePricedPayouts: number[] = liveMcPricing
    ? liveMcPricing.flatMap((p) => (p ? [p.payout] : []))
    : liveYesNoPricing
      ? [liveYesNoPricing.payoutYes, liveYesNoPricing.payoutNo].filter(
          (p): p is number => p != null,
        )
      : [];
  const liveProbMaxPayout =
    livePricedPayouts.length > 0 ? Math.max(...livePricedPayouts) : null;

  if (liveProbMaxPayout != null) {
    if (stake !== liveFallbackStake) setStake(liveFallbackStake);
    if (payout !== liveProbMaxPayout) setPayout(liveProbMaxPayout);
  }

  // Live scope without any odds/probability yet — snap to the live default
  // stake (settings.liveOddsBaseStake) so the saved snapshot still
  // represents a sensible default ★ pill. Payout falls back to the
  // answer-type default (yes/no=3, etc.) which the linear-scale
  // fallback path in write-core then uses as the scaling baseline.
  if (isLiveScope && !liveOddsPreview && liveProbMaxPayout == null && stake !== liveFallbackStake) {
    setStake(liveFallbackStake);
  }
  if (isLiveScope && !liveOddsPreview && liveProbMaxPayout == null && payout !== defaultStakePayout.payout) {
    setPayout(defaultStakePayout.payout);
  }

  // Free-pick scopes ignore stake at submit, but the DB still accepts a
  // value. Force it to 0 so a stale form field doesn't write a misleading
  // number to the row.
  if (isFreePickFormScope && stake !== 0) {
    setStake(0);
  }

  if (!stakeTouched && !liveOddsPreview && !isFreePickFormScope && !isLiveScope && stake !== defaultStakePayout.stake) {
    setStake(defaultStakePayout.stake);
  }
  if (!payoutTouched && !liveOddsPreview && !isLiveScope && payout !== defaultStakePayout.payout) {
    setPayout(defaultStakePayout.payout);
  }

  // ---- Grading ----
  const [gradingSource, setGradingSource] = useState<GradingSource>(
    initialBet?.gradingSource ?? "manual",
  );
  // Only the stats variant of auto_api_football seeds these fields; the
  // events variant has no stat/aggregate (it carries an `events` spec).
  const initialAf =
    initialBet?.gradingConfig?.source === "auto_api_football" &&
    "stat" in initialBet.gradingConfig
      ? initialBet.gradingConfig
      : null;
  const [autoAfStat, setAutoAfStat] = useState<string>(initialAf?.stat ?? "corners");
  const [autoAfAgg, setAutoAfAgg] = useState<"sum_day" | "per_match" | "first_match">(
    initialAf?.aggregate ?? "per_match",
  );
  // Event-timeline variant of auto_api_football (red-in-half, goal-in-
  // window). Seeded when editing a bet that already carries an `events`
  // spec, so an LLM-generated event bet keeps its auto-grading on save.
  const initialAfEvents =
    initialBet?.gradingConfig?.source === "auto_api_football" &&
    "events" in initialBet.gradingConfig
      ? initialBet.gradingConfig.events
      : null;
  const [autoAfMode, setAutoAfMode] = useState<"stats" | "events">(
    initialAfEvents ? "events" : "stats",
  );
  const [evMetric, setEvMetric] = useState<string>(initialAfEvents?.metric ?? "red_card");
  const initialWindow = initialAfEvents?.window;
  const [evWindowKind, setEvWindowKind] = useState<"1H" | "2H" | "FT" | "range">(
    typeof initialWindow === "object" ? "range" : (initialWindow ?? "1H"),
  );
  const [evFrom, setEvFrom] = useState<string>(
    typeof initialWindow === "object" ? String(initialWindow.fromMinute) : "1",
  );
  const [evTo, setEvTo] = useState<string>(
    typeof initialWindow === "object" ? String(initialWindow.toMinute) : "15",
  );
  const [evOp, setEvOp] = useState<string>(initialAfEvents?.op ?? ">=");
  const [evValue, setEvValue] = useState<string>(String(initialAfEvents?.value ?? 1));
  const [evTeam, setEvTeam] = useState<"home" | "away" | "any">(initialAfEvents?.team ?? "any");
  const initialFd =
    initialBet?.gradingConfig?.source === "auto_football_data"
      ? initialBet.gradingConfig
      : null;
  const [autoFdField, setAutoFdField] = useState<AutoFdField>(
    initialFd?.field ?? "total_goals",
  );
  // An LLM-authored auto_api_football rule this form has no editor for yet
  // (first-event-window distribution, comeback): it carries neither `stat`
  // nor `events`. Editing such a draft's wording must NOT silently rewrite the
  // grading to a stats config, so we hold the original and re-emit it on save
  // unless the admin explicitly asks to replace it.
  const initialAdvancedConfig =
    initialBet?.gradingConfig?.source === "auto_api_football" &&
    !("stat" in initialBet.gradingConfig) &&
    !("events" in initialBet.gradingConfig)
      ? initialBet.gradingConfig
      : null;
  const [replaceAdvanced, setReplaceAdvanced] = useState(false);

  // ---- Templates (create-mode only) ----
  //
  // Apply a past bet onto the in-flight form by swapping the
  // question + grading-rule + answer-type + answer-config + grading
  // source/config. Pricing / scope / anchor / lock_at stay as-is so
  // the admin's current target match doesn't get blown away.
  const applyTemplate = (t: BetTemplate) => {
    setQuestionHe(t.questionHe);
    setQuestionEn(t.questionEn);
    setGradingRuleHe(t.gradingRuleHe);
    setGradingRuleEn(t.gradingRuleEn);
    setAnswerType(t.answerType);

    // Re-seed the answer-config widgets based on the template's shape.
    const cfg = t.answerConfig as AnswerConfig | undefined;
    if (cfg?.kind === "number") {
      setNumberUnit(cfg.unit ?? "");
      setNumberMin(cfg.min !== undefined ? String(cfg.min) : "");
      setNumberMax(cfg.max !== undefined ? String(cfg.max) : "");
    }
    // Carry the template's pricing mode so a ratio-priced template clones
    // into ratio mode (and its odds seed the ratio inputs below).
    setPricingMode(resolvePricingMode(cfg ?? null));
    if (cfg?.kind === "multi_choice") {
      setMcOptions(
        cfg.options.length > 0
          ? cfg.options.map((o) => ({
              value: o.value,
              labelHe: o.labelHe,
              labelEn: o.labelEn,
              probability: oddsToPercentString(cfg.decimalOddsByValue?.[o.value]),
              ratio: oddsToRatioString(cfg.decimalOddsByValue?.[o.value]),
            }))
          : [
              { value: "", labelHe: "", labelEn: "", probability: "", ratio: "" },
              { value: "", labelHe: "", labelEn: "", probability: "", ratio: "" },
            ],
      );
    }
    if (cfg?.kind === "yes_no") {
      setYesProbability(oddsToPercentString(cfg.decimalOddsYes));
      setYesRatio(oddsToRatioString(cfg.decimalOddsYes));
      setNoRatio(oddsToRatioString(cfg.decimalOddsNo));
    }
    if (cfg?.kind === "free_text") {
      setFreeTextPlaceholderHe(cfg.placeholderHe ?? "");
      setFreeTextPlaceholderEn(cfg.placeholderEn ?? "");
    }

    setGradingSource(t.gradingSource);
    const gc = t.gradingConfig as GradingConfig | undefined;
    if (gc?.source === "auto_api_football" && "stat" in gc) {
      setAutoAfStat(gc.stat);
      setAutoAfAgg(gc.aggregate);
    } else if (gc?.source === "auto_football_data") {
      setAutoFdField(gc.field);
    }
  };

  // ---- Lock time ----
  // suggestDefaultLockAt reads Date.now() in its fallback branch, so the
  // React lint rule won't let us wrap this in useMemo. Compute it inline
  // every render - it's a few field reads, not expensive - and rely on
  // the `lockTouched` flag below to avoid stomping admin's manual input.
  const defaultLockAt = initialBet?.lockAt
    ? isoToLocalInputValue(initialBet.lockAt)
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

  // Build + validate the full payload from the current form state. PURE — no
  // setState — so it's safe to call during render to drive both the explicit
  // submit and the draft autosave. Returns a typed error string rather than
  // surfacing it; each caller decides what to do (inline error vs. wait for
  // the form to become valid).
  const buildPayload = (): BuildResult => {
    const built = buildAnswerConfig(
      answerType,
      { numberUnit, numberMin, numberMax },
      mcOptions,
      { freeTextPlaceholderHe, freeTextPlaceholderEn },
    );
    if (built === "invalid") {
      return {
        ok: false,
        error: isHebrew ? "תצורת תשובה לא תקינה" : "Invalid answer config",
      };
    }

    // Embed per-choice live pricing derived from the admin's probabilities.
    // Returns "incomplete" when some-but-not-all options carry a
    // probability — partial pricing would silently flatten the rest, the
    // very bug we're fixing, so block it with a clear message.
    let answerConfig: AnswerConfig = built;
    let betLevelDecimalOdds: number | null = isLiveScope ? parsedDecimalOdds : null;
    if (isLiveScope && livePricingConfig) {
      const priced = embedLivePricing(
        built,
        mcOptions,
        yesProbability,
        yesRatio,
        noRatio,
        pricingMode,
        livePricingConfig,
      );
      if (priced === "incomplete") {
        return {
          ok: false,
          error:
            pricingMode === "ratio"
              ? isHebrew
                ? "מלא יחס לכל האפשרויות (או השאר את כולן ריקות)."
                : "Fill a ratio for every option (or leave them all empty)."
              : isHebrew
                ? "מלא הסתברות לכל האפשרויות (או השאר את כולן ריקות)."
                : "Fill a probability for every option (or leave them all empty).",
        };
      }
      if (priced) {
        answerConfig = priced;
        // Per-option/per-side pricing supersedes a single bet-level odds.
        betLevelDecimalOdds = null;
      }
    }

    const gradingConfig = buildGradingConfig(
      gradingSource,
      {
        advancedConfig: replaceAdvanced ? null : initialAdvancedConfig,
        autoAfStat,
        autoAfAgg,
        autoFdField,
        autoAfMode,
        ev: {
          metric: evMetric,
          windowKind: evWindowKind,
          from: evFrom,
          to: evTo,
          op: evOp,
          value: evValue,
          team: evTeam,
        },
      },
    );
    if (gradingConfig === "invalid") {
      return {
        ok: false,
        error: isHebrew ? "תצורת דירוג לא תקינה" : "Invalid grading config",
      };
    }

    // Reinterpret the widget value as Asia/Jerusalem wall time. Using
    // `new Date(lockAtLocal).toISOString()` would treat the string as
    // the BROWSER's local timezone, which silently breaks the lock time
    // for any admin editing from outside IL.
    const lockAtIso = localInputValueToIso(lockAtLocal);
    if (!lockAtIso) {
      return {
        ok: false,
        error: isHebrew ? "זמן סגירה לא תקין" : "Invalid lock time",
      };
    }

    return {
      ok: true,
      payload: {
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
        // Only live scopes ship a decimal_odds value, and only when pricing
        // is a single outcome (number/free-text). Per-option/per-side priced
        // bets carry their odds inside answer_config and null this out. The
        // server re-asserts the scope gate and rejects a stray value on
        // free-pick scopes.
        decimalOdds: betLevelDecimalOdds,
        gradingSource,
        gradingConfig,
        lockAt: lockAtIso,
      },
    };
  };

  // Current build, recomputed each render. Drives the Done button, the
  // autosave-valid gate, and the inline draft-status hint. draftKey is a
  // stable string that only changes when the built payload (or its validity)
  // changes — the trigger for the draft autosave effect below.
  const draftBuild = buildPayload();
  const draftKey = draftBuild.ok
    ? JSON.stringify(draftBuild.payload)
    : `invalid:${draftBuild.error}`;

  // ---- Draft autosave (create + edit) ----
  // All writes go through here, single-flight, so the draft can't be created
  // twice. Edit mode updates the existing draft. Create mode creates the draft
  // the first time the form is valid, remembers its id, and updates that same
  // draft thereafter — so authoring a bet is zero clicks. Only valid payloads
  // reach here (the trigger effect skips invalid mid-edit states), and
  // create/update enforce draft-only + permissions server-side. Publishing to
  // users stays a separate, explicit action elsewhere.
  const createdIdRef = useRef<string | null>(null);
  const saveDraft = useCallback(
    async (payload: BetPayload): Promise<boolean> => {
      const id = betId ?? createdIdRef.current;
      if (id) {
        const res = await withTimeout(
          updateCustomBet(id, payload),
          SAVE_TIMEOUT_MS,
        ).catch(() => null);
        if (!res) {
          toast.error(
            isHebrew
              ? "השמירה האוטומטית נכשלה. נסה שוב."
              : "Autosave failed. Try again.",
          );
          return false;
        }
        if (!res.ok) {
          toast.error(translateError(res.error, isHebrew));
          return false;
        }
        return true;
      }
      // No id yet → create the draft once and remember it for later saves.
      const res = await withTimeout(
        createCustomBet(payload),
        SAVE_TIMEOUT_MS,
      ).catch(() => null);
      if (!res) {
        toast.error(
          isHebrew
            ? "יצירת הטיוטה נכשלה. נסה שוב."
            : "Draft creation failed. Try again.",
        );
        return false;
      }
      if (!res.ok) {
        toast.error(translateError(res.error, isHebrew));
        return false;
      }
      createdIdRef.current = res.id;
      return true;
    },
    [betId, isHebrew],
  );
  const {
    status: draftStatus,
    schedule: scheduleDraftSave,
    retry: retryDraftSave,
    flush: flushDraftSave,
    cancel: cancelDraftSave,
  } = useAutosave<BetPayload>({ save: saveDraft });

  // Hold the latest build for the trigger effect without reading it during
  // that effect's render (refs lint rule). This effect runs before the
  // trigger effect below, so the ref is current when it fires.
  const draftBuildRef = useRef(draftBuild);
  useEffect(() => {
    draftBuildRef.current = draftBuild;
  });

  // Fire the autosave whenever the built payload changes — valid only,
  // skipping the initial render (a loaded draft is already saved; a fresh
  // create form starts invalid anyway, so nothing fires until it's complete).
  // Covers create (auto-create once valid) and edit (update). useAutosave
  // debounces + coalesces, so a run through several fields is one write.
  const firstDraftRender = useRef(true);
  useEffect(() => {
    if (firstDraftRender.current) {
      firstDraftRender.current = false;
      return;
    }
    const built = draftBuildRef.current;
    if (!built.ok) return;
    scheduleDraftSave(built.payload);
  }, [draftKey, scheduleDraftSave]);

  // Where save/publish/back return to. In edit mode that's the bets LIST with
  // the admin's filters restored (carried in via returnQs), so they land back
  // exactly where they were instead of hunting for the bet they just touched.
  const listHref =
    localePath(locale, "admin/bets") + (returnQs ? `?${returnQs}` : "");

  // The form no longer "saves" on submit — autosave handles every write. The
  // submit button flushes any pending debounced save and navigates. In edit
  // mode it returns to the filtered list (the previous screen); in create mode
  // it goes to the new bet's detail (or the list if it was never valid). An
  // invalid form stays put and surfaces the reason instead of navigating away.
  const finish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftBuild.ok) {
      setError(draftBuild.error);
      return;
    }
    setError(null);
    flushDraftSave();
    if (mode === "edit") {
      router.push(listHref);
      return;
    }
    const id = betId ?? createdIdRef.current;
    router.push(
      id
        ? localePath(locale, `admin/bets/${id}`)
        : localePath(locale, "admin/bets"),
    );
  };

  // Publish straight from the edit form: persist the latest edits, flip the
  // draft to open, then return to the filtered list. This removes the old
  // round trip (save → back to list → find the bet → publish). Save-first
  // guarantees the published bet reflects what's on screen; cancelDraftSave
  // drops any pending debounced autosave so it can't fire (and fail draft-only)
  // after the bet is already open.
  const { pending: publishing, run: runPublish } = usePendingAction();
  const publish = () => {
    if (!draftBuild.ok) {
      setError(draftBuild.error);
      return;
    }
    const id = betId ?? createdIdRef.current;
    if (!id) return;
    setError(null);
    cancelDraftSave();
    const payload = draftBuild.payload;
    void runPublish(async () => {
      const saveRes = await withTimeout(
        updateCustomBet(id, payload),
        SAVE_TIMEOUT_MS,
      ).catch(() => null);
      if (!saveRes || !saveRes.ok) {
        toast.error(
          saveRes
            ? translateError(saveRes.error, isHebrew)
            : isHebrew
              ? "השמירה נכשלה. נסה שוב."
              : "Save failed. Try again.",
        );
        return;
      }
      const pubRes = await withTimeout(
        publishCustomBet(id),
        SAVE_TIMEOUT_MS,
      ).catch(() => null);
      if (!pubRes || !pubRes.ok) {
        toast.error(
          pubRes
            ? translateError(pubRes.error, isHebrew)
            : isHebrew
              ? "הפרסום נכשל. נסה שוב."
              : "Publish failed. Try again.",
        );
        return;
      }
      toast.success(isHebrew ? "ההימור פורסם" : "Bet published");
      router.push(listHref);
    });
  };

  const cancelHref = mode === "edit" ? listHref : localePath(locale, "admin/bets");

  return (
    <form onSubmit={finish} className="flex flex-col gap-6 md:gap-8">
      {/* 0. Template picker (create-mode only). Hidden when editing —
          mutating a draft we came in to fix would silently throw away
          the unsaved tweaks the admin's mid-typing. */}
      {mode !== "edit" && templates && templates.length > 0 && (
        <Section
          title={isHebrew ? "טען מהימור קודם" : "Load from previous bet"}
          hint={
            isHebrew
              ? "בחר הימור קיים כדי להעתיק שאלה, כלל ניקוד, סוג תשובה ומקור דירוג. אם הוא מכיל {HOME}/{AWAY} או את שמות הקבוצות המקוריות, הטקסט יותאם אוטומטית למשחק הנוכחי."
              : "Pick a past bet to copy the question, grading rule, answer type, and grading source. {HOME}/{AWAY} placeholders and source team names get swapped to the current match automatically."
          }
        >
          <TemplatePicker
            locale={locale}
            templates={templates}
            onPick={applyTemplate}
          />
        </Section>
      )}

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
                {formatDateTime(m.kickoffAt, locale, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
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
                  {formatDateTime(d.date + "T12:00:00Z", locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
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
      <Section title={isHebrew ? "השאלה למשתתפים" : "Question for players"}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LabeledInput
            label="HE"
            value={questionHe}
            onChange={setQuestionHe}
            onBlur={() => questionTranslate.trigger(questionHe)}
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
            hint={<AutoTranslateHint state={questionTranslate.state} isHebrew={isHebrew} />}
          />
        </div>
      </Section>

      {/* 4. Grading rule (mandatory) */}
      <Section
        title={isHebrew ? "איך מודדים את התשובה?" : "How is this graded?"}
        hint={isHebrew
          ? "משפט אחד שאי-אפשר לפרש לרעה. מופיע למשתתפים לפני שהם מהמרים - זה המקום למנוע ויכוחים."
          : "One sentence that can't be misread. Shown to players before they stake - this is where you prevent fights."}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LabeledTextarea
            label="HE"
            value={gradingRuleHe}
            onChange={setGradingRuleHe}
            onBlur={() => ruleTranslate.trigger(gradingRuleHe)}
            required
            placeholder={isHebrew ? "למשל: כרטיס אדום אחד או יותר ב-90 הדקות (לא כולל הארכה) באחד המשחקים של היום." : "e.g."}
            dir="rtl"
          />
          <LabeledTextarea
            label="EN"
            value={gradingRuleEn}
            onChange={setGradingRuleEn}
            required
            placeholder="e.g. One or more red cards in regulation across today's matches."
            dir="ltr"
            hint={<AutoTranslateHint state={ruleTranslate.state} isHebrew={isHebrew} />}
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
        <Section
          title={isHebrew ? "אפשרויות בחירה" : "Choice options"}
          hint={
            isLiveMultiChoice
              ? pricingMode === "ratio"
                ? isHebrew
                  ? `תן יחס (כפולה) לכל אפשרות — למשל ×6 (טווח 1.01–${MAX_MANUAL_RATIO}). השחקן מקבל בדיוק סיכון × יחס, בלי עמלת בית ובלי תקרה. כל אפשרות עומדת בפני עצמה (אין נרמול ל-100%).`
                  : `Give each option a ratio (multiplier) — e.g. ×6 (range 1.01–${MAX_MANUAL_RATIO}). The player wins exactly stake × ratio, with no house edge and no cap. Each option stands on its own (no renormalising to 100%).`
                : isHebrew
                  ? "להימור לייב מקובץ (למשל ואר: מחצית 1 / מחצית 2 / אין): תן הסתברות באחוזים לכל אפשרות. המערכת מנרמלת אותן ל-100% ומחשבת יחס ותשלום נפרדים לכל בחירה — אפשרות סבירה משלמת מעט, אאוטסיידר משלם הרבה."
                  : "For a grouped live market (e.g. VAR: 1st half / 2nd half / none): give each option a probability %. The system renormalises to 100% and prices each choice on its own odds — likely outcomes pay little, longshots pay big."
              : undefined
          }
        >
          <div className="flex flex-col gap-3">
            {isLiveMultiChoice && (
              <PricingModeToggle
                mode={pricingMode}
                onChange={setPricingMode}
                isHebrew={isHebrew}
              />
            )}
            {mcOptions.map((opt, i) => {
              const priced = liveMcPricing?.[i];
              return (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-2 md:border-0 md:bg-transparent md:p-0"
                >
                  <div className="grid grid-cols-1 md:grid-cols-[80px_1fr_1fr_44px] gap-2 md:items-center">
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
                  {isLiveMultiChoice && (
                    <div className="flex items-end gap-3 ps-0 md:ps-[88px]">
                      <label className="flex flex-col gap-1.5">
                        <LabelCaps>
                          {pricingMode === "ratio"
                            ? isHebrew ? "יחס ×" : "Ratio ×"
                            : isHebrew ? "הסתברות %" : "Probability %"}
                        </LabelCaps>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={pricingMode === "ratio" ? opt.ratio : opt.probability}
                          onChange={(e) =>
                            updateMc(
                              i,
                              pricingMode === "ratio" ? "ratio" : "probability",
                              e.target.value,
                              mcOptions,
                              setMcOptions,
                            )
                          }
                          placeholder={pricingMode === "ratio" ? "6" : "33"}
                          dir="ltr"
                          className="min-h-[48px] w-24 px-3 rounded border border-outline bg-surface-container-lowest text-base font-bold tabular-nums focus:outline-none focus:border-primary"
                        />
                      </label>
                      {priced && (
                        <div className="flex items-center gap-2 pb-2 text-sm text-on-surface-variant">
                          <Chip className="tabular-nums">×{priced.decimalOdds}</Chip>
                          <span>
                            {isHebrew ? "תשלום" : "Pays"}{" "}
                            <bdi className="tabular-nums font-bold text-on-surface">
                              {priced.payout}
                            </bdi>
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() =>
                setMcOptions([
                  ...mcOptions,
                  { value: "", labelHe: "", labelEn: "", probability: "", ratio: "" },
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

      {/* 7. Pricing — scope-aware. Live (match/day) prefers decimal odds
          (variable-stake math); free pick hides stake; legacy path shows
          manual stake/payout fields when no odds are supplied. */}
      <Section
        title={isHebrew ? "תמחור" : "Pricing"}
        hint={
          isLiveMultiChoice
            ? pricingMode === "ratio"
              ? isHebrew
                ? "התמחור לכל אפשרות נקבע מהיחס שמילאת למעלה. כאן רק תצוגה מסכמת."
                : "Per-option pricing comes from the ratios you set above. This is just a summary."
              : isHebrew
                ? "התמחור לכל אפשרות נקבע מההסתברויות שמילאת למעלה. כאן רק תצוגה מסכמת."
                : "Per-option pricing comes from the probabilities you set above. This is just a summary."
            : isLiveYesNo
              ? pricingMode === "ratio"
                ? isHebrew
                  ? `תן יחס (כפולה) לכל צד — 'כן' ו'לא' (טווח 1.01–${MAX_MANUAL_RATIO}). השחקן מקבל בדיוק סיכון × יחס, בלי עמלת בית ובלי תקרה.`
                  : `Give a ratio (multiplier) for each side — yes and no (range 1.01–${MAX_MANUAL_RATIO}). The player wins exactly stake × ratio, with no house edge and no cap.`
                : isHebrew
                  ? "תן הסתברות באחוזים שהתשובה היא 'כן'. המערכת מתמחרת 'כן' ו'לא' בנפרד — כך 'לא יהיה ואר' (סביר) לא משלם כמו אאוטסיידר."
                  : "Give the probability the answer is 'yes'. The system prices yes and no separately, so a likely 'no' can't pay like a longshot."
              : isLiveScope
                ? isHebrew
                  ? "בהימור לייב השחקן בוחר בעצמו כמה לסכן (1-30). כל מה שצריך כאן זה ה-decimal odds — המערכת תחשב את ה-payout לכל סכום."
                  : "On a live bet the player picks how much to risk (1-30). Enter the bookmaker decimal odds — the system reprices the payout for every stake."
            : isFreePickFormScope
              ? isHebrew
                ? "הימור טורניר/שלב/בית הוא ללא עלות לשחקן. השדה למטה הוא רק fallback אם אין מחיר לכל אפשרות."
                : "Tournament/stage/group bets are free for the player. The field below is only a fallback when there's no per-option pricing."
              : isHebrew
                ? `ברירת המחדל לסוג תשובה זה: ${defaultStakePayout.stake} / ${defaultStakePayout.payout}.`
                : `Default for this answer type: stake ${defaultStakePayout.stake} / payout ${defaultStakePayout.payout}.`
        }
      >
        {/* Live multi-choice: pricing is per-option from the input above.
            Show a payout-range summary + a nudge if nothing is priced. */}
        {isLiveMultiChoice && (
          <div className="flex flex-col gap-2">
            {livePricedPayouts.length > 0 ? (
              <p className="text-sm text-on-surface-variant">
                {isHebrew ? "טווח תשלום" : "Payout range"}:{" "}
                <bdi className="tabular-nums font-bold text-on-surface">
                  {Math.min(...livePricedPayouts)}–{Math.max(...livePricedPayouts)}
                </bdi>{" "}
                {isHebrew
                  ? `(סיכון ברירת מחדל ${liveFallbackStake})`
                  : `(default risk ${liveFallbackStake})`}
              </p>
            ) : (
              <p className="text-xs text-tertiary-fixed-dim">
                {pricingMode === "ratio"
                  ? isHebrew
                    ? "מלא יחס לכל אפשרות למעלה כדי לתמחר."
                    : "Fill a ratio for each option above to price them."
                  : isHebrew
                    ? "מלא הסתברות לכל אפשרות למעלה כדי לתמחר. בלי הסתברויות, כל האפשרויות יקבלו את אותו תשלום (הבאג הישן)."
                    : "Fill a probability for each option above to price them. Without probabilities every option gets the same payout (the old bug)."}
              </p>
            )}
          </div>
        )}

        {/* Live yes/no. Probability mode: one yes-% drives both sides.
            Ratio mode: a ratio per side, priced exactly (stake × ratio). */}
        {isLiveYesNo && (
          <div className="flex flex-col gap-3">
            <PricingModeToggle
              mode={pricingMode}
              onChange={setPricingMode}
              isHebrew={isHebrew}
            />
            {pricingMode === "ratio" ? (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1.5">
                  <LabelCaps>{isHebrew ? "יחס ל'כן' ×" : "Yes ratio ×"}</LabelCaps>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="2"
                    value={yesRatio}
                    onChange={(e) => setYesRatio(e.target.value)}
                    className="min-h-[48px] w-24 px-3 rounded border border-outline bg-surface-container-lowest text-base font-bold tabular-nums focus:outline-none focus:border-primary"
                    dir="ltr"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <LabelCaps>{isHebrew ? "יחס ל'לא' ×" : "No ratio ×"}</LabelCaps>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="3"
                    value={noRatio}
                    onChange={(e) => setNoRatio(e.target.value)}
                    className="min-h-[48px] w-24 px-3 rounded border border-outline bg-surface-container-lowest text-base font-bold tabular-nums focus:outline-none focus:border-primary"
                    dir="ltr"
                  />
                </label>
              </div>
            ) : (
              <label className="flex flex-col gap-1.5">
                <LabelCaps>
                  {isHebrew ? "הסתברות ל'כן' %" : "Probability of yes %"}
                </LabelCaps>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="35"
                  value={yesProbability}
                  onChange={(e) => setYesProbability(e.target.value)}
                  className="min-h-[48px] w-24 px-3 rounded border border-outline bg-surface-container-lowest text-base font-bold tabular-nums focus:outline-none focus:border-primary"
                  dir="ltr"
                />
              </label>
            )}
            {liveYesNoPricing ? (
              <div className="flex items-center gap-3 text-sm text-on-surface-variant">
                {liveYesNoPricing.payoutYes != null && (
                  <span className="inline-flex items-center gap-1.5">
                    {isHebrew ? "כן" : "Yes"}
                    <Chip className="tabular-nums">×{liveYesNoPricing.decimalOddsYes}</Chip>
                    <bdi className="tabular-nums font-bold text-on-surface">{liveYesNoPricing.payoutYes}</bdi>
                  </span>
                )}
                {liveYesNoPricing.payoutNo != null && (
                  <span className="inline-flex items-center gap-1.5">
                    {isHebrew ? "לא" : "No"}
                    <Chip className="tabular-nums">×{liveYesNoPricing.decimalOddsNo}</Chip>
                    <bdi className="tabular-nums font-bold text-on-surface">{liveYesNoPricing.payoutNo}</bdi>
                  </span>
                )}
              </div>
            ) : (
              <p className="text-xs text-tertiary-fixed-dim">
                {pricingMode === "ratio"
                  ? isHebrew
                    ? "מלא יחס לשני הצדדים כדי לתמחר."
                    : "Fill a ratio for both sides to price them."
                  : isHebrew
                    ? "בלי הסתברות, שני הצדדים מקבלים אותו תשלום (הבאג הישן)."
                    : "Without a probability both sides get the same payout (the old bug)."}
              </p>
            )}
          </div>
        )}

        {/* Live number / free-text: single bookmaker odds drives the
            variable-stake math (one outcome, one price). */}
        {isLiveScope && !isLiveMultiChoice && !isLiveYesNo && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <LabelCaps>
                  {isHebrew ? "Decimal odds (בוקמייקר)" : "Decimal odds"}
                </LabelCaps>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="2.50"
                  value={decimalOddsInput}
                  onChange={(e) => setDecimalOddsInput(e.target.value)}
                  className="min-h-[48px] w-32 px-3 rounded border border-outline bg-surface-container-lowest text-base font-bold tabular-nums focus:outline-none focus:border-primary"
                  dir="ltr"
                />
              </label>
              {liveOddsPreview && (
                <div className="flex items-end gap-3 text-sm text-on-surface-variant pb-2">
                  <span>
                    {isHebrew ? "ברירת מחדל בכרטיס" : "Card default"}:{" "}
                    <bdi className="tabular-nums font-bold text-on-surface">
                      {liveOddsPreview.stake}
                    </bdi>{" "}
                    {isHebrew ? "סיכון" : "risk"} ·{" "}
                    <bdi className="tabular-nums font-bold text-on-surface">
                      +{Math.max(0, liveOddsPreview.payout - liveOddsPreview.stake)}
                    </bdi>{" "}
                    {isHebrew ? "זכייה" : "win"}
                  </span>
                </div>
              )}
            </div>
            {!parsedDecimalOdds && (
              <p className="text-xs text-tertiary-fixed-dim">
                {isHebrew
                  ? `בלי odds, ה-payout יחושב בקירוב לינארי על בסיס ברירת מחדל (${liveFallbackStake} סיכון / ${defaultStakePayout.payout} תשלום). מומלץ למלא תמיד.`
                  : `Without odds, payout falls back to linear scaling from a default snapshot (${liveFallbackStake} stake / ${defaultStakePayout.payout} payout). Filling it in is recommended.`}
              </p>
            )}
          </div>
        )}

        {/* Non-live scopes: keep the manual stake/payout entry. Free-pick
            scopes hide stake (forced to 0 server-side) and show only
            payout as the flat fallback for surfaces without per-option
            pricing. */}
        {!isLiveScope && (
          <div className="flex flex-wrap gap-3 items-end">
            {!isFreePickFormScope && (
              <NumberStepper
                label={isHebrew ? "עלות (stake)" : "Stake"}
                value={stake}
                onChange={(n) => { setStake(n); setStakeTouched(true); }}
                min={0}
              />
            )}
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
                  setStake(isFreePickFormScope ? 0 : defaultStakePayout.stake);
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
        )}
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
        <Section
          title={isHebrew ? "מה לדגום מהתוצאה?" : "Which field to read?"}
          hint={isHebrew
            ? "ההגדרה חייבת להתאים לסוג התשובה שבחרת — כן/לא לשדות yes/no, מספר לשדות number וכו'. אחרת ההימור יישאר ידני."
            : "Field must match the answer type you picked (yes/no for boolean fields, number for numeric, etc.). Mismatched bets fall back to manual grading."}
        >
          <select
            value={autoFdField}
            onChange={(e) => setAutoFdField(e.target.value as AutoFdField)}
            className="min-h-[48px] w-full px-3 rounded border border-outline bg-surface-container-lowest text-base"
          >
            <optgroup label={isHebrew ? "תוצאה כללית" : "General result"}>
              <option value="winner">            {isHebrew ? "מנצח (1/X/2) — בחירה" : "Winner (1/X/2) — multi-choice"}</option>
              <option value="ht_score">          {isHebrew ? "תוצאת מחצית מדויקת — בחירה" : "Exact halftime score — multi-choice"}</option>
              <option value="went_to_penalties"> {isHebrew ? "האם הוכרע בפנדלים — כן/לא" : "Went to penalties — yes/no"}</option>
            </optgroup>
            <optgroup label={isHebrew ? "נוקאאוט (כולל הארכות)" : "Knockout (incl. extra time)"}>
              <option value="went_to_extra_time"> {isHebrew ? "האם היו הארכות — כן/לא" : "Went to extra time — yes/no"}</option>
              <option value="advancing_team">     {isHebrew ? "מי עולה / מנצח בתיקו (1/2) — בחירה" : "Who advances (1/2) — multi-choice"}</option>
            </optgroup>
            <optgroup label={isHebrew ? "ספירת שערים" : "Goal counts"}>
              <option value="total_goals">       {isHebrew ? "סך השערים במשחק — מספר" : "Total goals in match — number"}</option>
              <option value="ht_total">          {isHebrew ? "סך השערים במחצית 1 — מספר" : "First-half total goals — number"}</option>
              <option value="second_half_total"> {isHebrew ? "סך השערים במחצית 2 — מספר" : "Second-half total goals — number"}</option>
              <option value="home_score">        {isHebrew ? "שערי הבית — מספר" : "Home goals — number"}</option>
              <option value="away_score">        {isHebrew ? "שערי החוץ — מספר" : "Away goals — number"}</option>
              <option value="winning_margin">    {isHebrew ? "הפרש שערים סופי — מספר" : "Winning margin — number"}</option>
            </optgroup>
            <optgroup label={isHebrew ? "מעל / מתחת לשערים" : "Over/Under goals"}>
              <option value="over_0_5_goals">    {isHebrew ? "מעל 0.5 שערים — כן/לא" : "Over 0.5 goals — yes/no"}</option>
              <option value="over_1_5_goals">    {isHebrew ? "מעל 1.5 שערים — כן/לא" : "Over 1.5 goals — yes/no"}</option>
              <option value="over_2_5_goals">    {isHebrew ? "מעל 2.5 שערים — כן/לא" : "Over 2.5 goals — yes/no"}</option>
              <option value="over_3_5_goals">    {isHebrew ? "מעל 3.5 שערים — כן/לא" : "Over 3.5 goals — yes/no"}</option>
              <option value="over_4_5_goals">    {isHebrew ? "מעל 4.5 שערים — כן/לא" : "Over 4.5 goals — yes/no"}</option>
            </optgroup>
            <optgroup label={isHebrew ? "BTTS וקבוצות" : "BTTS & per-team"}>
              <option value="btts">              {isHebrew ? "שתי הקבוצות יבקיעו (BTTS) — כן/לא" : "Both teams to score (BTTS) — yes/no"}</option>
              <option value="home_scored">       {isHebrew ? "האם הבית הבקיעה — כן/לא" : "Did home score — yes/no"}</option>
              <option value="away_scored">       {isHebrew ? "האם החוץ הבקיעה — כן/לא" : "Did away score — yes/no"}</option>
              <option value="clean_sheet_home">  {isHebrew ? "שער יבש לקבוצת הבית — כן/לא" : "Home kept clean sheet — yes/no"}</option>
              <option value="clean_sheet_away">  {isHebrew ? "שער יבש לקבוצת החוץ — כן/לא" : "Away kept clean sheet — yes/no"}</option>
            </optgroup>
            <optgroup label={isHebrew ? "מחציות" : "Halves"}>
              <option value="first_half_goal">   {isHebrew ? "שער במחצית 1 — כן/לא" : "Goal in 1st half — yes/no"}</option>
              <option value="second_half_goal">  {isHebrew ? "שער במחצית 2 — כן/לא" : "Goal in 2nd half — yes/no"}</option>
              <option value="both_halves_scored">{isHebrew ? "שער בשתי המחציות — כן/לא" : "Goal in both halves — yes/no"}</option>
            </optgroup>
          </select>
        </Section>
      )}

      {gradingSource === "auto_api_football" && (
        <Section
          title={isHebrew ? "מה לדגום מ-API-Football?" : "What to read from API-Football?"}
          hint={
            autoAfMode === "events"
              ? isHebrew
                ? "הכרעה מציר האירועים: סופרת אירוע (אדום/צהוב/גול/פנדל) בחלון זמן. רק להימורי כן/לא. ואר לא נתמך."
                : "Event-timeline grading: counts an event (card/goal/penalty) in a time window. Yes/no bets only. VAR not supported."
              : undefined
          }
        >
          {initialAdvancedConfig && !replaceAdvanced ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-on-surface-variant">
                {isHebrew
                  ? "הימור זה מוגדר עם כלל דירוג אוטומטי מתקדם (חלון אירוע ראשון / מהפך) שנוצר על ידי ה-AI. אפשר לערוך כאן ניסוח ותמחור, וכלל הדירוג יישמר כפי שהוא."
                  : "This bet uses an advanced auto-grading rule (first-event window / comeback) authored by the AI. Edit the wording and pricing here; the grading rule is preserved as-is."}
              </p>
              <button
                type="button"
                onClick={() => setReplaceAdvanced(true)}
                className="self-start text-xs underline text-on-surface-variant"
              >
                {isHebrew ? "החלף בכלל דירוג אחר" : "Replace with a different rule"}
              </button>
            </div>
          ) : (
          <div className="flex flex-col gap-3">
            <SegmentedRow
              options={[
                { value: "stats", label: isHebrew ? "סטטיסטיקה (מספר)" : "Stats (number)" },
                { value: "events", label: isHebrew ? "אירוע בחלון זמן" : "Event in window" },
              ]}
              value={autoAfMode}
              onChange={(v) => setAutoAfMode(v as "stats" | "events")}
            />

            {autoAfMode === "stats" ? (
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
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <LabelCaps>{isHebrew ? "אירוע" : "Event"}</LabelCaps>
                    <select
                      value={evMetric}
                      onChange={(e) => setEvMetric(e.target.value)}
                      className="min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base"
                    >
                      <option value="red_card">    {isHebrew ? "כרטיס אדום" : "Red card"}</option>
                      <option value="yellow_card"> {isHebrew ? "כרטיס צהוב" : "Yellow card"}</option>
                      <option value="card">        {isHebrew ? "כרטיס (כל סוג)" : "Card (any)"}</option>
                      <option value="goal">        {isHebrew ? "גול" : "Goal"}</option>
                      <option value="penalty">     {isHebrew ? "פנדל שהובקע" : "Penalty scored"}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <LabelCaps>{isHebrew ? "קבוצה" : "Team"}</LabelCaps>
                    <select
                      value={evTeam}
                      onChange={(e) => setEvTeam(e.target.value as "home" | "away" | "any")}
                      className="min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base"
                    >
                      <option value="any">  {isHebrew ? "כל קבוצה" : "Either team"}</option>
                      <option value="home"> {isHebrew ? "בית" : "Home"}</option>
                      <option value="away"> {isHebrew ? "חוץ" : "Away"}</option>
                    </select>
                  </label>
                </div>
                <label className="flex flex-col gap-1.5">
                  <LabelCaps>{isHebrew ? "חלון זמן" : "Time window"}</LabelCaps>
                  <SegmentedRow
                    options={[
                      { value: "1H", label: isHebrew ? "מחצית 1" : "1st half" },
                      { value: "2H", label: isHebrew ? "מחצית 2" : "2nd half" },
                      { value: "FT", label: isHebrew ? "כל המשחק" : "Full match" },
                      { value: "range", label: isHebrew ? "טווח דקות" : "Minute range" },
                    ]}
                    value={evWindowKind}
                    onChange={(v) => setEvWindowKind(v as "1H" | "2H" | "FT" | "range")}
                  />
                </label>
                {evWindowKind === "range" && (
                  <div className="flex items-end gap-3">
                    <label className="flex flex-col gap-1.5">
                      <LabelCaps>{isHebrew ? "מדקה" : "From min"}</LabelCaps>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={evFrom}
                        onChange={(e) => setEvFrom(e.target.value)}
                        className="min-h-[48px] w-24 px-3 rounded border border-outline bg-surface-container-lowest text-base tabular-nums"
                        dir="ltr"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <LabelCaps>{isHebrew ? "עד דקה" : "To min"}</LabelCaps>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={evTo}
                        onChange={(e) => setEvTo(e.target.value)}
                        className="min-h-[48px] w-24 px-3 rounded border border-outline bg-surface-container-lowest text-base tabular-nums"
                        dir="ltr"
                      />
                    </label>
                  </div>
                )}
                <div className="flex items-end gap-3">
                  <label className="flex flex-col gap-1.5">
                    <LabelCaps>{isHebrew ? "השוואה" : "Compare"}</LabelCaps>
                    <select
                      value={evOp}
                      onChange={(e) => setEvOp(e.target.value)}
                      className="min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base"
                      dir="ltr"
                    >
                      <option value=">=">{"≥"}</option>
                      <option value=">">{">"}</option>
                      <option value="=">{"="}</option>
                      <option value="<=">{"≤"}</option>
                      <option value="<">{"<"}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <LabelCaps>{isHebrew ? "כמות" : "Count"}</LabelCaps>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={evValue}
                      onChange={(e) => setEvValue(e.target.value)}
                      className="min-h-[48px] w-24 px-3 rounded border border-outline bg-surface-container-lowest text-base tabular-nums"
                      dir="ltr"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
          )}
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

      <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-3 pt-4 border-t border-outline-variant">
        {/* Draft autosave status. The draft persists itself as you go — in
            create mode it auto-creates once the form is valid, then keeps
            updating that same draft. In edit mode the admin can either just
            save & close, or publish straight from here (save + flip to open +
            back to the list). */}
        <div className="flex items-center md:me-auto min-h-[44px] text-xs">
          {!draftBuild.ok ? (
            <span className="inline-flex items-center gap-1.5 text-on-surface-variant">
              {isHebrew
                ? "השלם את השדות כדי שהטיוטה תישמר אוטומטית"
                : "Complete the fields so the draft autosaves"}
            </span>
          ) : draftStatus === "idle" ? (
            <span className="text-on-surface-variant">
              {isHebrew ? "הטיוטה נשמרת אוטומטית" : "Draft saves automatically"}
            </span>
          ) : (
            <SaveStatus
              state={draftStatus}
              locale={locale}
              savedLabel={isHebrew ? "טיוטה נשמרה" : "Draft saved"}
              onRetry={retryDraftSave}
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => router.push(cancelHref)}
          disabled={publishing}
          className="min-h-[48px] px-6 rounded-full border border-outline bg-surface-container-lowest text-on-surface font-bold hover:bg-surface-container disabled:opacity-50"
        >
          {isHebrew ? "חזור" : "Back"}
        </button>
        {/* Edit mode: "save & close" is the secondary action; publishing is the
            primary one the admin usually wants next. Create mode keeps a single
            "Done". */}
        {mode === "edit" ? (
          <>
            <button
              type="submit"
              disabled={publishing}
              className="min-h-[48px] px-6 rounded-full border border-outline bg-surface-container-lowest text-on-surface font-bold hover:bg-surface-container disabled:opacity-50"
            >
              {isHebrew ? "שמור וסגור" : "Save & close"}
            </button>
            <PillButton
              type="button"
              onClick={publish}
              disabled={publishing || !draftBuild.ok}
              className="min-h-[48px]"
            >
              {publishing
                ? isHebrew ? "מפרסם…" : "Publishing…"
                : isHebrew ? "פרסם" : "Publish"}
            </PillButton>
          </>
        ) : (
          <PillButton type="submit" className="min-h-[48px]">
            {isHebrew ? "סיום" : "Done"}
          </PillButton>
        )}
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

// Live-bet pricing-mode switch (probability % ↔ manual ratio). Thin
// wrapper over SegmentedRow so the multi-choice and yes/no sections share
// one labelled control. Defaults to probability; ratio lets the admin type
// the multiplier directly (no house edge, no cap).
function PricingModeToggle({
  mode,
  onChange,
  isHebrew,
}: {
  mode: PricingMode;
  onChange: (m: PricingMode) => void;
  isHebrew: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <LabelCaps>{isHebrew ? "שיטת תמחור" : "Pricing mode"}</LabelCaps>
      <SegmentedRow<PricingMode>
        value={mode}
        onChange={onChange}
        options={[
          { value: "probability", label: isHebrew ? "הסתברות %" : "Probability %" },
          { value: "ratio", label: isHebrew ? "יחס ×" : "Ratio ×" },
        ]}
      />
    </div>
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
  onBlur,
  placeholder,
  required,
  dir,
  inputMode,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  required?: boolean;
  dir?: "rtl" | "ltr";
  inputMode?: "text" | "numeric" | "decimal";
  hint?: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <LabelCaps>{label}</LabelCaps>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        required={required}
        dir={dir}
        inputMode={inputMode}
        className="min-h-[48px] px-3 rounded border border-outline bg-surface-container-lowest text-base"
      />
      {hint}
    </label>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  required,
  dir,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  required?: boolean;
  dir?: "rtl" | "ltr";
  hint?: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <LabelCaps>{label}</LabelCaps>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        required={required}
        dir={dir}
        rows={3}
        className="min-h-[80px] px-3 py-2 rounded border border-outline bg-surface-container-lowest text-base resize-y"
      />
      {hint}
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

type McOption = {
  value: string;
  labelHe: string;
  labelEn: string;
  // Probability % (probability pricing mode) and the typed multiplier
  // (ratio pricing mode). Both are kept so toggling the mode never
  // reinterprets one as the other (33% is not ×33). Only the field for the
  // active mode is read at submit.
  probability: string;
  ratio: string;
};

function updateMc(
  i: number,
  field: "value" | "labelHe" | "labelEn" | "probability" | "ratio",
  value: string,
  list: McOption[],
  setter: (l: McOption[]) => void,
) {
  const next = list.slice();
  next[i] = { ...next[i], [field]: value };
  setter(next);
}

function removeMc(
  i: number,
  list: McOption[],
  setter: (l: McOption[]) => void,
) {
  if (list.length <= 2) return;
  setter(list.filter((_, idx) => idx !== i));
}

// Parse a whole/decimal percent string ("33", "12.5") into a 0..1
// probability. Returns null for empty/non-numeric/out-of-range input so
// callers can treat "not filled" distinctly from 0.
function parsePercent(raw: string): number | null {
  const trimmed = raw.trim().replace(/%$/, "");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0 || n >= 100) return null;
  return n / 100;
}

// Inverse: a stored decimal odds back to a whole-percent string for the
// edit-mode form seed (p = 1 / odds). Empty string when no odds present.
function oddsToPercentString(odds: number | undefined): string {
  if (typeof odds !== "number" || !Number.isFinite(odds) || odds <= 1) return "";
  return String(Math.round((1 / odds) * 100));
}

// Parse a hand-typed ratio/multiplier ("6", "2.5") for ratio pricing mode.
// Returns null for empty/non-numeric input, a value ≤ 1 (a "win" that pays
// no profit makes no sense), or one above MAX_MANUAL_RATIO (anti-typo
// guard) — so callers treat "not filled" and "out of range" distinctly
// from a valid ratio.
function parseRatio(raw: string): number | null {
  const trimmed = raw.trim().replace(/^[×x*]/i, "").trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 1 || n > MAX_MANUAL_RATIO) return null;
  return n;
}

// Inverse for the edit-mode seed in ratio mode: the stored decimal odds
// ARE the typed ratio, so surface them directly (trimmed of trailing
// zeros). Empty string when no odds present.
function oddsToRatioString(odds: number | undefined): string {
  if (typeof odds !== "number" || !Number.isFinite(odds) || odds <= 1) return "";
  return String(Number(odds.toFixed(2)));
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

// Derive per-choice live pricing from the admin's input and embed it into
// the answer config. Three outcomes:
//   - an AnswerConfig with pricing maps filled (all options/sides priced)
//   - null  → nothing entered; keep the legacy flat-payout shape
//   - "incomplete" → some but not all options priced; caller blocks submit
// Only multi_choice and yes_no carry per-choice pricing; other types
// return null. Two pricing modes:
//   - probability: derive fair odds from the % and run normalizeOdds.
//   - ratio: the typed multiplier IS the odds; payout = stake × ratio with
//     no edge/cap, priced per-option (no renormalisation). The mode flag is
//     stamped on the config so the server, the card, and the pick-time
//     write all reprice the same way. The server re-derives payouts from
//     these odds, so a stale client number can never be the stored value.
function embedLivePricing(
  config: AnswerConfig,
  mcOptions: McOption[],
  yesProbability: string,
  yesRatio: string,
  noRatio: string,
  pricingMode: PricingMode,
  pricingConfig: OddsNormConfig,
): AnswerConfig | null | "incomplete" {
  if (config.kind === "multi_choice") {
    if (pricingMode === "ratio") {
      const ratioByValue = new Map<string, number | null>();
      for (const o of mcOptions) {
        ratioByValue.set(o.value.trim(), parseRatio(o.ratio));
      }
      const ratios = config.options.map((o) => ratioByValue.get(o.value) ?? null);
      const filled = ratios.filter((r) => r != null).length;
      if (filled === 0) return null;
      if (filled < config.options.length) return "incomplete";

      const decimalOddsByValue: Record<string, number> = {};
      const payoutOverridesByValue: Record<string, number> = {};
      const options = config.options.map((o, i) => {
        const r = ratios[i] as number;
        decimalOddsByValue[o.value] = r;
        const payout = liveOptionPayout(r, pricingConfig.baseStake, "ratio", pricingConfig);
        payoutOverridesByValue[o.value] = payout;
        return { ...o, payoutOverride: payout };
      });
      return {
        ...config,
        pricingMode: "ratio",
        options,
        decimalOddsByValue,
        payoutOverridesByValue,
      };
    }

    const probByValue = new Map<string, number | null>();
    for (const o of mcOptions) {
      probByValue.set(o.value.trim(), parsePercent(o.probability));
    }
    const probs = config.options.map((o) => probByValue.get(o.value) ?? null);
    const filled = probs.filter((p) => p != null).length;
    if (filled === 0) return null; // legacy flat payout
    if (filled < config.options.length) return "incomplete";

    const priced = priceOptionsFromProbabilities(
      config.options.map((o, i) => ({ value: o.value, probability: probs[i] as number })),
      pricingConfig,
    );
    const decimalOddsByValue: Record<string, number> = {};
    const payoutOverridesByValue: Record<string, number> = {};
    const options = config.options.map((o, i) => {
      decimalOddsByValue[o.value] = priced[i].decimalOdds;
      payoutOverridesByValue[o.value] = priced[i].payout;
      return { ...o, payoutOverride: priced[i].payout };
    });
    return {
      ...config,
      pricingMode: "probability",
      options,
      decimalOddsByValue,
      payoutOverridesByValue,
    };
  }

  if (config.kind === "yes_no") {
    if (pricingMode === "ratio") {
      const y = parseRatio(yesRatio);
      const n = parseRatio(noRatio);
      if (y == null && n == null) return null;
      if (y == null || n == null) return "incomplete";
      return {
        ...config,
        pricingMode: "ratio",
        decimalOddsYes: y,
        decimalOddsNo: n,
        payoutOverrideYes: liveOptionPayout(y, pricingConfig.baseStake, "ratio", pricingConfig),
        payoutOverrideNo: liveOptionPayout(n, pricingConfig.baseStake, "ratio", pricingConfig),
      };
    }

    const p = parsePercent(yesProbability);
    if (p == null) return null; // legacy flat payout
    const yn = priceYesNo(p, pricingConfig);
    return {
      ...config,
      pricingMode: "probability",
      decimalOddsYes: yn.decimalOddsYes,
      decimalOddsNo: yn.decimalOddsNo,
      payoutOverrideYes: yn.payoutYes,
      payoutOverrideNo: yn.payoutNo,
    };
  }

  return null;
}

function buildGradingConfig(
  source: GradingSource,
  fields: {
    // An advanced auto_api_football rule the form can't edit (first-event
    // window / comeback). When present and the admin hasn't asked to replace
    // it, re-emit it verbatim so editing wording never corrupts the grading.
    advancedConfig: GradingConfig;
    autoAfStat: string;
    autoAfAgg: "sum_day" | "per_match" | "first_match";
    autoFdField: AutoFdField;
    autoAfMode: "stats" | "events";
    ev: {
      metric: string;
      windowKind: "1H" | "2H" | "FT" | "range";
      from: string;
      to: string;
      op: string;
      value: string;
      team: "home" | "away" | "any";
    };
  },
): GradingConfig | "invalid" {
  if (source === "manual") return null;
  if (source === "auto_api_football") {
    if (fields.advancedConfig) return fields.advancedConfig;
    if (fields.autoAfMode === "events") {
      return buildEventGradingConfig(fields.ev);
    }
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

// Assemble + validate the event-timeline grading config from the form
// fields. Returns "invalid" on a malformed window/count so the submit
// surfaces a clear error rather than persisting a spec the grader skips.
function buildEventGradingConfig(ev: {
  metric: string;
  windowKind: "1H" | "2H" | "FT" | "range";
  from: string;
  to: string;
  op: string;
  value: string;
  team: "home" | "away" | "any";
}): GradingConfig | "invalid" {
  const value = parseInt(ev.value, 10);
  if (!Number.isFinite(value) || value < 0) return "invalid";

  let window: "1H" | "2H" | "FT" | { fromMinute: number; toMinute: number };
  if (ev.windowKind === "range") {
    const from = parseInt(ev.from, 10);
    const to = parseInt(ev.to, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || from < 0) {
      return "invalid";
    }
    window = { fromMinute: from, toMinute: to };
  } else {
    window = ev.windowKind;
  }

  return {
    source: "auto_api_football",
    events: {
      metric: ev.metric as EventMetric,
      window,
      op: ev.op as EventOp,
      value,
      ...(ev.team !== "any" ? { team: ev.team } : {}),
    },
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
    kickoff = new Date(daysFromNow(1));
  }
  const lock = new Date(kickoff.getTime() - offsetMinutes * 60 * 1000);
  // Use the Asia/Jerusalem-aware formatter so the suggested wall time
  // is what the admin actually expects to see, even when the browser
  // is in another timezone.
  return isoToLocalInputValue(lock.toISOString());
}

// Searchable template picker. Renders a text input + a scrollable list
// filtered by case-insensitive substring against the locale-active
// question text, the applied-anchor label (so an admin can type "MEX"
// to find every bet they wrote on Mexico fixtures), and the scope tag.
function TemplatePicker({
  locale,
  templates,
  onPick,
}: {
  locale: Locale;
  templates: BetTemplate[];
  onPick: (t: BetTemplate) => void;
}) {
  const isHebrew = locale === "he";
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return templates;
    return templates.filter((t) => {
      const haystack = [
        isHebrew ? t.questionHe : t.questionEn,
        t.appliedLabel ?? "",
        scopeShortLabel(t.scope, isHebrew),
        scopeShortLabel(t.scope, !isHebrew),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [q, templates, isHebrew]);

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          isHebrew ? "חפש לפי טקסט / משחק / סוג…" : "Search by text / match / scope…"
        }
        className="min-h-[48px] w-full px-3 rounded border border-outline bg-surface-container-lowest text-base font-bold focus:outline-none focus:border-primary"
      />
      <ul className="flex flex-col gap-1 max-h-72 overflow-y-auto rounded border border-outline-variant bg-surface-container-lowest">
        {filtered.length === 0 ? (
          <li className="px-3 py-3 text-xs text-on-surface-variant text-center">
            {isHebrew ? "אין תוצאות תואמות." : "No matching templates."}
          </li>
        ) : (
          filtered.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(t);
                  setQuery("");
                }}
                className="press-down w-full text-start min-h-11 px-3 py-2 hover:bg-surface-container flex flex-col gap-0.5"
              >
                <span className="text-sm font-bold text-on-surface line-clamp-2">
                  <Chip className="me-1 text-[10px]">
                    {scopeShortLabel(t.scope, isHebrew)}
                  </Chip>
                  {isHebrew ? t.questionHe : t.questionEn}
                </span>
                {t.appliedLabel && (
                  <span className="text-[11px] text-on-surface-variant tabular-nums">
                    {isHebrew ? "הוחל על:" : "Last applied to:"} {t.appliedLabel}
                  </span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// Tight 2-3 char label for the template-picker chip. Lets the dropdown
// fit a scope + question + applied-anchor preview on one mobile line.
function scopeShortLabel(scope: string, isHebrew: boolean): string {
  if (isHebrew) {
    switch (scope) {
      case "match":      return "משחק";
      case "day":        return "יום";
      case "stage":      return "שלב";
      case "group":      return "בית";
      case "tournament": return "טורניר";
      default:           return scope;
    }
  }
  switch (scope) {
    case "match":      return "Match";
    case "day":        return "Day";
    case "stage":      return "Stage";
    case "group":      return "Group";
    case "tournament": return "Tour";
    default:           return scope;
  }
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

const ERROR_MAP = {
  ...COMMON_ADMIN_ERRORS,
  forbidden:              ["אין הרשאה", "Not allowed"],
  invalid_scope_anchor:   ["סוג ההימור והעוגן אינם תואמים", "Scope and anchor don't match"],
  invalid_question:       ["שאלה ריקה בעברית או באנגלית", "Question missing in Hebrew or English"],
  invalid_grading_rule:   ["כלל דירוג חייב להיות לפחות 3 תווים", "Grading rule must be 3+ characters"],
  invalid_stake_payout:   ["עלות או תשלום לא תקין", "Invalid stake or payout"],
  invalid_answer_config:  ["תצורת תשובה לא תקינה", "Invalid answer config"],
  invalid_grading_config: ["תצורת דירוג לא תקינה", "Invalid grading config"],
  invalid_lock_at:        ["זמן סגירה חייב להיות בעתיד", "Lock time must be in the future"],
  match_not_found:        ["המשחק לא נמצא", "Match not found"],
  group_not_found:        ["הבית לא נמצא", "Group not found"],
  bet_not_found:          ["ההימור לא נמצא", "Bet not found"],
  invalid_status:         ["אפשר לערוך רק טיוטה. בטל את ההימור וצור אחד חדש.", "Only drafts can be edited. Cancel and recreate."],
} as const satisfies Record<string, LocalizedTuple>;

function translateError(err: string, isHebrew: boolean): string {
  return translateAdminError(err, ERROR_MAP, isHebrew);
}
