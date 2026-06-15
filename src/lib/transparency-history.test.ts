import { describe, expect, it } from "vitest";
import {
  computeDuelRecord,
  computeSharedQuestions,
  splitPendingSettled,
  summarizeHistory,
  type UserHistoryRow,
} from "./transparency-history";

// Row factory: each test reads as "this user did X on this bet" instead
// of a wall of fields. Defaults to a settled, won match pick.
function row(overrides: Partial<UserHistoryRow> = {}): UserHistoryRow {
  return {
    category: "match",
    refId: "r1",
    question: "BRA vs GER",
    contextLabel: null,
    sortTs: "2026-06-13T18:00:00Z",
    pickLabel: "2-1",
    resultLabel: "2-1",
    stake: 0,
    net: 15,
    isPending: false,
    opponentId: null,
    opponentName: null,
    ...overrides,
  };
}

describe("summarizeHistory", () => {
  it("reconciles net with totalWon - totalLost across mixed surfaces", () => {
    const s = summarizeHistory([
      row({ category: "match", refId: "m1", net: 15, stake: 0 }),
      row({ category: "live", refId: "c1", net: -5, stake: 5 }),
      row({ category: "tournament", refId: "c2", net: 18, stake: 6 }),
      row({ category: "duel", refId: "d1", net: -20, stake: 20 }),
    ]);
    expect(s.totalBets).toBe(4);
    expect(s.settledCount).toBe(4);
    expect(s.pendingCount).toBe(0);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.totalWon).toBe(33);
    expect(s.totalLost).toBe(25);
    expect(s.net).toBe(8);
    expect(s.net).toBe(s.totalWon - s.totalLost);
    expect(s.totalStaked).toBe(31);
  });

  it("counts pending toward staked + totals but never toward net", () => {
    const s = summarizeHistory([
      row({ net: 10, stake: 0 }),
      row({ refId: "p1", net: null, isPending: true, stake: 8 }),
    ]);
    expect(s.totalBets).toBe(2);
    expect(s.pendingCount).toBe(1);
    expect(s.settledCount).toBe(1);
    expect(s.totalStaked).toBe(8);
    expect(s.net).toBe(10);
  });

  it("treats a settled zero net as a push, not a win or loss", () => {
    const s = summarizeHistory([row({ net: 0, stake: 3 })]);
    expect(s.pushes).toBe(1);
    expect(s.wins).toBe(0);
    expect(s.losses).toBe(0);
    expect(s.net).toBe(0);
  });

  it("aggregates settled net per category", () => {
    const s = summarizeHistory([
      row({ category: "live", net: 4, stake: 5 }),
      row({ category: "live", net: -5, stake: 5, refId: "c2" }),
      row({ category: "duel", net: 20, stake: 20, refId: "d1" }),
    ]);
    expect(s.byCategory.live).toEqual({ net: -1, count: 2 });
    expect(s.byCategory.duel).toEqual({ net: 20, count: 1 });
    expect(s.byCategory.match).toEqual({ net: 0, count: 0 });
  });
});

describe("splitPendingSettled", () => {
  it("separates pending from settled, preserving order", () => {
    const { pending, settled } = splitPendingSettled([
      row({ refId: "a" }),
      row({ refId: "b", isPending: true, net: null }),
      row({ refId: "c" }),
    ]);
    expect(pending.map((r) => r.refId)).toEqual(["b"]);
    expect(settled.map((r) => r.refId)).toEqual(["a", "c"]);
  });
});

describe("computeSharedQuestions", () => {
  it("matches by category+refId, picks the higher net as winner", () => {
    const a = [row({ category: "match", refId: "m1", net: 15, pickLabel: "2-1" })];
    const b = [row({ category: "match", refId: "m1", net: 5, pickLabel: "1-0" })];
    const shared = computeSharedQuestions(a, b);
    expect(shared).toHaveLength(1);
    expect(shared[0].winner).toBe("a");
    expect(shared[0].aPick).toBe("2-1");
    expect(shared[0].bPick).toBe("1-0");
  });

  it("returns no winner when either side is pending", () => {
    const a = [row({ refId: "m1", net: 15 })];
    const b = [row({ refId: "m1", net: null, isPending: true })];
    expect(computeSharedQuestions(a, b)[0].winner).toBeNull();
  });

  it("ignores duels (those are tallied as a record)", () => {
    const a = [row({ category: "duel", refId: "d1" })];
    const b = [row({ category: "duel", refId: "d1" })];
    expect(computeSharedQuestions(a, b)).toHaveLength(0);
  });

  it("marks equal settled nets as a tie", () => {
    const a = [row({ refId: "m1", net: 5 })];
    const b = [row({ refId: "m1", net: 5 })];
    expect(computeSharedQuestions(a, b)[0].winner).toBe("tie");
  });
});

describe("computeDuelRecord", () => {
  it("tallies only settled duels against the given opponent", () => {
    const aRows = [
      row({ category: "duel", refId: "d1", opponentId: "B", net: 20 }),
      row({ category: "duel", refId: "d2", opponentId: "B", net: -20 }),
      row({ category: "duel", refId: "d3", opponentId: "B", net: null, isPending: true }),
      row({ category: "duel", refId: "d4", opponentId: "C", net: 20 }),
    ];
    expect(computeDuelRecord(aRows, "B")).toEqual({ aWins: 1, bWins: 1, total: 2 });
  });
});
