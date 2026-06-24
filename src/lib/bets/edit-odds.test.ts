import { describe, expect, it } from "vitest";
import { canEditPublishedOdds, liveOddsEditRows } from "./edit-odds";
import type { AnswerConfig } from "@/lib/bets/types";

const now = new Date("2026-06-24T12:00:00Z");
const future = "2026-06-24T20:00:00Z";
const past = "2026-06-24T06:00:00Z";

const multiCfg: AnswerConfig = {
  kind: "multi_choice",
  options: [
    { value: "a", labelHe: "א", labelEn: "A" },
    { value: "b", labelHe: "ב", labelEn: "B" },
  ],
  decimalOddsByValue: { a: 5, b: 3 },
};

describe("canEditPublishedOdds", () => {
  const base = {
    status: "open",
    scope: "match",
    lockAt: future,
    answerConfig: multiCfg,
    now,
  };

  it("allows an open, live, pre-lock bet that carries odds", () => {
    expect(canEditPublishedOdds(base)).toBe(true);
    expect(canEditPublishedOdds({ ...base, scope: "day" })).toBe(true);
  });

  it("rejects any status other than open", () => {
    for (const status of ["draft", "locked", "graded", "reversed", "cancelled"]) {
      expect(canEditPublishedOdds({ ...base, status })).toBe(false);
    }
  });

  it("rejects non-live scopes", () => {
    for (const scope of ["tournament", "stage", "group"]) {
      expect(canEditPublishedOdds({ ...base, scope })).toBe(false);
    }
  });

  it("rejects a bet whose lock has already passed", () => {
    expect(canEditPublishedOdds({ ...base, lockAt: past })).toBe(false);
  });

  it("rejects a bet with no captured odds", () => {
    expect(
      canEditPublishedOdds({
        ...base,
        answerConfig: {
          kind: "multi_choice",
          options: [{ value: "a", labelHe: "א", labelEn: "A" }],
        },
      }),
    ).toBe(false);
    expect(canEditPublishedOdds({ ...base, answerConfig: null })).toBe(false);
  });
});

describe("liveOddsEditRows", () => {
  it("maps multi_choice options to their current ×N", () => {
    expect(liveOddsEditRows(multiCfg, true)).toEqual([
      { value: "a", label: "א", currentOdds: 5 },
      { value: "b", label: "ב", currentOdds: 3 },
    ]);
  });

  it("uses English labels when not Hebrew", () => {
    expect(liveOddsEditRows(multiCfg, false)[0]).toEqual({
      value: "a",
      label: "A",
      currentOdds: 5,
    });
  });

  it("maps yes_no sides to כן / לא rows", () => {
    expect(
      liveOddsEditRows({ kind: "yes_no", decimalOddsYes: 3, decimalOddsNo: 2 }, true),
    ).toEqual([
      { value: "yes", label: "כן", currentOdds: 3 },
      { value: "no", label: "לא", currentOdds: 2 },
    ]);
  });

  it("returns [] when the config carries no editable odds", () => {
    expect(
      liveOddsEditRows(
        { kind: "multi_choice", options: [{ value: "a", labelHe: "א", labelEn: "A" }] },
        true,
      ),
    ).toEqual([]);
    expect(liveOddsEditRows(null, true)).toEqual([]);
  });
});
