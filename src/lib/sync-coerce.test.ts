import { describe, expect, it } from "vitest";
import { coerceMatchField, type AutoFootballField } from "./sync";

// Unit tests for the auto_football_data resolver. Every field that can
// be derived from the final match score is exercised against the answer
// type it expects, plus a "wrong answer type" case to confirm the
// resolver refuses to silently mismatch — that misclassification would
// grade everyone "wrong" without warning.
//
// See _plans/2026-06-11-variable-live-bet-stake.md follow-up scope:
// 10+ derived fields ride on data we already store, so no new sync
// source is needed.

const FINAL = {
  homeScore: 3,
  awayScore: 1,
  htHomeScore: 1 as number | null,
  htAwayScore: 0 as number | null,
  wentToPenalties: false as boolean | null,
};

const SCORELESS = {
  homeScore: 0,
  awayScore: 0,
  htHomeScore: 0 as number | null,
  htAwayScore: 0 as number | null,
  wentToPenalties: false as boolean | null,
};

const SECOND_HALF_ONLY = {
  // Halftime 0-0, full time 2-1 → all goals in 2nd half.
  homeScore: 2,
  awayScore: 1,
  htHomeScore: 0 as number | null,
  htAwayScore: 0 as number | null,
  wentToPenalties: false as boolean | null,
};

const HOME_SHUTOUT = {
  // 4-0 result, 2-0 at HT → home wins clean sheet, both halves scored.
  homeScore: 4,
  awayScore: 0,
  htHomeScore: 2 as number | null,
  htAwayScore: 0 as number | null,
  wentToPenalties: false as boolean | null,
};

describe("coerceMatchField — derived yes/no fields", () => {
  it("btts: true when both teams scored", () => {
    expect(coerceMatchField("yes_no", "btts", FINAL)).toEqual({
      type: "yes_no",
      value: true,
    });
  });

  it("btts: false on a clean sheet", () => {
    expect(coerceMatchField("yes_no", "btts", HOME_SHUTOUT)).toEqual({
      type: "yes_no",
      value: false,
    });
  });

  it("btts: false on 0-0", () => {
    expect(coerceMatchField("yes_no", "btts", SCORELESS)).toEqual({
      type: "yes_no",
      value: false,
    });
  });

  it("home_scored / away_scored mirror per-team goals", () => {
    expect(coerceMatchField("yes_no", "home_scored", FINAL)).toEqual({
      type: "yes_no",
      value: true,
    });
    expect(coerceMatchField("yes_no", "home_scored", SCORELESS)).toEqual({
      type: "yes_no",
      value: false,
    });
    expect(coerceMatchField("yes_no", "away_scored", HOME_SHUTOUT)).toEqual({
      type: "yes_no",
      value: false,
    });
  });

  it("clean_sheet_home: away didn't score", () => {
    expect(coerceMatchField("yes_no", "clean_sheet_home", HOME_SHUTOUT)).toEqual({
      type: "yes_no",
      value: true,
    });
    expect(coerceMatchField("yes_no", "clean_sheet_home", FINAL)).toEqual({
      type: "yes_no",
      value: false,
    });
  });

  it("clean_sheet_away: home didn't score", () => {
    expect(coerceMatchField("yes_no", "clean_sheet_away", SCORELESS)).toEqual({
      type: "yes_no",
      value: true,
    });
    expect(coerceMatchField("yes_no", "clean_sheet_away", FINAL)).toEqual({
      type: "yes_no",
      value: false,
    });
  });

  it("over_0_5: any goal at all → true", () => {
    expect(coerceMatchField("yes_no", "over_0_5_goals", FINAL)).toEqual({
      type: "yes_no",
      value: true,
    });
    expect(coerceMatchField("yes_no", "over_0_5_goals", SCORELESS)).toEqual({
      type: "yes_no",
      value: false,
    });
  });

  it("over_1_5 / over_2_5 / over_3_5 / over_4_5 use strict-greater-than", () => {
    expect(coerceMatchField("yes_no", "over_1_5_goals", FINAL)).toEqual({
      type: "yes_no",
      value: true, // 4 goals
    });
    expect(coerceMatchField("yes_no", "over_2_5_goals", FINAL)).toEqual({
      type: "yes_no",
      value: true, // 4 goals
    });
    expect(coerceMatchField("yes_no", "over_3_5_goals", FINAL)).toEqual({
      type: "yes_no",
      value: true, // 4 > 3
    });
    expect(coerceMatchField("yes_no", "over_4_5_goals", FINAL)).toEqual({
      type: "yes_no",
      value: false, // 4 !> 4
    });
    expect(coerceMatchField("yes_no", "over_4_5_goals", HOME_SHUTOUT)).toEqual({
      type: "yes_no",
      value: false, // exactly 4 → not over 4.5
    });
  });

  it("first_half_goal: any goal in HT score", () => {
    expect(coerceMatchField("yes_no", "first_half_goal", FINAL)).toEqual({
      type: "yes_no",
      value: true,
    });
    expect(coerceMatchField("yes_no", "first_half_goal", SECOND_HALF_ONLY)).toEqual({
      type: "yes_no",
      value: false,
    });
  });

  it("second_half_goal: total - ht > 0", () => {
    expect(coerceMatchField("yes_no", "second_half_goal", FINAL)).toEqual({
      type: "yes_no",
      value: true, // 4 - 1 = 3
    });
    expect(coerceMatchField("yes_no", "second_half_goal", SCORELESS)).toEqual({
      type: "yes_no",
      value: false,
    });
  });

  it("both_halves_scored: needs at least one goal in each half", () => {
    expect(coerceMatchField("yes_no", "both_halves_scored", FINAL)).toEqual({
      type: "yes_no",
      value: true, // HT 1, 2nd 3
    });
    expect(coerceMatchField("yes_no", "both_halves_scored", SECOND_HALF_ONLY)).toEqual({
      type: "yes_no",
      value: false, // HT 0, 2nd 3
    });
    expect(coerceMatchField("yes_no", "both_halves_scored", HOME_SHUTOUT)).toEqual({
      type: "yes_no",
      value: true, // HT 2, 2nd 2
    });
  });
});

describe("coerceMatchField — derived numeric fields", () => {
  it("winning_margin uses absolute score difference", () => {
    expect(coerceMatchField("number", "winning_margin", FINAL)).toEqual({
      type: "number",
      value: 2,
    });
    // Symmetric — away winning gives the same magnitude.
    expect(
      coerceMatchField("number", "winning_margin", {
        ...FINAL,
        homeScore: 0,
        awayScore: 3,
      }),
    ).toEqual({ type: "number", value: 3 });
    expect(coerceMatchField("number", "winning_margin", SCORELESS)).toEqual({
      type: "number",
      value: 0,
    });
  });

  it("second_half_total subtracts halftime total from full-time total", () => {
    expect(coerceMatchField("number", "second_half_total", FINAL)).toEqual({
      type: "number",
      value: 3, // (3+1) - (1+0)
    });
    expect(coerceMatchField("number", "second_half_total", SECOND_HALF_ONLY)).toEqual({
      type: "number",
      value: 3, // all in 2nd half
    });
    expect(coerceMatchField("number", "second_half_total", SCORELESS)).toEqual({
      type: "number",
      value: 0,
    });
  });
});

describe("coerceMatchField — wrong answer type rejection", () => {
  // Picking the wrong answer_type for a field must skip back to manual
  // rather than silently grade every pick as 0. The fields below are
  // representative: a yes/no field tested with answerType=number, a
  // number field tested with answerType=yes_no, and a multi_choice field
  // tested with answerType=yes_no.
  const cases: Array<{ field: AutoFootballField; wrong: "yes_no" | "number" | "multi_choice" }> = [
    { field: "btts",                wrong: "number" },
    { field: "home_scored",         wrong: "number" },
    { field: "over_2_5_goals",      wrong: "multi_choice" },
    { field: "winning_margin",      wrong: "yes_no" },
    { field: "second_half_total",   wrong: "yes_no" },
    { field: "first_half_goal",     wrong: "number" },
    { field: "second_half_goal",    wrong: "number" },
    { field: "both_halves_scored",  wrong: "number" },
  ];
  for (const c of cases) {
    it(`skips ${c.field} when answerType is ${c.wrong}`, () => {
      expect(coerceMatchField(c.wrong, c.field, FINAL)).toBe("skip");
    });
  }
});

describe("coerceMatchField — multi_choice range options", () => {
  // A range bet ("how many goals? 0-1 / 2-3 / 4+") auto-grades by mapping
  // the numeric field onto the option whose range contains it. This is the
  // path that was silently skipping, so a 5-goal game never resolved to 4+.
  const GOALS = [
    { value: "0-1", labelHe: "0-1", labelEn: "0-1" },
    { value: "2-3", labelHe: "2-3", labelEn: "2-3" },
    { value: "4+", labelHe: "4+", labelEn: "4+" },
  ];

  it("maps total_goals onto the matching range option", () => {
    // FINAL is 3-1 → 4 total goals → 4+.
    expect(coerceMatchField("multi_choice", "total_goals", FINAL, GOALS)).toEqual(
      { type: "multi_choice", value: "4+" },
    );
    // SCORELESS is 0-0 → 0 total → 0-1.
    expect(
      coerceMatchField("multi_choice", "total_goals", SCORELESS, GOALS),
    ).toEqual({ type: "multi_choice", value: "0-1" });
  });

  it("maps winning_margin onto a range option", () => {
    // FINAL margin = |3-1| = 2 → 2-3.
    expect(
      coerceMatchField("multi_choice", "winning_margin", FINAL, GOALS),
    ).toEqual({ type: "multi_choice", value: "2-3" });
  });

  it("still resolves number bets to the raw number", () => {
    expect(coerceMatchField("number", "total_goals", FINAL, GOALS)).toEqual({
      type: "number",
      value: 4,
    });
  });

  it("skips a range bet when no options are supplied", () => {
    expect(coerceMatchField("multi_choice", "total_goals", FINAL)).toBe("skip");
  });

  it("skips when the number falls outside every option range", () => {
    const partial = [
      { value: "0-1", labelHe: "0-1", labelEn: "0-1" },
      { value: "2-3", labelHe: "2-3", labelEn: "2-3" },
    ];
    // FINAL = 4 total goals, no option covers it → manual.
    expect(
      coerceMatchField("multi_choice", "total_goals", FINAL, partial),
    ).toBe("skip");
  });
});

describe("coerceMatchField — missing halftime score", () => {
  // Halves-dependent fields need both htHomeScore and htAwayScore. If
  // either is null the resolver returns "skip" instead of guessing —
  // a manual grade will follow.
  const noHt = {
    ...FINAL,
    htHomeScore: null as number | null,
    htAwayScore: null as number | null,
  };
  const fields: AutoFootballField[] = [
    "ht_score",
    "ht_total",
    "first_half_goal",
    "second_half_goal",
    "both_halves_scored",
    "second_half_total",
  ];
  for (const field of fields) {
    it(`skips ${field} when halftime score is missing`, () => {
      // pick the matching answerType so we exercise the null guard, not
      // the answer-type mismatch.
      const answerType =
        field === "ht_score" ? "multi_choice"
        : field === "ht_total" || field === "second_half_total" ? "number"
        : "yes_no";
      expect(coerceMatchField(answerType, field, noHt)).toBe("skip");
    });
  }
});
