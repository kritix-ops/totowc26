import { describe, expect, it } from "vitest";
import {
  knockoutWinner,
  validateMatchResult,
  type MatchResultContext,
  type MatchResultInput,
} from "./result";

// Pure-function tests for the admin manual-result validation. No DB. These
// encode the invariants the server action leans on before it flips a match to
// final and re-grades every pick, so this truth-table is what stops a fat-finger
// entry from mis-scoring the pool. See
// _plans/2026-07-03-manual-match-result-entry.md.

const KICKOFF = new Date("2026-06-20T18:00:00Z");
const AFTER = new Date("2026-06-20T20:00:00Z");
const BEFORE = new Date("2026-06-20T17:00:00Z");

function ctx(over: Partial<MatchResultContext> = {}): MatchResultContext {
  return {
    stage: "group",
    status: "live",
    homeTeam: "BRA",
    awayTeam: "ARG",
    kickoffAt: KICKOFF,
    now: AFTER,
    ...over,
  };
}

function input(over: Partial<MatchResultInput> = {}): MatchResultInput {
  return {
    regHome: 1,
    regAway: 0,
    finalHome: 1,
    finalAway: 0,
    wentToPenalties: false,
    penHome: null,
    penAway: null,
    advancingTeam: null,
    ...over,
  };
}

describe("validateMatchResult - status + timing", () => {
  it("accepts a valid group result on a live match", () => {
    expect(validateMatchResult(input(), ctx())).toBeNull();
  });

  it("accepts correcting an already-final match", () => {
    expect(validateMatchResult(input(), ctx({ status: "final" }))).toBeNull();
  });

  it("rejects a postponed or canceled match (own flow first)", () => {
    expect(validateMatchResult(input(), ctx({ status: "postponed" }))).toBe(
      "invalid_status",
    );
    expect(validateMatchResult(input(), ctx({ status: "canceled" }))).toBe(
      "invalid_status",
    );
  });

  it("rejects a match that has not kicked off yet", () => {
    expect(
      validateMatchResult(input(), ctx({ status: "scheduled", now: BEFORE })),
    ).toBe("match_not_started");
  });
});

describe("validateMatchResult - scores", () => {
  it("rejects out-of-range or non-integer scores", () => {
    expect(validateMatchResult(input({ regHome: -1 }), ctx())).toBe(
      "invalid_score",
    );
    expect(validateMatchResult(input({ finalAway: 100 }), ctx())).toBe(
      "invalid_score",
    );
    expect(validateMatchResult(input({ regHome: 1.5, finalHome: 1.5 }), ctx())).toBe(
      "invalid_score",
    );
  });

  it("rejects a final score lower than the 90-minute score", () => {
    expect(
      validateMatchResult(input({ regHome: 2, finalHome: 1 }), ctx()),
    ).toBe("invalid_score");
  });

  it("accepts extra-time goals on top of the 90-minute score", () => {
    expect(
      validateMatchResult(
        input({ regHome: 1, regAway: 1, finalHome: 2, finalAway: 1, advancingTeam: "BRA" }),
        ctx({ stage: "r16" }),
      ),
    ).toBeNull();
  });
});

describe("validateMatchResult - penalties", () => {
  const knock = ctx({ stage: "r16" });

  it("accepts a valid shootout on a level knockout", () => {
    expect(
      validateMatchResult(
        input({
          regHome: 1,
          regAway: 1,
          finalHome: 1,
          finalAway: 1,
          wentToPenalties: true,
          penHome: 4,
          penAway: 2,
          advancingTeam: "BRA",
        }),
        knock,
      ),
    ).toBeNull();
  });

  it("rejects penalties on a group match", () => {
    expect(
      validateMatchResult(
        input({
          regHome: 1,
          regAway: 1,
          finalHome: 1,
          finalAway: 1,
          wentToPenalties: true,
          penHome: 4,
          penAway: 2,
        }),
        ctx({ stage: "group" }),
      ),
    ).toBe("invalid_penalties");
  });

  it("rejects penalties when the match was not level after extra time", () => {
    expect(
      validateMatchResult(
        input({
          finalHome: 2,
          finalAway: 1,
          wentToPenalties: true,
          penHome: 4,
          penAway: 2,
          advancingTeam: "BRA",
        }),
        knock,
      ),
    ).toBe("invalid_penalties");
  });

  it("rejects a drawn shootout (no winner)", () => {
    expect(
      validateMatchResult(
        input({
          regHome: 1,
          regAway: 1,
          finalHome: 1,
          finalAway: 1,
          wentToPenalties: true,
          penHome: 3,
          penAway: 3,
        }),
        knock,
      ),
    ).toBe("invalid_penalties");
  });

  it("rejects a penalty score carried without a shootout flag", () => {
    expect(
      validateMatchResult(input({ penHome: 4, penAway: 2 }), knock),
    ).toBe("invalid_penalties");
  });
});

describe("validateMatchResult - advancing team", () => {
  const knock = ctx({ stage: "r16" });

  it("forces null advancing team on a group match", () => {
    expect(
      validateMatchResult(input({ advancingTeam: "BRA" }), ctx({ stage: "group" })),
    ).toBe("invalid_advancing_team");
  });

  it("allows an undecided (null) knockout", () => {
    expect(
      validateMatchResult(input({ advancingTeam: null }), knock),
    ).toBeNull();
  });

  it("rejects a team not in the match", () => {
    expect(
      validateMatchResult(input({ advancingTeam: "FRA" }), knock),
    ).toBe("invalid_advancing_team");
  });

  it("rejects awarding advancement to the team that lost on the scoreline", () => {
    expect(
      validateMatchResult(
        input({ finalHome: 1, finalAway: 0, advancingTeam: "ARG" }),
        knock,
      ),
    ).toBe("invalid_advancing_team");
  });

  it("rejects a winner on a level score with no shootout", () => {
    expect(
      validateMatchResult(
        input({ regHome: 1, regAway: 1, finalHome: 1, finalAway: 1, advancingTeam: "BRA" }),
        knock,
      ),
    ).toBe("invalid_advancing_team");
  });
});

describe("knockoutWinner", () => {
  const teams = { homeTeam: "BRA", awayTeam: "ARG" };

  it("reads the winner off a decisive final scoreline", () => {
    expect(knockoutWinner(input({ finalHome: 2, finalAway: 1 }), teams)).toBe("BRA");
    expect(knockoutWinner(input({ finalHome: 0, finalAway: 3 }), teams)).toBe("ARG");
  });

  it("reads the winner off a valid shootout when level", () => {
    expect(
      knockoutWinner(
        input({
          finalHome: 1,
          finalAway: 1,
          wentToPenalties: true,
          penHome: 5,
          penAway: 4,
        }),
        teams,
      ),
    ).toBe("BRA");
  });

  it("returns null when level with no shootout", () => {
    expect(
      knockoutWinner(input({ finalHome: 1, finalAway: 1 }), teams),
    ).toBeNull();
  });
});
