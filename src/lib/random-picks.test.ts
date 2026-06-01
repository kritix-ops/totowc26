import { describe, expect, it } from "vitest";
import { randomCustomAnswer, randomMatchScore, type Rng } from "./random-picks";

// Pure-function tests for the random-pick generator. A deterministic RNG lets
// us assert exact branch behaviour without flakiness: seqRng replays a fixed
// list of [0,1) values, one per rng() call.

function seqRng(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("randomMatchScore", () => {
  it("maps low rng values to a 0-0 scoreline", () => {
    // First bucket (goals=0) owns the lowest slice of the distribution.
    const r = randomMatchScore(seqRng([0, 0]));
    expect(r).toEqual({ home: 0, away: 0 });
  });

  it("maps rng=1 toward the top of the goal distribution", () => {
    // rng just under 1 lands in the last populated bucket (5 goals).
    const r = randomMatchScore(seqRng([0.999, 0.999]));
    expect(r.home).toBe(5);
    expect(r.away).toBe(5);
  });

  it("always returns goal counts within 0..5", () => {
    for (let i = 0; i < 200; i++) {
      const { home, away } = randomMatchScore();
      expect(home).toBeGreaterThanOrEqual(0);
      expect(home).toBeLessThanOrEqual(5);
      expect(away).toBeGreaterThanOrEqual(0);
      expect(away).toBeLessThanOrEqual(5);
    }
  });
});

describe("randomCustomAnswer - yes_no", () => {
  it("returns true for rng < 0.5 and false otherwise", () => {
    expect(randomCustomAnswer("yes_no", { kind: "yes_no" }, seqRng([0.2]))).toEqual({
      type: "yes_no",
      value: true,
    });
    expect(randomCustomAnswer("yes_no", { kind: "yes_no" }, seqRng([0.8]))).toEqual({
      type: "yes_no",
      value: false,
    });
  });
});

describe("randomCustomAnswer - number", () => {
  it("fills a uniform integer inside a tight [min, max]", () => {
    const a = randomCustomAnswer("number", { min: 0, max: 4 }, seqRng([0]));
    expect(a).toEqual({ type: "number", value: 0 });
    const b = randomCustomAnswer("number", { min: 0, max: 4 }, seqRng([0.999]));
    expect(b).toEqual({ type: "number", value: 4 });
  });

  it("skips an unbounded number bet (no max)", () => {
    expect(randomCustomAnswer("number", { min: 0 }, seqRng([0.5]))).toBeNull();
  });

  it("skips a number bet with too wide a span (unwinnable)", () => {
    // 0..90 (minute of first goal) is effectively unwinnable on exact match.
    expect(randomCustomAnswer("number", { min: 0, max: 90 }, seqRng([0.5]))).toBeNull();
  });
});

describe("randomCustomAnswer - free_text", () => {
  it("always skips (no bounded option set)", () => {
    expect(randomCustomAnswer("free_text", { kind: "free_text" })).toBeNull();
  });
});

describe("randomCustomAnswer - multi_choice (static options)", () => {
  const config = {
    kind: "multi_choice",
    options: [
      { value: "yes", payoutOverride: 2 }, // favourite (short odds)
      { value: "no", payoutOverride: 10 }, // longshot
    ],
  };

  it("picks the favourite when rng lands in its (larger) weight slice", () => {
    // weights: 1/2=0.5 and 1/10=0.1 → total 0.6. rng*0.6 < 0.5 → favourite.
    expect(randomCustomAnswer("multi_choice", config, seqRng([0]))!.value).toBe("yes");
  });

  it("picks the longshot when rng lands in its slice", () => {
    // rng=0.99 → 0.594 > 0.5 → second bucket.
    expect(randomCustomAnswer("multi_choice", config, seqRng([0.99]))!.value).toBe("no");
  });

  it("falls back to uniform when an option lacks a payout", () => {
    const partial = {
      kind: "multi_choice",
      options: [{ value: "a" }, { value: "b", payoutOverride: 3 }],
    };
    // Uniform over 2 → rng<0.5 picks first.
    expect(randomCustomAnswer("multi_choice", partial, seqRng([0.1]))!.value).toBe("a");
    expect(randomCustomAnswer("multi_choice", partial, seqRng([0.9]))!.value).toBe("b");
  });
});

describe("randomCustomAnswer - multi_choice (dynamic source)", () => {
  // Outright player bets keep options=[] and expose the priced roster only
  // through payoutOverridesByValue.
  const config = {
    kind: "multi_choice",
    options: [],
    dynamicSource: "players",
    payoutOverridesByValue: { "1001": 4, "1002": 25 },
  };

  it("selects a player id from the priced map", () => {
    const a = randomCustomAnswer("multi_choice", config, seqRng([0]));
    expect(a).not.toBeNull();
    expect(["1001", "1002"]).toContain(a!.value);
  });

  it("favours the shorter-odds player", () => {
    // weights 1/4=0.25, 1/25=0.04 → total 0.29; rng=0 → first key.
    expect(randomCustomAnswer("multi_choice", config, seqRng([0]))!.value).toBe("1001");
  });

  it("returns null when there are no candidates at all", () => {
    expect(
      randomCustomAnswer("multi_choice", { kind: "multi_choice", options: [] }),
    ).toBeNull();
  });
});
