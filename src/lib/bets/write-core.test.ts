import { describe, expect, it } from "vitest";
import { computeLivePickPayout, resolveLiveStake } from "./write-core";

// Pure-helper tests for the variable-stake clamp. The full
// writeCustomPickTx flow is integration-tested via the manual QA
// checklist in _plans/2026-06-11-variable-live-bet-stake.md §11 —
// stubbing the txn + advisory lock here would invert the dependency
// without catching anything the manual run misses.

describe("resolveLiveStake", () => {
  const cfg = { minStake: 1, maxStake: 30 };

  it("falls back to the bet's default stake when none is requested", () => {
    expect(resolveLiveStake(undefined, 3, cfg)).toEqual({
      stake: 3,
      clamped: false,
    });
  });

  it("uses the requested stake when it sits inside the admin range", () => {
    expect(resolveLiveStake(10, 3, cfg)).toEqual({
      stake: 10,
      clamped: false,
    });
    expect(resolveLiveStake(1, 3, cfg)).toEqual({
      stake: 1,
      clamped: false,
    });
    expect(resolveLiveStake(30, 3, cfg)).toEqual({
      stake: 30,
      clamped: false,
    });
  });

  it("clamps above-max to maxStake and flags it", () => {
    expect(resolveLiveStake(999, 3, cfg)).toEqual({
      stake: 30,
      clamped: true,
    });
  });

  it("clamps below-min to minStake and flags it", () => {
    expect(resolveLiveStake(0, 3, cfg)).toEqual({
      stake: 1,
      clamped: true,
    });
    expect(resolveLiveStake(-5, 3, cfg)).toEqual({
      stake: 1,
      clamped: true,
    });
  });

  it("treats non-integer / NaN as a tamper attempt — clamps to minStake", () => {
    expect(resolveLiveStake(NaN, 3, cfg)).toEqual({
      stake: 1,
      clamped: true,
    });
    expect(resolveLiveStake(1.5, 3, cfg)).toEqual({
      stake: 1,
      clamped: true,
    });
    expect(resolveLiveStake(Infinity, 3, cfg)).toEqual({
      stake: 1,
      clamped: true,
    });
  });

  it("clamps fallback stake too when the bet's snapshot sits outside the new range", () => {
    // Admin tightens max after the bet was published at stake 50; the
    // fallback path still respects the new bound.
    expect(resolveLiveStake(undefined, 50, cfg)).toEqual({
      stake: 30,
      clamped: false,
    });
  });

  it("honours an admin override that allows a wider range", () => {
    const wide = { minStake: 1, maxStake: 100 };
    expect(resolveLiveStake(75, 3, wide)).toEqual({
      stake: 75,
      clamped: false,
    });
  });
});

// computeLivePickPayout is the SHARED definition the pick-submit path and the
// admin odds-reprice path both call — so an existing pick re-priced to new
// odds lands on exactly the number a fresh pick at those odds would. These pin
// the contract the reprice relies on.
describe("computeLivePickPayout", () => {
  const liveCfg = {
    baseStake: 3,
    minStake: 1,
    maxStake: 30,
    maxPayoutRatio: 8,
    maxPayoutCeiling: 100,
    houseEdgePct: 5,
  };

  it("ratio-mode multi_choice pays exact round(stake × ratio)", () => {
    const r = computeLivePickPayout({
      answerType: "multi_choice",
      answerConfig: {
        kind: "multi_choice",
        pricingMode: "ratio",
        options: [{ value: "a", labelHe: "א", labelEn: "A" }],
        decimalOddsByValue: { a: 5 },
      },
      betLevelDecimalOdds: null,
      betStakeSnapshot: 3,
      betPayoutSnapshot: 15,
      answer: { type: "multi_choice", value: "a" },
      stake: 4,
      liveCfg,
    });
    expect(r).toEqual({ payout: 20, fromOdds: true }); // round(4 × 5)
  });

  it("ratio-mode yes_no reads the side the player actually picked", () => {
    const r = computeLivePickPayout({
      answerType: "yes_no",
      answerConfig: {
        kind: "yes_no",
        pricingMode: "ratio",
        decimalOddsYes: 3,
        decimalOddsNo: 2,
      },
      betLevelDecimalOdds: null,
      betStakeSnapshot: 3,
      betPayoutSnapshot: 9,
      answer: { type: "yes_no", value: false }, // picked "no" → ×2
      stake: 5,
      liveCfg,
    });
    expect(r).toEqual({ payout: 10, fromOdds: true }); // round(5 × 2)
  });

  it("flags fromOdds=false and floors at stake+1 when no odds are captured", () => {
    const r = computeLivePickPayout({
      answerType: "multi_choice",
      answerConfig: {
        kind: "multi_choice",
        options: [{ value: "a", labelHe: "א", labelEn: "A" }],
      },
      betLevelDecimalOdds: null,
      betStakeSnapshot: 3,
      betPayoutSnapshot: 9,
      answer: { type: "multi_choice", value: "a" },
      stake: 3,
      liveCfg,
    });
    expect(r.fromOdds).toBe(false);
    expect(r.payout).toBeGreaterThanOrEqual(4); // stake + 1 floor
  });
});
