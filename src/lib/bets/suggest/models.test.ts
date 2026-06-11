import { describe, expect, it } from "vitest";
import {
  costPerCall,
  modelById,
  projectCost,
  SUGGEST_MODELS,
  DEFAULT_SUGGEST_MODEL,
  EST_INPUT_TOKENS,
  EST_OUTPUT_TOKENS,
} from "./models";

describe("modelById", () => {
  it("returns the matching model", () => {
    expect(modelById("claude-haiku-4-5").label).toBe("Haiku 4.5");
  });

  it("falls back to the default for an unknown / null id", () => {
    expect(modelById("retired-model").id).toBe(DEFAULT_SUGGEST_MODEL);
    expect(modelById(null).id).toBe(DEFAULT_SUGGEST_MODEL);
    expect(modelById(undefined).id).toBe(DEFAULT_SUGGEST_MODEL);
  });

  it("marks exactly one model recommended", () => {
    expect(SUGGEST_MODELS.filter((m) => m.recommended)).toHaveLength(1);
  });
});

describe("costPerCall", () => {
  it("computes input+output cost for Sonnet 4.6", () => {
    // 2500 * 3/1e6 + 4000 * 15/1e6 = 0.0075 + 0.06 = 0.0675
    const sonnet = modelById("claude-sonnet-4-6");
    expect(costPerCall(sonnet)).toBeCloseTo(0.0675, 6);
  });

  it("Haiku is cheaper than Sonnet which is cheaper than Opus", () => {
    const h = costPerCall(modelById("claude-haiku-4-5"));
    const s = costPerCall(modelById("claude-sonnet-4-6"));
    const o = costPerCall(modelById("claude-opus-4-8"));
    expect(h).toBeLessThan(s);
    expect(s).toBeLessThan(o);
  });
});

describe("projectCost", () => {
  it("scales by remaining matches and gens per match", () => {
    const sonnet = modelById("claude-sonnet-4-6");
    const single = costPerCall(sonnet);
    expect(projectCost({ model: sonnet, remainingMatches: 103, gensPerMatch: 2 })).toBeCloseTo(
      single * 103 * 2,
      6,
    );
  });

  it("a full tournament on Sonnet stays in the low tens of dollars", () => {
    const sonnet = modelById("claude-sonnet-4-6");
    const total = projectCost({ model: sonnet, remainingMatches: 103, gensPerMatch: 2 });
    expect(total).toBeGreaterThan(5);
    expect(total).toBeLessThan(25);
  });

  it("clamps negative inputs to zero", () => {
    const sonnet = modelById("claude-sonnet-4-6");
    expect(projectCost({ model: sonnet, remainingMatches: -5, gensPerMatch: 2 })).toBe(0);
    expect(projectCost({ model: sonnet, remainingMatches: 10, gensPerMatch: -1 })).toBe(0);
  });

  it("token estimates are positive (guards a bad edit)", () => {
    expect(EST_INPUT_TOKENS).toBeGreaterThan(0);
    expect(EST_OUTPUT_TOKENS).toBeGreaterThan(0);
  });
});
