// Turn a validated LLM suggestion into a priced draft the admin queue can
// persist. The probabilities the model returns are converted to per-choice
// odds + payouts via the same price-options pipeline the manual composer
// uses, so an LLM-authored bet and a hand-authored one are priced
// identically and the server still owns the final payout math.
//
// Pure module: no DB, no SDK, no server-only. The generate action assembles
// these drafts into CreateCustomBetInput rows and calls createCustomBet,
// which re-validates and re-derives payouts before inserting as draft.

import type { AnswerConfig, GradingConfig } from "@/lib/bets/types";
import {
  priceOptionsFromProbabilities,
  priceYesNo,
  type PriceOptionsConfig,
} from "@/lib/bets/price-options";
import type { LiveBetSuggestion } from "./schema";

export type SuggestionDraft = {
  questionHe: string;
  questionEn: string;
  gradingRuleHe: string;
  gradingRuleEn: string;
  answerType: "yes_no" | "multi_choice";
  answerConfig: AnswerConfig;
  stakeSnapshot: number;
  payoutSnapshot: number;
  grading: GradingConfig;
};

// Hebrew tokens that are NEVER valid in a football bet — a generation slip,
// not a stylistic choice (e.g. 'שערות' = hairs, the wrong plural of 'שער' /
// goals, which the model occasionally emitted for "goals"). A suggestion
// containing one is hard-rejected so garbled Hebrew never reaches users. The
// prompt's Hebrew-quality block is the first line of defence; this is the
// deterministic backstop. Kept to UNAMBIGUOUS words only, so a legitimate term
// (e.g. 'נגיחה' = header) is never dropped by mistake.
const HEBREW_DENYLIST = ["שערות"];

function hebrewDenylistHit(s: LiveBetSuggestion): string | null {
  const fields = [
    s.questionHe,
    s.gradingRuleHe,
    ...(s.options ?? []).map((o) => o.labelHe),
  ];
  for (const text of fields) {
    if (!text) continue;
    for (const bad of HEBREW_DENYLIST) {
      if (text.includes(bad)) return `hebrew typo '${bad}'`;
    }
  }
  return null;
}

// Shape-validate a single suggestion beyond what the JSON Schema guarantees:
// the answer-type-specific fields must be present and internally consistent.
// Returns a human-readable reason string on failure, or null when valid.
export function validateSuggestion(s: LiveBetSuggestion): string | null {
  if (!s.questionHe.trim() || !s.questionEn.trim()) return "empty question";
  if (s.gradingRuleHe.trim().length < 3 || s.gradingRuleEn.trim().length < 3) {
    return "grading rule too short";
  }
  const heTypo = hebrewDenylistHit(s);
  if (heTypo) return heTypo;
  if (s.answerType === "multi_choice") {
    const opts = s.options ?? [];
    if (opts.length < 2 || opts.length > 8) return "multi_choice needs 2-8 options";
    const seen = new Set<string>();
    for (const o of opts) {
      if (!o.value.trim() || !o.labelHe.trim() || !o.labelEn.trim()) {
        return "option missing value/label";
      }
      if (seen.has(o.value)) return "duplicate option value";
      seen.add(o.value);
      if (!Number.isFinite(o.probability) || o.probability <= 0 || o.probability >= 1) {
        return "option probability out of range";
      }
    }
    return null;
  }
  // yes_no
  if (
    s.yesProbability == null ||
    !Number.isFinite(s.yesProbability) ||
    s.yesProbability <= 0 ||
    s.yesProbability >= 1
  ) {
    return "yes probability out of range";
  }
  return null;
}

// Convert a validated suggestion into a priced draft. Caller must have run
// validateSuggestion first (this trusts the shape). Returns { error } if the
// answer type is one we don't price.
export function suggestionToDraft(
  s: LiveBetSuggestion,
  pricingConfig: PriceOptionsConfig,
): SuggestionDraft | { error: string } {
  if (s.answerType === "multi_choice") {
    const opts = s.options ?? [];
    const priced = priceOptionsFromProbabilities(
      opts.map((o) => ({ value: o.value, probability: o.probability })),
      pricingConfig,
    );
    const decimalOddsByValue: Record<string, number> = {};
    const payoutOverridesByValue: Record<string, number> = {};
    const options = opts.map((o, i) => {
      decimalOddsByValue[o.value] = priced[i].decimalOdds;
      payoutOverridesByValue[o.value] = priced[i].payout;
      return {
        value: o.value,
        labelHe: o.labelHe,
        labelEn: o.labelEn,
        payoutOverride: priced[i].payout,
      };
    });
    const answerConfig: AnswerConfig = {
      kind: "multi_choice",
      options,
      decimalOddsByValue,
      payoutOverridesByValue,
    };
    return {
      questionHe: s.questionHe.trim(),
      questionEn: s.questionEn.trim(),
      gradingRuleHe: s.gradingRuleHe.trim(),
      gradingRuleEn: s.gradingRuleEn.trim(),
      answerType: "multi_choice",
      answerConfig,
      stakeSnapshot: pricingConfig.baseStake,
      payoutSnapshot: Math.max(...priced.map((p) => p.payout)),
      grading: s.grading,
    };
  }

  if (s.answerType === "yes_no") {
    const yn = priceYesNo(s.yesProbability as number, pricingConfig);
    const answerConfig: AnswerConfig = {
      kind: "yes_no",
      decimalOddsYes: yn.decimalOddsYes,
      decimalOddsNo: yn.decimalOddsNo,
      payoutOverrideYes: yn.payoutYes,
      payoutOverrideNo: yn.payoutNo,
    };
    return {
      questionHe: s.questionHe.trim(),
      questionEn: s.questionEn.trim(),
      gradingRuleHe: s.gradingRuleHe.trim(),
      gradingRuleEn: s.gradingRuleEn.trim(),
      answerType: "yes_no",
      answerConfig,
      stakeSnapshot: pricingConfig.baseStake,
      payoutSnapshot: Math.max(yn.payoutYes, yn.payoutNo),
      grading: s.grading,
    };
  }

  return { error: `unsupported answer type: ${String(s.answerType)}` };
}
