// Price a set of mutually-exclusive bet options from per-option
// PROBABILITIES rather than from bookmaker odds.
//
// Why this exists: exotic live markets (VAR in a half, red card before
// half-time, first-goal window) have no bookmaker source. Before this
// module they were published as flat yes/no rows that paid the same
// multiplier on every outcome — which is how "no VAR in the first half"
// (a near-certain event) ended up paying 5x. See
// _plans/2026-06-12-live-bets-llm-overhaul.md "Pricing model".
//
// The fix: ask the LLM (or the admin) for a PROBABILITY per option, then
// derive fair decimal odds = 1 / p and run them through the SAME
// `normalizeOdds` pricing the bookmaker markets use. A likely outcome
// (p high → odds near 1.0) collapses to the minimum +1 payout
// automatically; a longshot (p low → high odds) earns up to the cap.
// No new pricing curve, so the live and exotic paths can never drift.
//
// Pure module — no DB, no fetch, no side effects. Safe on server and
// client; tests call it with hard-coded inputs.

import { normalizeOdds, type OddsNormConfig } from "@/lib/odds-normalize";
import type { AnswerConfig, PricingMode } from "@/lib/bets/types";

// Hard sanity ceiling on a HAND-TYPED ratio (ratio pricing mode only).
// This is NOT a payout cap — the admin explicitly chose exact ratios with
// no cap (see _plans/2026-06-13-live-bet-manual-ratio.md). It is purely an
// anti-typo guard so a fat-fingered ×600 can't write a bank-destroying
// payout: a value above it is REJECTED (never silently clamped). Generous
// on purpose — a realistic exotic longshot tops out far below it.
export const MAX_MANUAL_RATIO = 100;

// Default clamp band for probabilities. Guards the inversion 1/p against
// degenerate estimates: a model returning p=0 would blow up to infinite
// odds, and p=1 would yield odds 1.0 (a guaranteed-pay market). 0.02
// (50:1) and 0.98 (~1.02) bracket every realistic single-match event.
const DEFAULT_MIN_PROBABILITY = 0.02;
const DEFAULT_MAX_PROBABILITY = 0.98;

export type ProbabilityOption = {
  // Stable option key stored in answer_config and matched against the
  // player's pick. Mirrors MultiChoiceOption.value.
  value: string;
  // Raw probability estimate (0..1) from the LLM or admin. Need not be
  // normalised — the vector is renormalised here before pricing.
  probability: number;
};

export type PricedOption = {
  value: string;
  // The probability actually used after normalisation + clamping. Kept
  // so the admin preview can show "we priced this at 78%".
  probability: number;
  // Fair decimal odds = 1 / probability. Stored into
  // MultiChoiceConfig.decimalOddsByValue so the variable-stake submit
  // path in write-core recomputes the payout against the chosen stake.
  decimalOdds: number;
  // Point stake + gross payout from the shared normalizeOdds pricing.
  stake: number;
  payout: number;
};

export type PriceOptionsConfig = OddsNormConfig & {
  // Override the default probability clamp band. Surfaced as settings so
  // the admin can widen/narrow the exotic-payout spread.
  minProbability?: number;
  maxProbability?: number;
};

// Price a whole mutually-exclusive market in one call. Steps:
//   1. Keep only finite, positive probabilities; if none survive, fall
//      back to a uniform split so a bad estimate degrades to flat odds
//      instead of throwing.
//   2. Renormalise the surviving probabilities to sum to 1.
//   3. Clamp each into [minProbability, maxProbability] so the 1/p
//      inversion stays bounded.
//   4. decimalOdds = 1 / pClamped, then normalizeOdds() for stake/payout.
export function priceOptionsFromProbabilities(
  options: ProbabilityOption[],
  config: PriceOptionsConfig,
): PricedOption[] {
  const minP = clamp01(config.minProbability ?? DEFAULT_MIN_PROBABILITY, 0.001);
  const maxP = clamp01(config.maxProbability ?? DEFAULT_MAX_PROBABILITY, minP);

  const normalised = normaliseProbabilities(options);

  return normalised.map(({ value, probability }) => {
    const clamped = clampRange(probability, minP, maxP);
    const decimalOdds = 1 / clamped;
    const { stake, payout } = normalizeOdds(decimalOdds, config);
    return {
      value,
      probability: clamped,
      decimalOdds: roundOdds(decimalOdds),
      stake,
      payout,
    };
  });
}

// yes/no convenience wrapper. A yes/no bet is just the 2-option case:
// the "yes" branch carries probYes, the "no" branch 1 - probYes. Feeds
// YesNoConfig.payoutOverrideYes / payoutOverrideNo so the two outcomes
// price independently instead of sharing one bet-level payout (the
// original flat-odds bug for binary live bets).
export type YesNoPricing = {
  decimalOddsYes: number;
  decimalOddsNo: number;
  payoutYes: number;
  payoutNo: number;
  stake: number;
};

export function priceYesNo(
  probYes: number,
  config: PriceOptionsConfig,
): YesNoPricing {
  const safeYes = Number.isFinite(probYes) ? clampRange(probYes, 0, 1) : 0.5;
  const [yes, no] = priceOptionsFromProbabilities(
    [
      { value: "yes", probability: safeYes },
      { value: "no", probability: 1 - safeYes },
    ],
    config,
  );
  return {
    decimalOddsYes: yes.decimalOdds,
    decimalOddsNo: no.decimalOdds,
    payoutYes: yes.payout,
    payoutNo: no.payout,
    // Both branches share the base stake (normalizeOdds returns the same
    // stake for either) — surface it once.
    stake: yes.stake,
  };
}

// Pick the per-side decimal odds for a yes/no live bet. Mirrors the
// per-option lookup multi_choice uses (decimalOddsByValue), but keyed on
// the boolean outcome. Returns null when the side has no valid odds
// captured so the caller can fall back to the bet-level decimal_odds (or
// linear scaling). Kept here, beside the pricing, so write-core and the
// tests share one definition of "valid odds" (finite and > 1).
export function resolveYesNoSideOdds(
  config:
    | { decimalOddsYes?: number; decimalOddsNo?: number }
    | null
    | undefined,
  pickedYes: boolean,
): number | null {
  const v = pickedYes ? config?.decimalOddsYes : config?.decimalOddsNo;
  return typeof v === "number" && Number.isFinite(v) && v > 1 ? v : null;
}

// Read the pricing mode off an answer config. Defaults to "probability"
// for every shape that doesn't carry the flag (legacy bets, free-pick
// scopes, number/free-text), so the historic house-edge + cap behaviour is
// unchanged unless a bet explicitly opts into "ratio".
export function resolvePricingMode(
  config: AnswerConfig | null | undefined,
): PricingMode {
  if (
    config &&
    (config.kind === "multi_choice" || config.kind === "yes_no") &&
    config.pricingMode === "ratio"
  ) {
    return "ratio";
  }
  return "probability";
}

// Gross payout for ONE live (match/day) option, given its decimal
// odds/ratio and the player's chosen stake. The single shared definition
// behind the admin form preview, the player card, the pick-time write, and
// the server reprice — so all four agree byte-for-byte.
//   - "probability" mode (default): normalizeOdds — house edge + payout
//     cap, the historic behaviour.
//   - "ratio" mode: exact round(stake × ratio), with NO house edge and NO
//     cap. Floored at stake + 1 so a correct pick always nets at least +1
//     even after rounding a near-1 ratio.
export function liveOptionPayout(
  odds: number,
  stake: number,
  mode: PricingMode,
  config: OddsNormConfig,
): number {
  if (mode === "ratio") {
    const safeStake = Number.isFinite(stake) && stake > 0 ? Math.floor(stake) : 1;
    const safeOdds = Number.isFinite(odds) && odds > 1 ? odds : 1.01;
    const raw = Math.round(safeStake * safeOdds);
    return Math.max(raw, safeStake + 1);
  }
  return normalizeOdds(odds, config).payout;
}

// Validate every captured live odds value in an answer config is a real
// bookmaker decimal (finite, > 1). Run server-side before persisting so a
// malformed client payload can't poison the pick-time payout math. Returns
// true for shapes that carry no live odds (nothing to check). In ratio
// mode each value must also stay at or below MAX_MANUAL_RATIO so a typo
// can't store a bank-destroying multiplier (probability-mode odds never
// exceed ~50, well under the bound, so the extra check is a no-op there).
export function validateLiveOddsConfig(config: AnswerConfig): boolean {
  const max = resolvePricingMode(config) === "ratio" ? MAX_MANUAL_RATIO : Infinity;
  const ok = (v: unknown): boolean =>
    typeof v === "number" && Number.isFinite(v) && v > 1 && v <= max;
  if (config.kind === "multi_choice") {
    const m = config.decimalOddsByValue;
    if (!m) return true;
    return Object.values(m).every(ok);
  }
  if (config.kind === "yes_no") {
    if (config.decimalOddsYes !== undefined && !ok(config.decimalOddsYes)) return false;
    if (config.decimalOddsNo !== undefined && !ok(config.decimalOddsNo)) return false;
    return true;
  }
  return true;
}

// Re-derive the DISPLAY payout maps from the captured odds, server-side,
// using the canonical live pricing config. The odds are the admin/LLM
// input we trust (after validateLiveOddsConfig); the payout integers are
// recomputed here so a tampered or stale client payout can never be the
// stored value. Returns the rewritten config plus the highest payout
// across outcomes, which the caller uses as the bet-level snapshot.
// Configs with no captured odds pass through unchanged (maxPayout null).
export function repriceAnswerConfigFromOdds(
  config: AnswerConfig,
  pricingConfig: OddsNormConfig,
): { config: AnswerConfig; maxPayout: number | null } {
  // Mode is read off the same config; "ratio" pays baseStake × ratio with
  // no edge/cap, "probability" runs the historic normalizeOdds. The mode
  // flag rides through unchanged on the spread below.
  const mode = resolvePricingMode(config);
  if (config.kind === "multi_choice" && config.decimalOddsByValue) {
    const odds = config.decimalOddsByValue;
    const payoutOverridesByValue: Record<string, number> = {};
    let maxPayout = 0;
    for (const [value, o] of Object.entries(odds)) {
      const payout = liveOptionPayout(o, pricingConfig.baseStake, mode, pricingConfig);
      payoutOverridesByValue[value] = payout;
      if (payout > maxPayout) maxPayout = payout;
    }
    const options = config.options.map((opt) =>
      payoutOverridesByValue[opt.value] != null
        ? { ...opt, payoutOverride: payoutOverridesByValue[opt.value] }
        : opt,
    );
    return {
      config: { ...config, options, payoutOverridesByValue },
      maxPayout: maxPayout > 0 ? maxPayout : null,
    };
  }

  if (
    config.kind === "yes_no" &&
    (config.decimalOddsYes !== undefined || config.decimalOddsNo !== undefined)
  ) {
    const next = { ...config };
    let maxPayout = 0;
    if (config.decimalOddsYes !== undefined) {
      const payout = liveOptionPayout(config.decimalOddsYes, pricingConfig.baseStake, mode, pricingConfig);
      next.payoutOverrideYes = payout;
      if (payout > maxPayout) maxPayout = payout;
    }
    if (config.decimalOddsNo !== undefined) {
      const payout = liveOptionPayout(config.decimalOddsNo, pricingConfig.baseStake, mode, pricingConfig);
      next.payoutOverrideNo = payout;
      if (payout > maxPayout) maxPayout = payout;
    }
    return { config: next, maxPayout: maxPayout > 0 ? maxPayout : null };
  }

  return { config, maxPayout: null };
}

// ---------- helpers ----------

// Renormalise raw probabilities to sum to 1. Invalid (non-finite or
// non-positive) entries are dropped from the weighting and fall back to
// an even share of whatever mass is left, so one bad value can't zero
// out the rest of the market.
function normaliseProbabilities(
  options: ProbabilityOption[],
): Array<{ value: string; probability: number }> {
  if (options.length === 0) return [];
  const weights = options.map((o) =>
    Number.isFinite(o.probability) && o.probability > 0 ? o.probability : 0,
  );
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    // No usable estimate anywhere → uniform split.
    const uniform = 1 / options.length;
    return options.map((o) => ({ value: o.value, probability: uniform }));
  }
  return options.map((o, i) => ({
    value: o.value,
    probability: weights[i] > 0 ? weights[i] / total : 0,
  }));
}

// The pool wants clean WHOLE-NUMBER multipliers (×6, not ×5.88), so we
// round each option's fair odds to the nearest integer. Floor at 2 — the
// smallest whole number above the 1.0 break-even — so a heavy favourite
// still shows a real ×2 rather than ×1 (which reads as "no win"). One
// consequence: a near-certain pick now pays the ×2 minimum instead of a
// sub-2 multiple, slightly more generous than its fair price. Same rounded
// value feeds display, storage and the pick-time payout, so they agree.
function roundOdds(odds: number): number {
  return Math.max(2, Math.round(odds));
}

function clampRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// Clamp a 0..1 config knob, guarding NaN to a sane floor.
function clamp01(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > 1) return 1;
  return value;
}
