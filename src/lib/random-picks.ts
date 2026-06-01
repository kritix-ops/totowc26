// Pure random-pick generator. No IO, no auth, no DB - safe to import from
// server or client, and callable directly from tests with a seeded RNG.
//
// Two consumers share this module:
//   - the per-user "Surprise me" bulk action (fills the caller's empty bets)
//   - the "monkey" bot cron (fills every open bet as a baseline to beat)
//
// Design notes:
//   - multi_choice is weighted toward the bookmaker's favourites: the per-
//     option payout (smaller payout = shorter odds = more likely) gives an
//     implied weight of 1/payout. Payouts already bake in the house edge and
//     are clamped, so the raw 1/payout numbers do NOT sum to 1 - we normalise
//     per bet inside weightedIndex(). For a "dumb but not brain-dead" monkey
//     this is plenty; we deliberately do not model true probabilities.
//   - match scores use a plausible goal distribution rather than H2H-odds
//     modelling. A uniform-ish realistic scoreline is indistinguishable from
//     an odds-weighted one to players and is a fraction of the code.
//   - free_text and unbounded number bets return null (skip): free_text has no
//     option set and grades on exact text; an unbounded number grades on exact
//     integer. Auto-filling either is unwinnable noise, so we leave them empty.
//
// See _plans/2026-06-01-monkey-bot-and-random-fill.md.

import type { PickAnswer } from "./bets/types";

// Random source in [0, 1). Defaults to Math.random; tests inject a stub.
export type Rng = () => number;

// Realistic per-side goal distribution for World Cup matches. Index = goals
// scored by one side; value = relative weight. Sampling each side
// independently yields sensible scorelines (0-0, 1-0, 2-1, ...) and a draw
// frequency close to reality, with no outcome-modelling code.
const GOAL_WEIGHTS = [34, 30, 20, 10, 4, 2] as const; // goals 0..5

// Largest [min, max] span we will auto-fill for a number bet. A wider range
// (e.g. "minute of the first goal", 0-90) makes an exact-match guess
// effectively unwinnable, so we treat it as unbounded and skip it.
const MAX_NUMBER_SPAN = 20;

// Generate a plausible match scoreline. Each side's goals are sampled
// independently from GOAL_WEIGHTS.
export function randomMatchScore(rng: Rng = Math.random): {
  home: number;
  away: number;
} {
  return {
    home: weightedIndex(GOAL_WEIGHTS, rng),
    away: weightedIndex(GOAL_WEIGHTS, rng),
  };
}

// Generate a valid answer for a custom bet from its answer_type + answer_config.
// Returns null when the bet cannot be sensibly auto-filled (free_text, or a
// number bet without a tight [min, max]).
export function randomCustomAnswer(
  answerType: string,
  answerConfig: unknown,
  rng: Rng = Math.random,
): PickAnswer | null {
  switch (answerType) {
    case "yes_no":
      return { type: "yes_no", value: rng() < 0.5 };
    case "number":
      return randomNumberAnswer(answerConfig, rng);
    case "multi_choice":
      return randomMultiChoiceAnswer(answerConfig, rng);
    case "free_text":
    default:
      return null;
  }
}

// Uniform integer in [min, max] when both bounds exist and the span is tight;
// otherwise skip (null).
function randomNumberAnswer(
  config: unknown,
  rng: Rng,
): PickAnswer | null {
  const c = config as { min?: unknown; max?: unknown } | null | undefined;
  const min = typeof c?.min === "number" ? c.min : undefined;
  const max = typeof c?.max === "number" ? c.max : undefined;
  if (
    min === undefined ||
    max === undefined ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max < min ||
    max - min > MAX_NUMBER_SPAN
  ) {
    return null;
  }
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (hi < lo) return null;
  const value = lo + Math.floor(rng() * (hi - lo + 1));
  return { type: "number", value };
}

// Pick one option, weighted toward the favourite (1/payout) when per-option
// payouts are known, else uniform. Handles both static option lists and
// dynamic-source bets, whose option universe lives only in
// payoutOverridesByValue (the priced roster).
function randomMultiChoiceAnswer(
  config: unknown,
  rng: Rng,
): PickAnswer | null {
  const c = config as
    | {
        options?: Array<{ value?: unknown; payoutOverride?: unknown }>;
        payoutOverridesByValue?: Record<string, unknown>;
        dynamicSource?: unknown;
      }
    | null
    | undefined;

  const overrides = c?.payoutOverridesByValue;
  const staticOptions = Array.isArray(c?.options) ? c.options : [];

  // Build the candidate list of { value, payout }. Static options take their
  // value/payoutOverride directly; dynamic-source bets keep options empty and
  // expose their priced universe through payoutOverridesByValue.
  const candidates: Array<{ value: string; payout: number | null }> = [];
  if (staticOptions.length > 0) {
    for (const o of staticOptions) {
      if (typeof o?.value !== "string" || o.value.length === 0) continue;
      const override =
        typeof o.payoutOverride === "number" ? o.payoutOverride : null;
      const mapped =
        overrides && typeof overrides[o.value] === "number"
          ? (overrides[o.value] as number)
          : null;
      candidates.push({ value: o.value, payout: override ?? mapped });
    }
  } else if (overrides) {
    for (const [value, payout] of Object.entries(overrides)) {
      if (value.length === 0) continue;
      candidates.push({
        value,
        payout: typeof payout === "number" ? payout : null,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Weight = 1 / payout (favourites carry smaller payouts → larger weight).
  // If any candidate lacks a payout, fall back to uniform so we never bias on
  // a partial price map.
  const haveAllPayouts = candidates.every(
    (x) => x.payout !== null && x.payout > 0,
  );
  const weights = candidates.map((x) =>
    haveAllPayouts ? 1 / (x.payout as number) : 1,
  );
  const idx = weightedIndex(weights, rng);
  return { type: "multi_choice", value: candidates[idx].value };
}

// Sample an index from a non-negative weight array, proportional to weight.
// Normalises internally, so weights need not sum to 1. Falls back to a uniform
// pick if every weight is zero / invalid.
function weightedIndex(weights: readonly number[], rng: Rng): number {
  let total = 0;
  for (const w of weights) {
    if (Number.isFinite(w) && w > 0) total += w;
  }
  if (total <= 0) {
    return Math.floor(rng() * weights.length);
  }
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (!Number.isFinite(w) || w <= 0) continue;
    r -= w;
    if (r < 0) return i;
  }
  return weights.length - 1; // floating-point guard
}
