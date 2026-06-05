import { describe, expect, it } from "vitest";
import { pickGroupWinner, type GroupStandingRow } from "./grade-group";

// Pure-function tests for the group-winner tiebreaker. The DB-touching
// wrapper (resolveGroupScope in sync.ts) just feeds standings rows into
// this function and trusts the outcome, so every branch the resolver
// relies on is covered here.

function row(
  code: string,
  played: number,
  points: number,
  goalDiff: number,
  goalsFor: number,
): GroupStandingRow {
  return { code, played, points, goalDiff, goalsFor };
}

// A complete group: 4 teams * 3 matches = 12 plays.
function completeGroup(rows: Array<Omit<GroupStandingRow, "played">>) {
  return rows.map((r) => ({ ...r, played: 3 }));
}

describe("pickGroupWinner", () => {
  it("returns the clear winner on points", () => {
    const out = pickGroupWinner(
      completeGroup([
        { code: "ARG", points: 9, goalDiff: 5, goalsFor: 7 },
        { code: "MEX", points: 4, goalDiff: 0, goalsFor: 3 },
        { code: "POL", points: 3, goalDiff: -2, goalsFor: 2 },
        { code: "SAU", points: 1, goalDiff: -3, goalsFor: 1 },
      ]),
    );
    expect(out).toEqual({ kind: "winner", code: "ARG" });
  });

  it("breaks a points tie by goal difference", () => {
    const out = pickGroupWinner(
      completeGroup([
        { code: "ARG", points: 6, goalDiff: 4, goalsFor: 5 },
        { code: "MEX", points: 6, goalDiff: 2, goalsFor: 4 },
        { code: "POL", points: 3, goalDiff: -2, goalsFor: 2 },
        { code: "SAU", points: 0, goalDiff: -4, goalsFor: 1 },
      ]),
    );
    expect(out).toEqual({ kind: "winner", code: "ARG" });
  });

  it("breaks a points + GD tie by goals scored", () => {
    const out = pickGroupWinner(
      completeGroup([
        { code: "ARG", points: 6, goalDiff: 3, goalsFor: 6 },
        { code: "MEX", points: 6, goalDiff: 3, goalsFor: 4 },
        { code: "POL", points: 3, goalDiff: -2, goalsFor: 2 },
        { code: "SAU", points: 0, goalDiff: -4, goalsFor: 1 },
      ]),
    );
    expect(out).toEqual({ kind: "winner", code: "ARG" });
  });

  it("returns ambiguous when the top two are tied across all three tiebreakers", () => {
    const out = pickGroupWinner(
      completeGroup([
        { code: "ARG", points: 6, goalDiff: 3, goalsFor: 5 },
        { code: "MEX", points: 6, goalDiff: 3, goalsFor: 5 },
        { code: "POL", points: 3, goalDiff: -2, goalsFor: 2 },
        { code: "SAU", points: 0, goalDiff: -4, goalsFor: 1 },
      ]),
    );
    expect(out.kind).toBe("ambiguous");
    if (out.kind === "ambiguous") {
      expect(out.tied.map((t) => t.code).sort()).toEqual(["ARG", "MEX"]);
    }
  });

  it("flags three-way top ties as ambiguous", () => {
    const out = pickGroupWinner(
      completeGroup([
        { code: "ARG", points: 6, goalDiff: 2, goalsFor: 4 },
        { code: "MEX", points: 6, goalDiff: 2, goalsFor: 4 },
        { code: "POL", points: 6, goalDiff: 2, goalsFor: 4 },
        { code: "SAU", points: 0, goalDiff: -6, goalsFor: 0 },
      ]),
    );
    expect(out.kind).toBe("ambiguous");
    if (out.kind === "ambiguous") {
      expect(out.tied.map((t) => t.code).sort()).toEqual(["ARG", "MEX", "POL"]);
    }
  });

  it("returns not_ready when not every match has been played", () => {
    const out = pickGroupWinner([
      row("ARG", 3, 9, 5, 7),
      row("MEX", 2, 3, 0, 2),
      row("POL", 2, 1, -2, 1),
      row("SAU", 2, 0, -3, 0),
    ]);
    expect(out).toEqual({ kind: "not_ready", reason: "matches_incomplete" });
  });

  it("returns not_ready when no matches have been played at all", () => {
    const out = pickGroupWinner(
      completeGroup([
        { code: "ARG", points: 0, goalDiff: 0, goalsFor: 0 },
        { code: "MEX", points: 0, goalDiff: 0, goalsFor: 0 },
        { code: "POL", points: 0, goalDiff: 0, goalsFor: 0 },
        { code: "SAU", points: 0, goalDiff: 0, goalsFor: 0 },
      ]).map((r) => ({ ...r, played: 0 })),
    );
    expect(out).toEqual({ kind: "not_ready", reason: "matches_incomplete" });
  });

  it("returns not_ready on an empty input", () => {
    expect(pickGroupWinner([])).toEqual({
      kind: "not_ready",
      reason: "matches_incomplete",
    });
  });

  it("is deterministic when the first tiebreaker resolves but later ones don't", () => {
    // ARG and MEX tied on points but ARG has better GD. The second-tier
    // tiebreaker only fires once, even though POL and SAU are also tied
    // further down. Winner should still be ARG, no ambiguity flag.
    const out = pickGroupWinner(
      completeGroup([
        { code: "ARG", points: 7, goalDiff: 4, goalsFor: 5 },
        { code: "MEX", points: 7, goalDiff: 1, goalsFor: 3 },
        { code: "POL", points: 1, goalDiff: -2, goalsFor: 1 },
        { code: "SAU", points: 1, goalDiff: -3, goalsFor: 0 },
      ]),
    );
    expect(out).toEqual({ kind: "winner", code: "ARG" });
  });
});
