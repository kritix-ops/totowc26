import type { PickAnswer } from "./types";

// Validate a player's answer against a custom bet's answer_type + answer_config.
// Pure logic, no IO - shared by the single-pick submit action and the
// random/monkey write-core so the two paths cannot diverge.
export function validateAnswer(
  answerType: "yes_no" | "number" | "multi_choice" | "free_text",
  config: unknown,
  answer: PickAnswer,
): boolean {
  if (answer.type !== answerType) return false;
  if (answer.type === "yes_no") {
    return typeof answer.value === "boolean";
  }
  if (answer.type === "number") {
    if (typeof answer.value !== "number" || !Number.isFinite(answer.value)) {
      return false;
    }
    const c = config as { min?: number; max?: number } | null | undefined;
    if (c?.min !== undefined && answer.value < c.min) return false;
    if (c?.max !== undefined && answer.value > c.max) return false;
    return true;
  }
  if (answer.type === "multi_choice") {
    if (typeof answer.value !== "string" || answer.value.length === 0) return false;
    const c = config as
      | {
          options?: Array<{ value: string }>;
          dynamicSource?: unknown;
          payoutOverridesByValue?: Record<string, unknown>;
        }
      | null
      | undefined;
    // Static bets carry their full option list inline — validate membership
    // directly.
    if (c?.options?.some((o) => o.value === answer.value)) return true;
    // Dynamic-source bets (top scorer, golden ball, ...) keep options=[] and
    // hydrate the ~1,300-row roster client-side from /api/picker-options, so
    // the inline list is empty here. Their priced universe lives in
    // payoutOverridesByValue; accept any value present there. When such a bet
    // has no price map yet, fall back to accepting a non-empty string — the
    // picker only ever submits real roster ids and grading compares the exact
    // value regardless. (Without this branch every player pick was rejected as
    // invalid_answer — see _plans/2026-06-01-monkey-bot-and-random-fill.md §0.)
    if (c?.dynamicSource != null) {
      const overrides = c.payoutOverridesByValue;
      if (overrides && Object.keys(overrides).length > 0) {
        return Object.prototype.hasOwnProperty.call(overrides, answer.value);
      }
      return true;
    }
    return false;
  }
  // free_text
  if (typeof answer.value !== "string") return false;
  return answer.value.length > 0 && answer.value.length <= 200;
}
