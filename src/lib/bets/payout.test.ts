import { describe, expect, it } from "vitest";
import type {
  AnswerConfig,
  MultiChoiceConfig,
  PickAnswer,
} from "./types";
import {
  gradedPickPoints,
  resolvePickPayoutAtGrade,
  resolvePickPayoutAtSubmit,
} from "./payout";

// Pure-function tests for the per-option payout resolver. No DB. Both
// callers (the pick action and the grade action) route through these
// two functions, so getting the truth-table right here is what keeps
// outright bets paying the correct per-option amount.

const flatBet = {
  answerType: "multi_choice" as const,
  betLevelPayout: 14,
  answerConfig: {
    kind: "multi_choice",
    options: [
      { value: "mbappe", labelHe: "Mbappé", labelEn: "Mbappé" },
      { value: "longshot", labelHe: "Longshot", labelEn: "Longshot" },
    ],
  } satisfies MultiChoiceConfig,
};

const pricedBet = {
  answerType: "multi_choice" as const,
  betLevelPayout: 14,
  answerConfig: {
    kind: "multi_choice",
    options: [
      {
        value: "mbappe",
        labelHe: "Mbappé",
        labelEn: "Mbappé",
        payoutOverride: 7,
      },
      {
        value: "kane",
        labelHe: "Kane",
        labelEn: "Kane",
        payoutOverride: 8,
      },
      {
        value: "longshot",
        labelHe: "Longshot",
        labelEn: "Longshot",
        payoutOverride: 25,
      },
    ],
  } satisfies MultiChoiceConfig,
};

const pickMbappe: PickAnswer = { type: "multi_choice", value: "mbappe" };
const pickLongshot: PickAnswer = { type: "multi_choice", value: "longshot" };
const pickUnknown: PickAnswer = { type: "multi_choice", value: "ghost_player" };
const pickYes: PickAnswer = { type: "yes_no", value: true };

describe("resolvePickPayoutAtSubmit", () => {
  it("uses per-option override when the chosen option has one", () => {
    const r = resolvePickPayoutAtSubmit({
      answerType: pricedBet.answerType,
      answerConfig: pricedBet.answerConfig,
      answer: pickMbappe,
      betLevelPayout: pricedBet.betLevelPayout,
    });
    expect(r).toBe(7);
  });

  it("uses the longshot's larger override when picked", () => {
    const r = resolvePickPayoutAtSubmit({
      answerType: pricedBet.answerType,
      answerConfig: pricedBet.answerConfig,
      answer: pickLongshot,
      betLevelPayout: pricedBet.betLevelPayout,
    });
    expect(r).toBe(25);
  });

  it("falls back to bet-level payout for flat-payout bets (no overrides)", () => {
    const r = resolvePickPayoutAtSubmit({
      answerType: flatBet.answerType,
      answerConfig: flatBet.answerConfig,
      answer: pickMbappe,
      betLevelPayout: flatBet.betLevelPayout,
    });
    expect(r).toBe(14);
  });

  it("falls back to bet-level when the picked option is not in the config", () => {
    const r = resolvePickPayoutAtSubmit({
      answerType: pricedBet.answerType,
      answerConfig: pricedBet.answerConfig,
      answer: pickUnknown,
      betLevelPayout: pricedBet.betLevelPayout,
    });
    expect(r).toBe(14);
  });

  it("falls back to bet-level for yes_no bets with no per-branch overrides", () => {
    const r = resolvePickPayoutAtSubmit({
      answerType: "yes_no",
      answerConfig: { kind: "yes_no" },
      answer: pickYes,
      betLevelPayout: 6,
    });
    expect(r).toBe(6);
  });

  it("uses payoutOverrideYes when the user picks yes on a yes_no bet", () => {
    const r = resolvePickPayoutAtSubmit({
      answerType: "yes_no",
      answerConfig: {
        kind: "yes_no",
        payoutOverrideYes: 100,
        payoutOverrideNo: 20,
      },
      answer: pickYes,
      betLevelPayout: 100,
    });
    expect(r).toBe(100);
  });

  it("uses payoutOverrideNo when the user picks no on a yes_no bet", () => {
    const r = resolvePickPayoutAtSubmit({
      answerType: "yes_no",
      answerConfig: {
        kind: "yes_no",
        payoutOverrideYes: 100,
        payoutOverrideNo: 20,
      },
      answer: { type: "yes_no", value: false },
      betLevelPayout: 100,
    });
    expect(r).toBe(20);
  });

  it("falls back to bet-level when only the opposite branch is priced", () => {
    const r = resolvePickPayoutAtSubmit({
      answerType: "yes_no",
      answerConfig: { kind: "yes_no", payoutOverrideYes: 100 },
      answer: { type: "yes_no", value: false },
      betLevelPayout: 6,
    });
    expect(r).toBe(6);
  });

  it("ignores a zero/negative yes_no override and falls back to bet-level", () => {
    const r = resolvePickPayoutAtSubmit({
      answerType: "yes_no",
      answerConfig: {
        kind: "yes_no",
        payoutOverrideYes: 0,
        payoutOverrideNo: -5,
      },
      answer: pickYes,
      betLevelPayout: 6,
    });
    expect(r).toBe(6);
  });

  it("rounds a non-integer yes_no override to nearest integer", () => {
    const r = resolvePickPayoutAtSubmit({
      answerType: "yes_no",
      answerConfig: { kind: "yes_no", payoutOverrideYes: 99.6 },
      answer: pickYes,
      betLevelPayout: 6,
    });
    expect(r).toBe(100);
  });

  it("rounds a non-integer override to nearest integer", () => {
    const cfg: AnswerConfig = {
      kind: "multi_choice",
      options: [
        {
          value: "x",
          labelHe: "x",
          labelEn: "x",
          payoutOverride: 7.6,
        },
      ],
    };
    const r = resolvePickPayoutAtSubmit({
      answerType: "multi_choice",
      answerConfig: cfg,
      answer: { type: "multi_choice", value: "x" },
      betLevelPayout: 14,
    });
    expect(r).toBe(8);
  });

  it("ignores a negative/zero override and falls back to bet-level", () => {
    const cfg: AnswerConfig = {
      kind: "multi_choice",
      options: [
        {
          value: "x",
          labelHe: "x",
          labelEn: "x",
          payoutOverride: 0,
        },
      ],
    };
    const r = resolvePickPayoutAtSubmit({
      answerType: "multi_choice",
      answerConfig: cfg,
      answer: { type: "multi_choice", value: "x" },
      betLevelPayout: 14,
    });
    expect(r).toBe(14);
  });

  it("handles missing answerConfig gracefully (treats as flat-payout)", () => {
    const r = resolvePickPayoutAtSubmit({
      answerType: "multi_choice",
      answerConfig: null,
      answer: pickMbappe,
      betLevelPayout: 14,
    });
    expect(r).toBe(14);
  });
});

describe("resolvePickPayoutAtGrade", () => {
  it("uses the snapshotted pick payout when present", () => {
    const r = resolvePickPayoutAtGrade({
      pickPayoutSnapshot: 7,
      betLevelPayout: 14,
    });
    expect(r).toBe(7);
  });

  it("falls back to bet-level for pre-migration picks with NULL snapshot", () => {
    const r = resolvePickPayoutAtGrade({
      pickPayoutSnapshot: null,
      betLevelPayout: 14,
    });
    expect(r).toBe(14);
  });

  it("respects the snapshot even when it equals the bet-level value", () => {
    const r = resolvePickPayoutAtGrade({
      pickPayoutSnapshot: 14,
      betLevelPayout: 14,
    });
    expect(r).toBe(14);
  });

  it("respects a high longshot snapshot beyond the bet-level value", () => {
    const r = resolvePickPayoutAtGrade({
      pickPayoutSnapshot: 25,
      betLevelPayout: 14,
    });
    expect(r).toBe(25);
  });
});

describe("gradedPickPoints", () => {
  it("pays the per-pick snapshot for a correct pick", () => {
    expect(
      gradedPickPoints({
        correct: true,
        pickPayoutSnapshot: 6,
        betLevelPayout: 15,
      }),
    ).toBe(6);
  });

  it("pays 0 for an incorrect pick regardless of snapshot", () => {
    expect(
      gradedPickPoints({
        correct: false,
        pickPayoutSnapshot: 6,
        betLevelPayout: 15,
      }),
    ).toBe(0);
  });

  it("falls back to bet-level only for a NULL snapshot", () => {
    expect(
      gradedPickPoints({
        correct: true,
        pickPayoutSnapshot: null,
        betLevelPayout: 14,
      }),
    ).toBe(14);
  });

  // Regression: the US–Paraguay "red card" incident. The bet resolved to
  // "No" (decimalOddsNo 2, priced 6 for a stake-3 player), but the
  // bet-level payoutSnapshot held the "Yes" headline (15). The auto
  // grader inlined the bet-level value and paid every "No" winner 15
  // regardless of stake. The winner must be paid their own snapshot (6),
  // NOT the bet-level headline.
  it("does not pay the bet-level headline when the winning side is priced lower", () => {
    expect(
      gradedPickPoints({
        correct: true,
        pickPayoutSnapshot: 6,
        betLevelPayout: 15,
      }),
    ).not.toBe(15);
  });

  // A high-stake winner must keep their scaled-up snapshot, not collapse
  // to the flat bet-level number — the exact loss the stake-10 players
  // took in the incident (snapshot 20, paid 15).
  it("preserves a stake-scaled snapshot above the bet-level value", () => {
    expect(
      gradedPickPoints({
        correct: true,
        pickPayoutSnapshot: 20,
        betLevelPayout: 15,
      }),
    ).toBe(20);
  });
});
