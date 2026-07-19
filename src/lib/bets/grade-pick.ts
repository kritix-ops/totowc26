import type { ResolvedValue } from "@/lib/bets/types";

// Pick correctness + resolved-value validation, extracted from
// admin/bets/actions.ts so the grading rules live in one place and can be
// reused by the admin self-backdate writer (which grades a single late pick
// on an already-graded bet). Behaviour is identical to the prior inline
// definitions — moving only, no logic change.

type AnswerType = "yes_no" | "number" | "multi_choice" | "free_text";

// Is the resolved value a coherent settlement for this answer type + config?
// Used to reject an admin's grade input before it touches any pick.
export function validateResolvedValue(
  answerType: AnswerType,
  config: unknown,
  resolved: ResolvedValue,
): boolean {
  if (resolved.type !== answerType) return false;
  if (resolved.type === "yes_no") {
    return typeof resolved.value === "boolean";
  }
  if (resolved.type === "number") {
    if (typeof resolved.value !== "number" || !Number.isFinite(resolved.value)) {
      return false;
    }
    const c = config as { min?: number; max?: number } | null | undefined;
    if (c?.min !== undefined && resolved.value < c.min) return false;
    if (c?.max !== undefined && resolved.value > c.max) return false;
    return true;
  }
  if (resolved.type === "multi_choice") {
    if (typeof resolved.value !== "string" || resolved.value.length === 0) {
      return false;
    }
    const c = config as
      | {
          options?: Array<{ value: string }>;
          dynamicSource?: unknown;
          payoutOverridesByValue?: Record<string, unknown>;
        }
      | null
      | undefined;
    // Static bets carry their full option list inline — validate membership.
    if (c?.options?.some((o) => o.value === resolved.value)) return true;
    // Dynamic-source bets (top scorer, golden ball) keep options=[] and hydrate
    // the ~1,300-row roster client-side, so there's nothing to match against
    // here. Accept the priced universe when a price map exists, else any real
    // roster id. This mirrors validateAnswer's dynamic-source branch so the
    // grade path and the pick-submit path cannot diverge — without it, grading
    // a player market was rejected as invalid_resolved_value.
    if (c?.dynamicSource != null) {
      const overrides = c.payoutOverridesByValue;
      if (overrides && Object.keys(overrides).length > 0) {
        return Object.prototype.hasOwnProperty.call(overrides, resolved.value);
      }
      return true;
    }
    return false;
  }
  if (typeof resolved.value !== "string") return false;
  return resolved.value.length > 0 && resolved.value.length <= 200;
}

// Did this pick win, given the bet's resolved value? Free-text is matched
// loosely (trimmed + case-insensitive) so "messi" === "Messi ".
export function isPickCorrect(
  answerType: AnswerType,
  pickAnswer: unknown,
  resolved: ResolvedValue,
): boolean {
  if (!pickAnswer || typeof pickAnswer !== "object") return false;
  const a = pickAnswer as { type?: string; value?: unknown };
  if (a.type !== answerType) return false;
  switch (resolved.type) {
    case "yes_no":
      return a.value === resolved.value;
    case "number":
      return typeof a.value === "number" && a.value === resolved.value;
    case "multi_choice":
      return a.value === resolved.value;
    case "free_text":
      return (
        typeof a.value === "string" &&
        a.value.trim().toLowerCase() === resolved.value.trim().toLowerCase()
      );
  }
}
