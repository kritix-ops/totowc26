import { describe, expect, it } from "vitest";
import { suggestionToDraft, validateSuggestion } from "./transform";
import type { LiveBetSuggestion } from "./schema";

const pricingConfig = { baseStake: 3, maxPayout: 25, houseEdgePct: 5 };

const mcBase: LiveBetSuggestion = {
  questionHe: "מתי תהיה התערבות VAR?",
  questionEn: "When will VAR intervene?",
  answerType: "multi_choice",
  options: [
    { value: "first_half", labelHe: "מחצית 1", labelEn: "1st half", probability: 0.2 },
    { value: "second_half", labelHe: "מחצית 2", labelEn: "2nd half", probability: 0.2 },
    { value: "none", labelHe: "אין", labelEn: "None", probability: 0.6 },
  ],
  gradingRuleHe: "לפי שידור רשמי.",
  gradingRuleEn: "Per official broadcast.",
  grading: null,
  rationale: "VAR rarely intervenes; 'none' is the heavy favourite.",
};

const yesNoBase: LiveBetSuggestion = {
  questionHe: "יהיה כרטיס אדום?",
  questionEn: "Will there be a red card?",
  answerType: "yes_no",
  yesProbability: 0.25,
  gradingRuleHe: "כרטיס אדום אחד או יותר ב-90 הדקות.",
  gradingRuleEn: "One or more red cards in regulation.",
  grading: { source: "auto_api_football", stat: "red_cards", aggregate: "per_match" },
  rationale: "Roughly a quarter of matches see a red.",
};

describe("validateSuggestion", () => {
  it("accepts a well-formed multi_choice suggestion", () => {
    expect(validateSuggestion(mcBase)).toBeNull();
  });

  it("accepts a well-formed yes_no suggestion", () => {
    expect(validateSuggestion(yesNoBase)).toBeNull();
  });

  it("rejects multi_choice with fewer than 2 options", () => {
    expect(
      validateSuggestion({ ...mcBase, options: [mcBase.options![0]] }),
    ).toMatch(/2-8 options/);
  });

  it("rejects duplicate option values", () => {
    const dup = { ...mcBase, options: [mcBase.options![0], mcBase.options![0]] };
    expect(validateSuggestion(dup)).toMatch(/duplicate/);
  });

  it("rejects an out-of-range option probability", () => {
    const bad = {
      ...mcBase,
      options: [
        { ...mcBase.options![0], probability: 1.5 },
        mcBase.options![1],
        mcBase.options![2],
      ],
    };
    expect(validateSuggestion(bad)).toMatch(/probability out of range/);
  });

  it("rejects yes_no without a probability", () => {
    expect(validateSuggestion({ ...yesNoBase, yesProbability: undefined })).toMatch(
      /yes probability/,
    );
  });

  it("rejects a too-short grading rule", () => {
    expect(validateSuggestion({ ...mcBase, gradingRuleEn: "x" })).toMatch(/too short/);
  });
});

describe("suggestionToDraft", () => {
  it("prices a multi_choice market with per-option odds", () => {
    const draft = suggestionToDraft(mcBase, pricingConfig);
    if ("error" in draft) throw new Error(draft.error);
    expect(draft.answerType).toBe("multi_choice");
    if (draft.answerConfig.kind !== "multi_choice") throw new Error("kind");
    const odds = draft.answerConfig.decimalOddsByValue!;
    // 'none' is the favourite → lowest odds; the half windows are longshots.
    expect(odds.none).toBeLessThan(odds.first_half);
    // Per-option payouts differ — the flat-odds bug is gone.
    const payouts = draft.answerConfig.payoutOverridesByValue!;
    expect(new Set(Object.values(payouts)).size).toBeGreaterThan(1);
    // The favourite ('none', p=0.6 → odds 1.67) pays the least; the
    // snapshot payout is the highest (longshot) outcome.
    expect(payouts.none).toBe(Math.min(...Object.values(payouts)));
    expect(draft.payoutSnapshot).toBe(Math.max(...Object.values(payouts)));
  });

  it("prices a yes_no market per side", () => {
    const draft = suggestionToDraft(yesNoBase, pricingConfig);
    if ("error" in draft) throw new Error(draft.error);
    if (draft.answerConfig.kind !== "yes_no") throw new Error("kind");
    // Unlikely 'yes' pays more than likely 'no'.
    expect(draft.answerConfig.payoutOverrideYes).toBeGreaterThan(
      draft.answerConfig.payoutOverrideNo!,
    );
    expect(draft.answerConfig.decimalOddsYes).toBeGreaterThan(
      draft.answerConfig.decimalOddsNo!,
    );
    // Grading config is carried through untouched.
    expect(draft.grading).toEqual(yesNoBase.grading);
  });

  it("carries an event-timeline grading spec through untouched", () => {
    const eventBet: LiveBetSuggestion = {
      questionHe: "יהיה אדום במחצית הראשונה?",
      questionEn: "Red card in the first half?",
      answerType: "yes_no",
      yesProbability: 0.12,
      gradingRuleHe: "כרטיס אדום אחד או יותר עד דקה 45.",
      gradingRuleEn: "One or more red cards by minute 45.",
      grading: {
        source: "auto_api_football",
        events: { metric: "red_card", window: "1H", op: ">=", value: 1 },
      },
      rationale: "First-half reds are rare.",
    };
    const draft = suggestionToDraft(eventBet, pricingConfig);
    if ("error" in draft) throw new Error("priced");
    expect(draft.grading).toEqual(eventBet.grading);
    if (draft.answerConfig.kind !== "yes_no") throw new Error("kind");
    // Unlikely 'yes' still prices higher than 'no'.
    expect(draft.answerConfig.payoutOverrideYes).toBeGreaterThan(
      draft.answerConfig.payoutOverrideNo!,
    );
  });

  it("carries the stake snapshot from the pricing base stake", () => {
    const draft = suggestionToDraft(mcBase, pricingConfig);
    if ("error" in draft) throw new Error("priced");
    expect(draft.stakeSnapshot).toBe(pricingConfig.baseStake);
  });
});
