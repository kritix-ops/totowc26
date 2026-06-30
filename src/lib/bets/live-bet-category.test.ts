import { describe, expect, it } from "vitest";
import {
  classifyLiveBetCategory,
  isLiveBetCategory,
  LIVE_BET_CATEGORIES,
  liveBetCategoryLabel,
} from "./live-bet-category";

describe("LIVE_BET_CATEGORIES catalogue", () => {
  it("is the exact closed set locked with the admin (yellow/red split)", () => {
    expect([...LIVE_BET_CATEGORIES]).toEqual([
      "offside",
      "yellow",
      "red",
      "corner",
      "penalty",
      "goals",
      "btts",
      "var",
      "other",
    ]);
  });

  it("keeps yellow and red as separate buckets", () => {
    expect(LIVE_BET_CATEGORIES).toContain("yellow");
    expect(LIVE_BET_CATEGORIES).toContain("red");
  });
});

describe("isLiveBetCategory", () => {
  it("accepts every catalogue member", () => {
    for (const c of LIVE_BET_CATEGORIES) expect(isLiveBetCategory(c)).toBe(true);
  });
  it("rejects unknown / non-string values", () => {
    expect(isLiveBetCategory("cards")).toBe(false);
    expect(isLiveBetCategory("")).toBe(false);
    expect(isLiveBetCategory(null)).toBe(false);
    expect(isLiveBetCategory(7)).toBe(false);
  });
});

describe("liveBetCategoryLabel", () => {
  it("returns bilingual labels", () => {
    expect(liveBetCategoryLabel("offside", "he")).toBe("נבדלים");
    expect(liveBetCategoryLabel("offside", "en")).toBe("Offside");
    expect(liveBetCategoryLabel("var", "he")).toBe("VAR");
  });
});

describe("classifyLiveBetCategory — grading spec (high confidence)", () => {
  it("maps the offsides stat to offside regardless of wording", () => {
    expect(
      classifyLiveBetCategory({
        questionHe: "שאלה כללית בלי מילת מפתח",
        questionEn: "a generic question",
        grading: { source: "auto_api_football", stat: "offsides", aggregate: "per_match" },
      }),
    ).toBe("offside");
  });

  it("splits yellow vs red from the card stats", () => {
    expect(
      classifyLiveBetCategory({
        grading: { source: "auto_api_football", stat: "red_cards", aggregate: "per_match" },
      }),
    ).toBe("red");
    expect(
      classifyLiveBetCategory({
        grading: { source: "auto_api_football", stat: "yellow_cards", aggregate: "per_match" },
      }),
    ).toBe("yellow");
  });

  it("maps the corners stat to corner", () => {
    expect(
      classifyLiveBetCategory({
        grading: { source: "auto_api_football", stat: "corners", aggregate: "sum_day" },
      }),
    ).toBe("corner");
  });

  it("maps event-timeline metrics (red card in a half, first goal window)", () => {
    expect(
      classifyLiveBetCategory({
        grading: {
          source: "auto_api_football",
          events: { metric: "red_card", window: "1H", op: ">=", value: 1 },
        },
      }),
    ).toBe("red");
    expect(
      classifyLiveBetCategory({
        grading: {
          source: "auto_api_football",
          firstEventWindow: { metric: "goal" },
        },
      }),
    ).toBe("goals");
  });

  it("maps the btts and goal final-score fields", () => {
    expect(
      classifyLiveBetCategory({
        grading: { source: "auto_football_data", field: "btts" },
      }),
    ).toBe("btts");
    expect(
      classifyLiveBetCategory({
        grading: { source: "auto_football_data", field: "over_2_5_goals" },
      }),
    ).toBe("goals");
  });

  it("falls through to text when the spec has no dedicated bucket", () => {
    expect(
      classifyLiveBetCategory({
        questionHe: "כמה קרנות יהיו במחצית",
        grading: { source: "auto_api_football", stat: "possession", aggregate: "per_match" },
      }),
    ).toBe("corner");
  });
});

describe("classifyLiveBetCategory — text heuristic", () => {
  it("classifies the headline categories from Hebrew", () => {
    expect(classifyLiveBetCategory({ questionHe: "האם יהיה נבדל במחצית הראשונה?" })).toBe("offside");
    expect(classifyLiveBetCategory({ questionHe: "כמה קרנות במשחק?" })).toBe("corner");
    expect(classifyLiveBetCategory({ questionHe: "האם יורחק שחקן בכרטיס אדום?" })).toBe("red");
    expect(classifyLiveBetCategory({ questionHe: "כמה כרטיסים צהובים?" })).toBe("yellow");
    expect(classifyLiveBetCategory({ questionHe: "האם יוענק פנדל?" })).toBe("penalty");
  });

  it("classifies from English", () => {
    expect(classifyLiveBetCategory({ questionEn: "Will there be an offside in the first half?" })).toBe("offside");
    expect(classifyLiveBetCategory({ questionEn: "Total corners in the match?" })).toBe("corner");
  });

  it("prefers btts over the generic goals rule", () => {
    expect(
      classifyLiveBetCategory({ questionHe: "האם שתי הקבוצות יכבשו שער?" }),
    ).toBe("btts");
    expect(
      classifyLiveBetCategory({ questionEn: "Will both teams score a goal?" }),
    ).toBe("btts");
  });

  it("classifies a plain goal market as goals", () => {
    expect(classifyLiveBetCategory({ questionHe: "כמה שערים יובקעו במשחק?" })).toBe("goals");
  });

  it("returns other when nothing matches (no prior, priced as today)", () => {
    expect(classifyLiveBetCategory({ questionHe: "מי ינצח את המשחק?" })).toBe("other");
    expect(classifyLiveBetCategory({})).toBe("other");
  });
});
