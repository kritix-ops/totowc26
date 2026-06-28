// Shared clamp for the "how many suggestions" field on the live-bet
// generate buttons. Pure (no React, no IO) so both buttons and a unit test
// use the EXACT same parse + clamp.
//
// Why this exists: the field used to bind `value={count}` (a number) and snap
// an empty/partial input back to the default on every keystroke. On mobile
// you could never blank it, so typing a digit appended to the existing one
// ("6" + "3" -> "63") and the result clamped to the max. The buttons now hold
// the raw text and derive the count through this helper, normalizing only on
// blur — so the field can be momentarily empty while you retype.

export const MIN_SUGGESTION_COUNT = 2;
export const MAX_SUGGESTION_COUNT = 10;
export const DEFAULT_SUGGESTION_COUNT = 6;

// Parse the raw input text to a valid count. Empty / non-numeric falls back to
// the default; anything else is clamped into [MIN, MAX].
export function clampSuggestionCount(text: string): number {
  const n = parseInt(text, 10);
  if (!Number.isFinite(n)) return DEFAULT_SUGGESTION_COUNT;
  return Math.max(MIN_SUGGESTION_COUNT, Math.min(MAX_SUGGESTION_COUNT, n));
}
