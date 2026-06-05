import { describe, expect, it } from "vitest";
import { selectDuelCandidates } from "./duel-opportunity";
import type { LeaderboardEntry } from "@/db/queries";

// Pure-logic tests for the candidate selector. The DB lookup that
// follows it lives in the generator and is exercised by the dashboard
// itself; this file pins down the rank-gap rule so the moment never
// surfaces the wrong opener.

function row(
  rank: number,
  userId: string,
  isYou: boolean,
  displayName = `user-${rank}`,
): LeaderboardEntry {
  return {
    rank,
    userId,
    displayName,
    points: 100 - rank,
    grossPoints: 100 - rank,
    betCount: 0,
    wastedStakes: 0,
    isYou,
  };
}

describe("selectDuelCandidates", () => {
  it("returns null when the viewer is not on the board", () => {
    const board = [row(1, "a", false), row(2, "b", false)];
    expect(selectDuelCandidates(board)).toBeNull();
  });

  it("returns null when the viewer is already at rank 1", () => {
    const board = [row(1, "me", true), row(2, "b", false), row(3, "c", false)];
    expect(selectDuelCandidates(board)).toBeNull();
  });

  it("returns the player one rank above", () => {
    const board = [row(1, "a", false), row(2, "me", true), row(3, "c", false)];
    const result = selectDuelCandidates(board);
    expect(result).not.toBeNull();
    expect(result!.myRank).toBe(2);
    expect(result!.candidates.map((c) => c.userId)).toEqual(["a"]);
  });

  it("returns the 1-3-rank window above the viewer", () => {
    const board = [
      row(1, "a", false),
      row(2, "b", false),
      row(3, "c", false),
      row(4, "d", false),
      row(5, "me", true),
      row(6, "f", false),
    ];
    const result = selectDuelCandidates(board);
    expect(result).not.toBeNull();
    expect(result!.candidates.map((c) => c.userId)).toEqual(["b", "c", "d"]);
  });

  it("excludes openers more than 3 ranks above", () => {
    const board = [
      row(1, "leader", false),
      row(5, "me", true),
      row(6, "below", false),
    ];
    const result = selectDuelCandidates(board);
    // Only candidate would be rank 1, but gap is 4 — too far.
    expect(result).toBeNull();
  });

  it("excludes the viewer's own row even if isYou logic ever drifts", () => {
    const board = [
      row(1, "a", false),
      row(2, "me", true),
      // Pathological second row marked isYou=false at the viewer rank.
      // The filter should still skip rows whose rank is not strictly
      // less than the viewer's.
      row(2, "duplicate-rank-non-you", false),
    ];
    const result = selectDuelCandidates(board);
    expect(result).not.toBeNull();
    expect(result!.candidates.map((c) => c.userId)).toEqual(["a"]);
  });

  it("returns null when no row is in the 1-3 window", () => {
    const board = [row(2, "me", true), row(3, "below", false)];
    expect(selectDuelCandidates(board)).toBeNull();
  });
});
