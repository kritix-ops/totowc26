import { describe, expect, it } from "vitest";
import { fillTemplate, isUnanimous, votePercent } from "./pool-digest-format";

describe("fillTemplate", () => {
  it("replaces every named placeholder", () => {
    const out = fillTemplate("{pickers} bet on {questions} today", {
      pickers: 12,
      questions: 7,
    });
    expect(out).toBe("12 bet on 7 today");
  });

  it("repeats replacement when a placeholder appears multiple times", () => {
    const out = fillTemplate("{count}/{total} of {total}", {
      count: 3,
      total: 8,
    });
    expect(out).toBe("3/8 of 8");
  });

  it("leaves unrelated braces alone", () => {
    const out = fillTemplate("{count}/{total}", { count: 1, total: 2 });
    expect(out).toBe("1/2");
  });
});

describe("votePercent", () => {
  it("returns 0 when nobody voted", () => {
    expect(votePercent({ count: 0, total: 0 })).toBe(0);
  });

  it("rounds half up", () => {
    expect(votePercent({ count: 1, total: 3 })).toBe(33);
    expect(votePercent({ count: 2, total: 3 })).toBe(67);
  });

  it("returns 100 when the whole pool agreed", () => {
    expect(votePercent({ count: 12, total: 12 })).toBe(100);
  });
});

describe("isUnanimous", () => {
  it("is true when every picker agreed and no alt exists", () => {
    expect(isUnanimous(8, 8, null)).toBe(true);
  });

  it("is true when an alt exists but nobody picked it", () => {
    expect(isUnanimous(5, 5, 0)).toBe(true);
  });

  it("is false when the top pick is short of the total", () => {
    expect(isUnanimous(7, 8, 1)).toBe(false);
  });

  it("is false when nobody voted", () => {
    expect(isUnanimous(0, 0, null)).toBe(false);
  });
});
