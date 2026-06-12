import { describe, expect, it } from "vitest";
import {
  customBetPointsDisplay,
  matchPickPointsDisplay,
  matchPickOutcome,
  pointsTone,
} from "./past-view";

describe("pointsTone", () => {
  it("is positive for a win", () => {
    expect(pointsTone(15)).toBe("positive");
    expect(pointsTone(1)).toBe("positive");
  });
  it("is negative for a loss", () => {
    expect(pointsTone(-5)).toBe("negative");
    expect(pointsTone(-1)).toBe("negative");
  });
  it("is neutral for zero", () => {
    expect(pointsTone(0)).toBe("neutral");
  });
});

describe("matchPickPointsDisplay", () => {
  it("renders nothing when the user never picked", () => {
    expect(matchPickPointsDisplay({ hasPick: false, points: null })).toEqual({
      kind: "none",
    });
    // Even a stray points value can't conjure a chip without a pick.
    expect(matchPickPointsDisplay({ hasPick: false, points: 15 })).toEqual({
      kind: "none",
    });
  });

  it("is pending when picked but not graded (live / awaiting grade)", () => {
    expect(matchPickPointsDisplay({ hasPick: true, points: null })).toEqual({
      kind: "pending",
    });
  });

  it("shows a toned chip once graded", () => {
    expect(matchPickPointsDisplay({ hasPick: true, points: 15 })).toEqual({
      kind: "points",
      tone: "positive",
      points: 15,
    });
    expect(matchPickPointsDisplay({ hasPick: true, points: -5 })).toEqual({
      kind: "points",
      tone: "negative",
      points: -5,
    });
    expect(matchPickPointsDisplay({ hasPick: true, points: 0 })).toEqual({
      kind: "points",
      tone: "neutral",
      points: 0,
    });
  });
});

describe("customBetPointsDisplay", () => {
  it("renders nothing when the user never picked", () => {
    expect(
      customBetPointsDisplay({ hasPick: false, status: "graded", points: 10 }),
    ).toEqual({ kind: "none" });
  });

  it("renders nothing for a cancelled bet even if the user picked", () => {
    // Cancelled bets never paid out — a 0 would wrongly imply "you scored 0".
    expect(
      customBetPointsDisplay({
        hasPick: true,
        status: "cancelled",
        points: null,
      }),
    ).toEqual({ kind: "none" });
  });

  it("is pending when graded-status but points not yet written", () => {
    expect(
      customBetPointsDisplay({ hasPick: true, status: "graded", points: null }),
    ).toEqual({ kind: "pending" });
  });

  it("shows a toned chip for graded and reversed bets", () => {
    expect(
      customBetPointsDisplay({ hasPick: true, status: "graded", points: 25 }),
    ).toEqual({ kind: "points", tone: "positive", points: 25 });
    expect(
      customBetPointsDisplay({ hasPick: true, status: "reversed", points: 0 }),
    ).toEqual({ kind: "points", tone: "neutral", points: 0 });
    expect(
      customBetPointsDisplay({ hasPick: true, status: "graded", points: -3 }),
    ).toEqual({ kind: "points", tone: "negative", points: -3 });
  });
});

describe("matchPickOutcome", () => {
  it("prefers exact over direction when both are set", () => {
    expect(
      matchPickOutcome({ wasExact: true, wasCorrectOutcome: true }),
    ).toBe("exact");
  });
  it("is direction when only the outcome was right", () => {
    expect(
      matchPickOutcome({ wasExact: false, wasCorrectOutcome: true }),
    ).toBe("direction");
  });
  it("is wrong when neither flag is set", () => {
    expect(
      matchPickOutcome({ wasExact: false, wasCorrectOutcome: false }),
    ).toBe("wrong");
  });
  it("is wrong when flags are null (ungraded / no data)", () => {
    expect(
      matchPickOutcome({ wasExact: null, wasCorrectOutcome: null }),
    ).toBe("wrong");
  });
});
