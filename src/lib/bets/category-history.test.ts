import { describe, expect, it } from "vitest";
import {
  aggregateCategoryHistory,
  buildCategoryEvGuidance,
  categoryStat,
  MIN_CATEGORY_SAMPLE_BETS,
  type CategoryBetRow,
  type CategoryStat,
} from "./category-history";

// Minimal row helper — only the fields the aggregator reads.
function row(p: Partial<CategoryBetRow>): CategoryBetRow {
  return {
    category: null,
    questionHe: "",
    questionEn: "",
    grading: null,
    picks: 0,
    correct: 0,
    staked: 0,
    returned: 0,
    ...p,
  };
}

describe("aggregateCategoryHistory", () => {
  it("buckets legacy (null-category) rows via the classifier", () => {
    const hist = aggregateCategoryHistory([
      row({ questionHe: "האם יהיה נבדל?", picks: 10, correct: 3, staked: 100, returned: 60 }),
      row({ questionHe: "עוד נבדל במחצית?", picks: 5, correct: 1, staked: 50, returned: 20 }),
    ]);
    const offside = categoryStat(hist, "offside");
    expect(offside.bets).toBe(2);
    expect(offside.picks).toBe(15);
    expect(offside.correct).toBe(4);
    expect(offside.staked).toBe(150);
    expect(offside.returned).toBe(80);
  });

  it("prefers the stored category over the classifier when present", () => {
    // Question text says offside, but the stored column says corner — the
    // explicit admin choice wins.
    const hist = aggregateCategoryHistory([
      row({ category: "corner", questionHe: "האם יהיה נבדל?", picks: 4, staked: 40, returned: 50 }),
    ]);
    expect(categoryStat(hist, "corner").bets).toBe(1);
    expect(categoryStat(hist, "offside").bets).toBe(0);
  });

  it("computes hit-rate and EV% with the right sign", () => {
    // 250 picks staked 1621, returned 1061 → EV ≈ -34.5% (the real offside number).
    const hist = aggregateCategoryHistory([
      row({ category: "offside", picks: 250, correct: 61, staked: 1621, returned: 1061 }),
    ]);
    const s = categoryStat(hist, "offside");
    expect(s.hitRate).toBeCloseTo(61 / 250, 5);
    expect(s.evPct).toBeCloseTo(((1061 - 1621) / 1621) * 100, 4);
    expect(s.evPct!).toBeLessThan(0); // a drain, not a winner
  });

  it("flags a winning category with positive EV", () => {
    const hist = aggregateCategoryHistory([
      row({ category: "red", picks: 103, correct: 80, staked: 575, returned: 974 }),
    ]);
    expect(categoryStat(hist, "red").evPct!).toBeGreaterThan(0);
  });

  it("gates on bet count, not pick count", () => {
    // 250 picks but only 4 bets → below the gate (one match swings a 4-sample).
    const fourBets = Array.from({ length: 4 }, () =>
      row({ category: "var", picks: 60, correct: 30, staked: 300, returned: 320 }),
    );
    expect(categoryStat(aggregateCategoryHistory(fourBets), "var").meetsSampleGate).toBe(false);

    const twentyBets = Array.from({ length: MIN_CATEGORY_SAMPLE_BETS }, () =>
      row({ category: "goals", picks: 5, correct: 2, staked: 30, returned: 40 }),
    );
    expect(categoryStat(aggregateCategoryHistory(twentyBets), "goals").meetsSampleGate).toBe(true);
  });

  it("returns a zeroed stat for a category with no history", () => {
    const s = categoryStat(new Map(), "penalty");
    expect(s).toMatchObject({ category: "penalty", bets: 0, picks: 0, hitRate: null, evPct: null, meetsSampleGate: false });
  });

  it("respects a custom minimum sample", () => {
    const tenBets = Array.from({ length: 10 }, () => row({ category: "corner", picks: 1 }));
    expect(categoryStat(aggregateCategoryHistory(tenBets, 5), "corner").meetsSampleGate).toBe(true);
    expect(categoryStat(aggregateCategoryHistory(tenBets, 20), "corner").meetsSampleGate).toBe(false);
  });
});

describe("buildCategoryEvGuidance", () => {
  // Minimal CategoryStat helper.
  function stat(p: Partial<CategoryStat> & { category: CategoryStat["category"] }): CategoryStat {
    return {
      bets: 25,
      picks: 250,
      correct: 60,
      staked: 1000,
      returned: 600,
      hitRate: 0.24,
      evPct: -40,
      meetsSampleGate: true,
      ...p,
    };
  }

  it("flags a gated drain category with rounded EV and steers selection", () => {
    const g = buildCategoryEvGuidance([
      stat({ category: "offside", evPct: -34.5, picks: 250 }),
    ]);
    expect(g).toContain("Offside");
    expect(g).toContain("-35%"); // rounded to nearest 5
    expect(g).toContain("250 picks");
    expect(g.toLowerCase()).toContain("sparingly");
    // Must NOT instruct probability shifts — that path failed the backtest.
    expect(g.toLowerCase()).toContain("calibrated to the dossier");
  });

  it("returns empty when no category clears the drain bar", () => {
    expect(buildCategoryEvGuidance([stat({ category: "goals", evPct: 12 })])).toBe("");
    expect(buildCategoryEvGuidance([stat({ category: "corner", evPct: -8 })])).toBe("");
    expect(buildCategoryEvGuidance([])).toBe("");
  });

  it("ignores drains that fail the sample gate or are 'other'", () => {
    expect(
      buildCategoryEvGuidance([stat({ category: "var", evPct: -50, meetsSampleGate: false })]),
    ).toBe("");
    expect(buildCategoryEvGuidance([stat({ category: "other", evPct: -50 })])).toBe("");
  });

  it("lists multiple drains worst-first", () => {
    const g = buildCategoryEvGuidance([
      stat({ category: "corner", evPct: -18 }),
      stat({ category: "offside", evPct: -34 }),
    ]);
    expect(g.indexOf("Offside")).toBeLessThan(g.indexOf("Corner"));
  });
});
