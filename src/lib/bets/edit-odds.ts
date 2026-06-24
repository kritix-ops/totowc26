// Helpers for the "edit odds on a published live bet" admin flow. Pure (no
// DB / no fetch) so the entry-button visibility, the page guard, and the form
// all agree on the same rules, and so the predicate is unit-testable.

import { liveDisplayRatios, resolvePricingMode } from "@/lib/bets/price-options";
import type { AnswerConfig, PricingMode } from "@/lib/bets/types";

// Can an admin edit the odds of this bet IN PLACE (vs cancel + recreate)?
// True only for a published, live (match/day), not-yet-locked bet that already
// carries per-option/per-side live odds. Mirrors the server action's guards so
// the button never shows for a bet the action would reject.
export function canEditPublishedOdds(args: {
  status: string;
  scope: string;
  lockAt: string | Date;
  answerConfig: unknown;
  now?: Date;
}): boolean {
  const now = args.now ?? new Date();
  if (args.status !== "open") return false;
  if (args.scope !== "match" && args.scope !== "day") return false;
  if (new Date(args.lockAt).getTime() <= now.getTime()) return false;
  return liveDisplayRatios(args.answerConfig as AnswerConfig | null) != null;
}

// One editable row per outcome: the option's label, its stable `value` (the
// key the new odds are submitted under), and the current ×N. Empty for any
// config that carries no editable live odds.
export type OddsEditRow = {
  value: string;
  label: string;
  currentOdds: number | null;
};

export function liveOddsEditRows(
  config: AnswerConfig | null | undefined,
  isHebrew: boolean,
): OddsEditRow[] {
  if (!config) return [];
  if (config.kind === "multi_choice" && config.decimalOddsByValue) {
    const odds = config.decimalOddsByValue;
    return config.options.map((o) => ({
      value: o.value,
      label: isHebrew ? o.labelHe : o.labelEn,
      currentOdds: odds[o.value] ?? null,
    }));
  }
  if (
    config.kind === "yes_no" &&
    (config.decimalOddsYes !== undefined || config.decimalOddsNo !== undefined)
  ) {
    return [
      { value: "yes", label: isHebrew ? "כן" : "Yes", currentOdds: config.decimalOddsYes ?? null },
      { value: "no", label: isHebrew ? "לא" : "No", currentOdds: config.decimalOddsNo ?? null },
    ];
  }
  return [];
}

// The pricing mode drives the form's helper copy: in "ratio" mode the ×N IS
// the exact multiplier the player wins; in "probability" mode it is the fair
// odds the payout is derived from.
export function oddsEditPricingMode(
  config: AnswerConfig | null | undefined,
): PricingMode {
  return resolvePricingMode(config ?? null);
}
