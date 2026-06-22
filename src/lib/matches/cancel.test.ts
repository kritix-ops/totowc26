import { describe, expect, it } from "vitest";
import {
  gradeCanceledGuess,
  outcome,
  validateCancelResolution,
  type CancelResolutionConfig,
} from "./cancel";

// Pure-function tests for how a canceled match's 1/X/2 guesses settle. No DB.
// These encode the confirmed product rules: void is neutral, awarded grades
// vs a technical scoreline with NO risk penalty, split pays everyone a flat
// amount. The scoring path (scoreCanceledMatch) routes through
// gradeCanceledGuess, so this truth-table is what protects player points.

const SCORING = { scoringExact: 15, scoringOutcome: 5 };

describe("outcome", () => {
  it("maps scorelines to 1 / X / 2", () => {
    expect(outcome(2, 0)).toBe("1");
    expect(outcome(0, 0)).toBe("X");
    expect(outcome(1, 3)).toBe("2");
  });
});

describe("gradeCanceledGuess - void", () => {
  it("is neutral for everyone: 0 points, never a penalty", () => {
    const g = gradeCanceledGuess({
      resolution: "void",
      config: null,
      guessHome: 2,
      guessAway: 1,
      ...SCORING,
    });
    expect(g).toEqual({ points: 0, wasExact: false, wasCorrectOutcome: false });
  });
});

describe("gradeCanceledGuess - split", () => {
  it("pays the flat configured amount to any guess", () => {
    const config: CancelResolutionConfig = { kind: "split", points: 7 };
    const winner = gradeCanceledGuess({
      resolution: "split",
      config,
      guessHome: 3,
      guessAway: 3,
      ...SCORING,
    });
    const loser = gradeCanceledGuess({
      resolution: "split",
      config,
      guessHome: 0,
      guessAway: 9,
      ...SCORING,
    });
    expect(winner.points).toBe(7);
    expect(loser.points).toBe(7);
    expect(winner.wasExact).toBe(false);
    expect(winner.wasCorrectOutcome).toBe(false);
  });
});

describe("gradeCanceledGuess - awarded (technical scoreline)", () => {
  const config: CancelResolutionConfig = { kind: "awarded", home: 3, away: 0 };

  it("awards the exact-score points on a dead-on guess", () => {
    const g = gradeCanceledGuess({
      resolution: "awarded",
      config,
      guessHome: 3,
      guessAway: 0,
      ...SCORING,
    });
    expect(g).toEqual({ points: 15, wasExact: true, wasCorrectOutcome: true });
  });

  it("awards the outcome points on a correct-direction guess", () => {
    const g = gradeCanceledGuess({
      resolution: "awarded",
      config,
      guessHome: 1,
      guessAway: 0,
      ...SCORING,
    });
    expect(g).toEqual({ points: 5, wasExact: false, wasCorrectOutcome: true });
  });

  it("gives 0 (NOT a penalty) on a wrong guess, even though risk mode exists", () => {
    const g = gradeCanceledGuess({
      resolution: "awarded",
      config,
      guessHome: 0,
      guessAway: 2,
      ...SCORING,
    });
    expect(g.points).toBe(0);
    expect(g.points).toBeGreaterThanOrEqual(0);
    expect(g.wasCorrectOutcome).toBe(false);
  });

  it("falls back to neutral when the awarded config is malformed", () => {
    const g = gradeCanceledGuess({
      resolution: "awarded",
      config: null,
      guessHome: 1,
      guessAway: 1,
      ...SCORING,
    });
    expect(g).toEqual({ points: 0, wasExact: false, wasCorrectOutcome: false });
  });
});

describe("validateCancelResolution", () => {
  it("accepts void with null or void config", () => {
    expect(validateCancelResolution("void", null)).toBeNull();
    expect(validateCancelResolution("void", { kind: "void" })).toBeNull();
  });

  it("accepts a valid awarded scoreline", () => {
    expect(
      validateCancelResolution("awarded", { kind: "awarded", home: 3, away: 0 }),
    ).toBeNull();
  });

  it("rejects an awarded config with a negative or non-integer score", () => {
    expect(
      validateCancelResolution("awarded", { kind: "awarded", home: -1, away: 0 }),
    ).toBe("invalid_awarded_score");
    expect(
      validateCancelResolution("awarded", {
        kind: "awarded",
        home: 1.5,
        away: 0,
      }),
    ).toBe("invalid_awarded_score");
  });

  it("rejects an awarded resolution carrying the wrong config shape", () => {
    expect(
      validateCancelResolution("awarded", { kind: "split", points: 3 }),
    ).toBe("invalid_awarded_score");
  });

  it("accepts a valid split amount and rejects bad ones", () => {
    expect(
      validateCancelResolution("split", { kind: "split", points: 5 }),
    ).toBeNull();
    expect(
      validateCancelResolution("split", { kind: "split", points: -1 }),
    ).toBe("invalid_split_points");
    expect(
      validateCancelResolution("split", { kind: "split", points: 5000 }),
    ).toBe("invalid_split_points");
  });
});
