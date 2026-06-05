import { describe, expect, it } from "vitest";
import { makeBudget } from "../agent-loop.mts";
import {
  BUDGET_USD_HARD_CAP,
  PRICE_PER_MTOK_INPUT_USD,
  PRICE_PER_MTOK_OUTPUT_USD,
  PRICE_PER_MTOK_CACHE_READ_USD,
  PRICE_PER_MTOK_CACHE_WRITE_USD,
} from "../config.mts";

describe("makeBudget", () => {
  it("starts at zero", () => {
    const b = makeBudget();
    expect(b.usdSpent).toBe(0);
    expect(b.inputTokens).toBe(0);
    expect(b.outputTokens).toBe(0);
    expect(b.withinCap()).toBe(true);
  });

  it("priced math matches the per-MTok constants", () => {
    const b = makeBudget();
    b.add({ input_tokens: 1_000_000, output_tokens: 0 });
    expect(b.usdSpent).toBeCloseTo(PRICE_PER_MTOK_INPUT_USD, 6);

    const b2 = makeBudget();
    b2.add({ input_tokens: 0, output_tokens: 1_000_000 });
    expect(b2.usdSpent).toBeCloseTo(PRICE_PER_MTOK_OUTPUT_USD, 6);
  });

  it("accumulates cache reads and writes at the cheaper / write rates", () => {
    const b = makeBudget();
    b.add({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    });
    expect(b.usdSpent).toBeCloseTo(
      PRICE_PER_MTOK_CACHE_READ_USD + PRICE_PER_MTOK_CACHE_WRITE_USD,
      6,
    );
    // Cache tokens count toward "input" for the tally so we never
    // forget they were used.
    expect(b.inputTokens).toBe(2_000_000);
  });

  it("withinCap flips false once spend crosses the hard cap", () => {
    const b = makeBudget();
    // Spend just under the cap.
    const justUnder = Math.floor(
      ((BUDGET_USD_HARD_CAP * 0.99) / PRICE_PER_MTOK_OUTPUT_USD) * 1_000_000,
    );
    b.add({ input_tokens: 0, output_tokens: justUnder });
    expect(b.withinCap()).toBe(true);

    // Now push it over.
    b.add({
      input_tokens: 0,
      output_tokens: Math.ceil((BUDGET_USD_HARD_CAP * 0.05 / PRICE_PER_MTOK_OUTPUT_USD) * 1_000_000),
    });
    expect(b.withinCap()).toBe(false);
  });
});
