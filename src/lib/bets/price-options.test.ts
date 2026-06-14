import { describe, expect, it } from "vitest";
import {
  formatLiveRatio,
  liveDisplayRatios,
  liveOptionPayout,
  MAX_MANUAL_RATIO,
  priceOptionsFromProbabilities,
  priceYesNo,
  repriceAnswerConfigFromOdds,
  resolvePricingMode,
  resolveYesNoSideOdds,
  validateLiveOddsConfig,
  type PriceOptionsConfig,
} from "./price-options";
import type { AnswerConfig } from "./types";

// Tests for the probability→odds pricing that powers exotic live bets.
//
// The headline guarantee: a LIKELY outcome must pay close to nothing,
// and an UNLIKELY one earns up to the cap. This is the fix for the WC
// opener bug where "no VAR in the first half" (near-certain) paid 5x.
// See _plans/2026-06-12-live-bets-llm-overhaul.md.

const config: PriceOptionsConfig = {
  baseStake: 3,
  maxPayout: 25,
  houseEdgePct: 5,
};

describe("priceOptionsFromProbabilities", () => {
  it("REGRESSION: a near-certain outcome does not pay a longshot multiple", () => {
    // The original bug: "no VAR" priced at 5x. With p≈0.8 the fair odds
    // are 1.25, so 3 × 1.25 × 0.95 = 3.56 → floored to stake + 1 = 4.
    // Net win is +1, not +12.
    const [no, yes] = priceOptionsFromProbabilities(
      [
        { value: "no", probability: 0.8 },
        { value: "yes", probability: 0.2 },
      ],
      config,
    );
    expect(no.value).toBe("no");
    expect(no.payout).toBe(4); // stake 3 + 1, NOT 5x
    // The unlikely branch earns meaningfully more than the likely one.
    expect(yes.payout).toBeGreaterThan(no.payout);
  });

  it("prices each option distinctly by its own probability", () => {
    const priced = priceOptionsFromProbabilities(
      [
        { value: "0-15", probability: 0.18 },
        { value: "16-30", probability: 0.16 },
        { value: "31-45", probability: 0.14 },
        { value: "46-90", probability: 0.32 },
        { value: "none", probability: 0.2 },
      ],
      config,
    );
    const payouts = priced.map((p) => p.payout);
    // Not all identical — the whole point of per-choice odds.
    expect(new Set(payouts).size).toBeGreaterThan(1);
    // The least likely window pays at least as much as the most likely.
    const byProb = [...priced].sort((a, b) => a.probability - b.probability);
    expect(byProb[0].payout).toBeGreaterThanOrEqual(
      byProb[byProb.length - 1].payout,
    );
  });

  it("renormalises probabilities that do not sum to 1", () => {
    // Raw weights 2:1 → normalised 0.667 / 0.333. Fair odds 1.5 / 3.0.
    const [a, b] = priceOptionsFromProbabilities(
      [
        { value: "a", probability: 2 },
        { value: "b", probability: 1 },
      ],
      config,
    );
    expect(a.probability).toBeCloseTo(2 / 3, 5);
    expect(b.probability).toBeCloseTo(1 / 3, 5);
    // Odds are whole numbers: 1/(2/3)=1.5 → 2 (floored), 1/(1/3)=3 → 3.
    expect(a.decimalOdds).toBe(2);
    expect(b.decimalOdds).toBe(3);
  });

  it("clamps extreme probabilities so 1/p stays bounded", () => {
    // p=0.999 would invert to ~1.001 odds; clamp to maxProbability 0.98.
    const [hot] = priceOptionsFromProbabilities(
      [
        { value: "hot", probability: 0.999 },
        { value: "cold", probability: 0.001 },
      ],
      { ...config, minProbability: 0.02, maxProbability: 0.98 },
    );
    expect(hot.probability).toBeLessThanOrEqual(0.98);
    expect(hot.decimalOdds).toBeGreaterThanOrEqual(1 / 0.98 - 0.01);
  });

  it("falls back to a uniform split when no probability is usable", () => {
    const priced = priceOptionsFromProbabilities(
      [
        { value: "a", probability: 0 },
        { value: "b", probability: Number.NaN },
        { value: "c", probability: -1 },
      ],
      config,
    );
    expect(priced.map((p) => p.probability)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    // Uniform → identical payouts, which is the safe deg, not a crash.
    expect(new Set(priced.map((p) => p.payout)).size).toBe(1);
  });

  it("handles a single option without throwing", () => {
    const [only] = priceOptionsFromProbabilities(
      [{ value: "x", probability: 1 }],
      config,
    );
    // p clamps to 0.98 → odds ~1.02 → floored to stake + 1.
    expect(only.payout).toBe(config.baseStake + 1);
  });

  it("returns an empty array for an empty market", () => {
    expect(priceOptionsFromProbabilities([], config)).toEqual([]);
  });

  it("caps a deep longshot at maxPayout", () => {
    const [longshot] = priceOptionsFromProbabilities(
      [
        { value: "longshot", probability: 0.02 },
        { value: "rest", probability: 0.98 },
      ],
      config,
    );
    // p=0.02 → odds 50 → 3 × 50 × 0.95 = 142.5, capped at 25.
    expect(longshot.payout).toBe(25);
  });
});

describe("priceYesNo", () => {
  it("prices yes and no independently from the yes-probability", () => {
    const r = priceYesNo(0.25, config);
    // yes (unlikely) should pay more than no (likely).
    expect(r.payoutYes).toBeGreaterThan(r.payoutNo);
    // Whole-number odds: 1/0.25=4 → 4; 1/0.75=1.33 → 2 (floored).
    expect(r.decimalOddsYes).toBe(4);
    expect(r.decimalOddsNo).toBe(2);
  });

  it("defaults a non-finite probability to a coin flip", () => {
    const r = priceYesNo(Number.NaN, config);
    expect(r.payoutYes).toBe(r.payoutNo);
  });

  it("REGRESSION: a likely 'no' does not pay a longshot multiple", () => {
    // Mirrors the binary form of the opener bug.
    const r = priceYesNo(0.2, config); // 20% yes → 80% no
    expect(r.payoutNo).toBe(config.baseStake + 1);
  });
});

describe("resolveYesNoSideOdds", () => {
  const cfg = { decimalOddsYes: 4.0, decimalOddsNo: 1.25 };

  it("returns the yes-side odds when the player picked yes", () => {
    expect(resolveYesNoSideOdds(cfg, true)).toBe(4.0);
  });

  it("returns the no-side odds when the player picked no", () => {
    expect(resolveYesNoSideOdds(cfg, false)).toBe(1.25);
  });

  it("returns null when the side has no captured odds", () => {
    expect(resolveYesNoSideOdds({ decimalOddsYes: 4.0 }, false)).toBeNull();
  });

  it("rejects degenerate odds (<= 1) so the caller falls back", () => {
    expect(resolveYesNoSideOdds({ decimalOddsYes: 1.0 }, true)).toBeNull();
  });

  it("tolerates a null/undefined config", () => {
    expect(resolveYesNoSideOdds(null, true)).toBeNull();
    expect(resolveYesNoSideOdds(undefined, false)).toBeNull();
  });
});

describe("validateLiveOddsConfig", () => {
  it("accepts a multi_choice config whose odds are all > 1", () => {
    const cfg: AnswerConfig = {
      kind: "multi_choice",
      options: [
        { value: "a", labelHe: "א", labelEn: "A" },
        { value: "b", labelHe: "ב", labelEn: "B" },
      ],
      decimalOddsByValue: { a: 1.5, b: 3.0 },
    };
    expect(validateLiveOddsConfig(cfg)).toBe(true);
  });

  it("rejects a multi_choice config with a degenerate odds (<= 1)", () => {
    const cfg: AnswerConfig = {
      kind: "multi_choice",
      options: [{ value: "a", labelHe: "א", labelEn: "A" }],
      decimalOddsByValue: { a: 1.0 },
    };
    expect(validateLiveOddsConfig(cfg)).toBe(false);
  });

  it("rejects a yes_no config with a non-finite per-side odds", () => {
    const cfg: AnswerConfig = {
      kind: "yes_no",
      decimalOddsYes: Number.POSITIVE_INFINITY,
    };
    expect(validateLiveOddsConfig(cfg)).toBe(false);
  });

  it("accepts configs that carry no captured odds", () => {
    expect(validateLiveOddsConfig({ kind: "yes_no" })).toBe(true);
    expect(
      validateLiveOddsConfig({
        kind: "multi_choice",
        options: [{ value: "a", labelHe: "א", labelEn: "A" }],
      }),
    ).toBe(true);
  });
});

describe("repriceAnswerConfigFromOdds", () => {
  const pricingConfig = { baseStake: 3, maxPayout: 25, houseEdgePct: 5 };

  it("re-derives multi_choice payouts from odds and returns the max", () => {
    const cfg: AnswerConfig = {
      kind: "multi_choice",
      options: [
        { value: "a", labelHe: "א", labelEn: "A", payoutOverride: 999 },
        { value: "b", labelHe: "ב", labelEn: "B", payoutOverride: 999 },
      ],
      decimalOddsByValue: { a: 1.25, b: 5.0 },
    };
    const { config, maxPayout } = repriceAnswerConfigFromOdds(cfg, pricingConfig);
    if (config.kind !== "multi_choice") throw new Error("kind changed");
    // Tampered client payout (999) is overwritten by the canonical math.
    expect(config.payoutOverridesByValue).toEqual({ a: 4, b: 14 });
    expect(config.options[0].payoutOverride).toBe(4);
    expect(config.options[1].payoutOverride).toBe(14);
    expect(maxPayout).toBe(14);
  });

  it("re-derives yes_no per-side payouts from odds", () => {
    const cfg: AnswerConfig = {
      kind: "yes_no",
      decimalOddsYes: 5.0,
      decimalOddsNo: 1.25,
      payoutOverrideYes: 999,
      payoutOverrideNo: 999,
    };
    const { config, maxPayout } = repriceAnswerConfigFromOdds(cfg, pricingConfig);
    if (config.kind !== "yes_no") throw new Error("kind changed");
    expect(config.payoutOverrideYes).toBe(14);
    expect(config.payoutOverrideNo).toBe(4);
    expect(maxPayout).toBe(14);
  });

  it("passes through a config with no captured odds", () => {
    const cfg: AnswerConfig = { kind: "yes_no" };
    const { config, maxPayout } = repriceAnswerConfigFromOdds(cfg, pricingConfig);
    expect(config).toBe(cfg);
    expect(maxPayout).toBeNull();
  });

  it("RATIO mode: pays stake × ratio exactly, ignoring house edge + cap", () => {
    const cfg: AnswerConfig = {
      kind: "multi_choice",
      pricingMode: "ratio",
      options: [
        { value: "a", labelHe: "א", labelEn: "A" },
        { value: "b", labelHe: "ב", labelEn: "B" },
      ],
      // 5.0 would normally be 14 after edge/cap; ratio mode pays 3×5 = 15.
      // 40.0 would be capped at 25 in probability mode; ratio pays 3×40 = 120.
      decimalOddsByValue: { a: 5.0, b: 40.0 },
    };
    const { config, maxPayout } = repriceAnswerConfigFromOdds(cfg, pricingConfig);
    if (config.kind !== "multi_choice") throw new Error("kind changed");
    expect(config.payoutOverridesByValue).toEqual({ a: 15, b: 120 });
    expect(maxPayout).toBe(120); // no cap applied
    // The mode flag survives the reprice.
    expect(config.pricingMode).toBe("ratio");
  });

  it("RATIO mode: re-derives yes_no per-side payouts as stake × ratio", () => {
    const cfg: AnswerConfig = {
      kind: "yes_no",
      pricingMode: "ratio",
      decimalOddsYes: 6.0,
      decimalOddsNo: 1.5,
    };
    const { config, maxPayout } = repriceAnswerConfigFromOdds(cfg, pricingConfig);
    if (config.kind !== "yes_no") throw new Error("kind changed");
    expect(config.payoutOverrideYes).toBe(18); // 3 × 6
    expect(config.payoutOverrideNo).toBe(5); // round(3 × 1.5) = 5
    expect(maxPayout).toBe(18);
  });
});

describe("resolvePricingMode", () => {
  it("defaults to probability when the flag is absent", () => {
    expect(
      resolvePricingMode({
        kind: "multi_choice",
        options: [{ value: "a", labelHe: "א", labelEn: "A" }],
      }),
    ).toBe("probability");
    expect(resolvePricingMode({ kind: "yes_no" })).toBe("probability");
  });

  it("reads the ratio flag", () => {
    expect(
      resolvePricingMode({ kind: "yes_no", pricingMode: "ratio" }),
    ).toBe("ratio");
  });

  it("defaults to probability for shapes that never carry the flag", () => {
    expect(resolvePricingMode({ kind: "number" })).toBe("probability");
    expect(resolvePricingMode(null)).toBe("probability");
    expect(resolvePricingMode(undefined)).toBe("probability");
  });
});

describe("liveOptionPayout", () => {
  const cfg = { baseStake: 3, maxPayout: 25, houseEdgePct: 5 };

  it("probability mode matches normalizeOdds (house edge + cap)", () => {
    // 5.0 → 3 × 5 × 0.95 = 14.25 → 14.
    expect(liveOptionPayout(5.0, 3, "probability", cfg)).toBe(14);
    // Deep longshot capped.
    expect(liveOptionPayout(50, 3, "probability", cfg)).toBe(25);
  });

  it("ratio mode pays exactly round(stake × ratio), no edge", () => {
    expect(liveOptionPayout(6, 3, "ratio", cfg)).toBe(18);
    expect(liveOptionPayout(2.5, 10, "ratio", cfg)).toBe(25);
    expect(liveOptionPayout(1.5, 3, "ratio", cfg)).toBe(5); // round(4.5)
  });

  it("ratio mode applies NO cap even for a large multiplier", () => {
    // maxPayout in cfg is 25, but ratio mode ignores it entirely.
    expect(liveOptionPayout(40, 30, "ratio", cfg)).toBe(1200);
  });

  it("ratio mode scales linearly with the player's stake", () => {
    expect(liveOptionPayout(6, 1, "ratio", cfg)).toBe(6);
    expect(liveOptionPayout(6, 5, "ratio", cfg)).toBe(30);
    expect(liveOptionPayout(6, 30, "ratio", cfg)).toBe(180);
  });

  it("ratio mode floors a correct pick at stake + 1", () => {
    // A near-1 ratio that rounds down to the stake still nets at least +1.
    expect(liveOptionPayout(1.01, 3, "ratio", cfg)).toBe(4);
  });
});

describe("validateLiveOddsConfig — ratio bound", () => {
  it("rejects a ratio above MAX_MANUAL_RATIO in ratio mode", () => {
    const cfg: AnswerConfig = {
      kind: "multi_choice",
      pricingMode: "ratio",
      options: [{ value: "a", labelHe: "א", labelEn: "A" }],
      decimalOddsByValue: { a: MAX_MANUAL_RATIO + 1 },
    };
    expect(validateLiveOddsConfig(cfg)).toBe(false);
  });

  it("accepts a ratio at exactly MAX_MANUAL_RATIO", () => {
    const cfg: AnswerConfig = {
      kind: "multi_choice",
      pricingMode: "ratio",
      options: [{ value: "a", labelHe: "א", labelEn: "A" }],
      decimalOddsByValue: { a: MAX_MANUAL_RATIO },
    };
    expect(validateLiveOddsConfig(cfg)).toBe(true);
  });

  it("does not bound probability-mode odds (always ≤ 50, under the cap)", () => {
    const cfg: AnswerConfig = {
      kind: "multi_choice",
      options: [{ value: "a", labelHe: "א", labelEn: "A" }],
      decimalOddsByValue: { a: 50 },
    };
    expect(validateLiveOddsConfig(cfg)).toBe(true);
  });
});

describe("liveDisplayRatios", () => {
  it("returns per-side ratios for a yes_no live bet", () => {
    const cfg: AnswerConfig = {
      kind: "yes_no",
      pricingMode: "ratio",
      decimalOddsYes: 4,
      decimalOddsNo: 2,
    };
    expect(liveDisplayRatios(cfg)).toEqual({ kind: "yes_no", yes: 4, no: 2 });
  });

  it("keeps a side null when only one outcome carries odds", () => {
    const cfg: AnswerConfig = { kind: "yes_no", decimalOddsYes: 3 };
    expect(liveDisplayRatios(cfg)).toEqual({ kind: "yes_no", yes: 3, no: null });
  });

  it("returns the per-option map for a multi_choice live bet", () => {
    const cfg: AnswerConfig = {
      kind: "multi_choice",
      pricingMode: "ratio",
      options: [
        { value: "a", labelHe: "א", labelEn: "A" },
        { value: "b", labelHe: "ב", labelEn: "B" },
      ],
      decimalOddsByValue: { a: 4, b: 2.5 },
    };
    expect(liveDisplayRatios(cfg)).toEqual({
      kind: "multi_choice",
      byValue: { a: 4, b: 2.5 },
    });
  });

  it("drops invalid odds entries (≤ 1, non-finite)", () => {
    const cfg: AnswerConfig = {
      kind: "multi_choice",
      options: [
        { value: "a", labelHe: "א", labelEn: "A" },
        { value: "b", labelHe: "ב", labelEn: "B" },
        { value: "c", labelHe: "ג", labelEn: "C" },
      ],
      decimalOddsByValue: { a: 4, b: 1, c: Number.NaN },
    };
    expect(liveDisplayRatios(cfg)).toEqual({
      kind: "multi_choice",
      byValue: { a: 4 },
    });
  });

  it("returns null for free-pick / legacy bets with no live odds", () => {
    expect(
      liveDisplayRatios({
        kind: "multi_choice",
        options: [{ value: "a", labelHe: "א", labelEn: "A" }],
      }),
    ).toBeNull();
    expect(liveDisplayRatios({ kind: "yes_no" })).toBeNull();
    expect(liveDisplayRatios({ kind: "number" })).toBeNull();
    expect(liveDisplayRatios(null)).toBeNull();
    expect(liveDisplayRatios(undefined)).toBeNull();
  });
});

describe("formatLiveRatio", () => {
  it("renders a clean integer ratio without decimals", () => {
    expect(formatLiveRatio(4)).toBe("×4");
  });

  it("keeps a real fractional ratio", () => {
    expect(formatLiveRatio(2.5)).toBe("×2.5");
  });

  it("rounds a stray float to 2 decimals", () => {
    expect(formatLiveRatio(4.000001)).toBe("×4");
    expect(formatLiveRatio(3.333333)).toBe("×3.33");
  });

  it("returns an empty string for non-finite input", () => {
    expect(formatLiveRatio(Number.NaN)).toBe("");
    expect(formatLiveRatio(Number.POSITIVE_INFINITY)).toBe("");
  });
});
