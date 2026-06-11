import { describe, expect, it } from "vitest";
import { coerceMatchField } from "./sync";

// Pure-function tests for the new auto-grading derived fields. The
// resolver lives next to the rest of the sync pass in src/lib/sync.ts;
// these tests focus on the derivation math without touching the DB.
//
// Each match scenario is a single sample point — we pick canonical
// values that exercise the boolean branch ("scored", "didn't score",
// "tied", etc.) for the derived flag, and corner cases (htHomeScore
// null) for the half-aware fields.

const SAMPLE_2_1 = {
  homeScore: 2,
  awayScore: 1,
  htHomeScore: 1,
  htAwayScore: 0,
  wentToPenalties: false,
};

const SAMPLE_0_0 = {
  homeScore: 0,
  awayScore: 0,
  htHomeScore: 0,
  htAwayScore: 0,
  wentToPenalties: false,
};

const SAMPLE_3_3 = {
  homeScore: 3,
  awayScore: 3,
  htHomeScore: 0,
  htAwayScore: 0,
  wentToPenalties: false,
};

const SAMPLE_MISSING_HT = {
  homeScore: 2,
  awayScore: 1,
  htHomeScore: null,
  htAwayScore: null,
  wentToPenalties: false,
};

describe("coerceMatchField — BTTS and per-team scored flags", () => {
  it("BTTS yes when both teams scored", () => {
    expect(coerceMatchField("yes_no", "btts", SAMPLE_2_1)).toEqual({
      type: "yes_no",
      value: true,
    });
  });

  it("BTTS no when one side kept a clean sheet", () => {
    expect(
      coerceMatchField("yes_no", "btts", { ...SAMPLE_2_1, awayScore: 0 }),
    ).toEqual({ type: "yes_no", value: false });
  });

  it("home_scored / away_scored mirror their own column", () => {
    expect(coerceMatchField("yes_no", "home_scored", SAMPLE_2_1)).toEqual({
      type: "yes_no",
      value: true,
    });
    expect(coerceMatchField("yes_no", "away_scored", SAMPLE_2_1)).toEqual({
      type: "yes_no",
      value: true,
    });
    expect(coerceMatchField("yes_no", "home_scored", SAMPLE_0_0)).toEqual({
      type: "yes_no",
      value: false,
    });
  });

  it("clean sheet is the inverse of the OTHER side scoring", () => {
    // Home keeps a clean sheet when AWAY didn't score.
    expect(
      coerceMatchField("yes_no", "clean_sheet_home", { ...SAMPLE_2_1, awayScore: 0 }),
    ).toEqual({ type: "yes_no", value: true });
    expect(
      coerceMatchField("yes_no", "clean_sheet_home", SAMPLE_2_1),
    ).toEqual({ type: "yes_no", value: false });

    // Away keeps a clean sheet when HOME didn't score.
    expect(
      coerceMatchField("yes_no", "clean_sheet_away", { ...SAMPLE_2_1, homeScore: 0 }),
    ).toEqual({ type: "yes_no", value: true });
  });
});

describe("coerceMatchField — over X.5 goals ladder", () => {
  const cases: Array<{ goals: number; expect: boolean }> = [
    { goals: 0, expect: false },
    { goals: 1, expect: false },
  ];
  for (const { goals, expect: exp } of cases) {
    it(`over_2_5_goals = false when total is ${goals}`, () => {
      const m = { ...SAMPLE_0_0, homeScore: goals, awayScore: 0 };
      expect(coerceMatchField("yes_no", "over_2_5_goals", m)).toEqual({
        type: "yes_no",
        value: exp,
      });
    });
  }

  it("over_2_5 boundary: 2 goals → false, 3 goals → true", () => {
    expect(
      coerceMatchField("yes_no", "over_2_5_goals", { ...SAMPLE_0_0, homeScore: 1, awayScore: 1 }),
    ).toEqual({ type: "yes_no", value: false });
    expect(
      coerceMatchField("yes_no", "over_2_5_goals", { ...SAMPLE_0_0, homeScore: 2, awayScore: 1 }),
    ).toEqual({ type: "yes_no", value: true });
  });

  it("over_3_5 catches a 4-goal match, rejects a 3-goal one", () => {
    expect(
      coerceMatchField("yes_no", "over_3_5_goals", SAMPLE_2_1),
    ).toEqual({ type: "yes_no", value: false });
    expect(
      coerceMatchField("yes_no", "over_3_5_goals", { ...SAMPLE_0_0, homeScore: 3, awayScore: 1 }),
    ).toEqual({ type: "yes_no", value: true });
  });

  it("over_0_5_goals catches the goalless edge", () => {
    expect(coerceMatchField("yes_no", "over_0_5_goals", SAMPLE_0_0)).toEqual({
      type: "yes_no",
      value: false,
    });
    expect(coerceMatchField("yes_no", "over_0_5_goals", SAMPLE_2_1)).toEqual({
      type: "yes_no",
      value: true,
    });
  });
});

describe("coerceMatchField — half-aware flags", () => {
  it("first_half_goal reads ht totals", () => {
    expect(
      coerceMatchField("yes_no", "first_half_goal", SAMPLE_2_1),
    ).toEqual({ type: "yes_no", value: true });
    expect(
      coerceMatchField("yes_no", "first_half_goal", SAMPLE_0_0),
    ).toEqual({ type: "yes_no", value: false });
  });

  it("second_half_goal subtracts ht from full", () => {
    // Full 2-1, HT 1-0 → second-half total is 2 → goal in 2nd half.
    expect(
      coerceMatchField("yes_no", "second_half_goal", SAMPLE_2_1),
    ).toEqual({ type: "yes_no", value: true });

    // Full 1-1, HT 1-1 → second-half total is 0 → no goal.
    expect(
      coerceMatchField("yes_no", "second_half_goal", {
        homeScore: 1,
        awayScore: 1,
        htHomeScore: 1,
        htAwayScore: 1,
        wentToPenalties: false,
      }),
    ).toEqual({ type: "yes_no", value: false });
  });

  it("both_halves_scored requires goals on either side of the break", () => {
    expect(
      coerceMatchField("yes_no", "both_halves_scored", SAMPLE_2_1),
    ).toEqual({ type: "yes_no", value: true });

    // 3-0 result, all goals in second half (HT 0-0) → fails.
    expect(
      coerceMatchField("yes_no", "both_halves_scored", {
        homeScore: 3,
        awayScore: 0,
        htHomeScore: 0,
        htAwayScore: 0,
        wentToPenalties: false,
      }),
    ).toEqual({ type: "yes_no", value: false });
  });

  it("skips half-aware flags when ht columns are null", () => {
    expect(
      coerceMatchField("yes_no", "first_half_goal", SAMPLE_MISSING_HT),
    ).toBe("skip");
    expect(
      coerceMatchField("yes_no", "second_half_goal", SAMPLE_MISSING_HT),
    ).toBe("skip");
    expect(
      coerceMatchField("yes_no", "both_halves_scored", SAMPLE_MISSING_HT),
    ).toBe("skip");
  });
});

describe("coerceMatchField — derived numeric fields", () => {
  it("winning_margin is the absolute score difference", () => {
    expect(
      coerceMatchField("number", "winning_margin", SAMPLE_2_1),
    ).toEqual({ type: "number", value: 1 });

    // Away win mirrors home win.
    expect(
      coerceMatchField("number", "winning_margin", {
        ...SAMPLE_2_1,
        homeScore: 0,
        awayScore: 3,
      }),
    ).toEqual({ type: "number", value: 3 });

    // Draw → margin 0.
    expect(
      coerceMatchField("number", "winning_margin", SAMPLE_3_3),
    ).toEqual({ type: "number", value: 0 });
  });

  it("second_half_total subtracts ht_total from the full result", () => {
    // 2-1 with 1-0 at HT → 2 goals in second half.
    expect(
      coerceMatchField("number", "second_half_total", SAMPLE_2_1),
    ).toEqual({ type: "number", value: 2 });
  });

  it("second_half_total skips when ht columns are null", () => {
    expect(
      coerceMatchField("number", "second_half_total", SAMPLE_MISSING_HT),
    ).toBe("skip");
  });
});

describe("coerceMatchField — type mismatch guards", () => {
  it("BTTS only resolves for yes_no answer type", () => {
    expect(coerceMatchField("number", "btts", SAMPLE_2_1)).toBe("skip");
    expect(coerceMatchField("multi_choice", "btts", SAMPLE_2_1)).toBe("skip");
  });

  it("winning_margin only resolves for number answer type", () => {
    expect(
      coerceMatchField("yes_no", "winning_margin", SAMPLE_2_1),
    ).toBe("skip");
  });
});
