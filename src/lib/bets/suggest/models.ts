// Catalogue of Claude models the admin can pick for the live-bet AI
// suggestion generator, with current pricing and the cost-projection math.
// Pure module (no server-only) so the admin card and the tests share it.
//
// Prices are USD per million tokens, sourced from models.dev (verified
// 2026-06-12). Update them here if a provider re-prices — this is the one
// place pricing lives. Per the project rule on model choice: the pick is
// surfaced to the admin on cost + capability, with no thumb on the scale.

export type ModelInfo = {
  id: string;
  label: string;
  inputPricePerM: number;
  outputPricePerM: number;
  // One-line positioning shown next to the option.
  blurbHe: string;
  blurbEn: string;
  recommended?: boolean;
};

export const SUGGEST_MODELS: ModelInfo[] = [
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    inputPricePerM: 3,
    outputPricePerM: 15,
    blurbHe: "האיזון הטוב ביותר בין איכות, מהירות ועלות. מומלץ.",
    blurbEn: "Best balance of quality, speed and cost. Recommended.",
    recommended: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    inputPricePerM: 1,
    outputPricePerM: 5,
    blurbHe: "הזול והמהיר ביותר. הסתברויות פחות מכוילות.",
    blurbEn: "Cheapest and fastest. Slightly less calibrated probabilities.",
  },
  {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    inputPricePerM: 4.29,
    outputPricePerM: 21.46,
    blurbHe: "האיכותי ביותר להערכת הסתברויות. יקר יותר.",
    blurbEn: "Highest-quality probability estimates. Pricier.",
  },
];

export const DEFAULT_SUGGEST_MODEL = "claude-sonnet-4-6";

// Per-call token estimates for one batch. Input = system prompt + tool schema
// + the assembled dossier (form, injuries, key players, prediction), which is
// the bulk now (~6k); output = 6-10 bilingual bets (~4k). Search results
// inflate input further but vary per call, so we fold their effect into the
// flat web-search line below rather than guessing token counts. Conservative
// so the projected cost errs high rather than low.
export const EST_INPUT_TOKENS = 6000;
export const EST_OUTPUT_TOKENS = 4000;

// Web search (Anthropic server tool) is billed at $10 / 1,000 searches on top
// of tokens (verified Jun 2026). The model searches only when a call needs
// current info and is capped at 3; ~2 per call is a realistic average for the
// projection. Set to 0 if web search is later turned off.
export const WEB_SEARCH_PRICE_PER_K = 10;
export const EST_SEARCHES_PER_CALL = 2;

// How many times the admin regenerates per match on average. Drives the
// projection; surfaced as an adjustable assumption in the UI.
export const DEFAULT_GENS_PER_MATCH = 2;

export function modelById(id: string | null | undefined): ModelInfo {
  return (
    SUGGEST_MODELS.find((m) => m.id === id) ??
    SUGGEST_MODELS.find((m) => m.id === DEFAULT_SUGGEST_MODEL)!
  );
}

// USD cost of a single generation call on this model: input + output tokens
// plus the average web-search surcharge.
export function costPerCall(model: ModelInfo): number {
  return (
    (EST_INPUT_TOKENS * model.inputPricePerM) / 1_000_000 +
    (EST_OUTPUT_TOKENS * model.outputPricePerM) / 1_000_000 +
    (EST_SEARCHES_PER_CALL * WEB_SEARCH_PRICE_PER_K) / 1_000
  );
}

// Projected USD cost to generate live bets for every remaining match
// through the end of the tournament.
export function projectCost(args: {
  model: ModelInfo;
  remainingMatches: number;
  gensPerMatch: number;
}): number {
  const matches = Math.max(0, args.remainingMatches);
  const gens = Math.max(0, args.gensPerMatch);
  return costPerCall(args.model) * matches * gens;
}
