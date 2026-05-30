import { describe, expect, it } from "vitest";
import { Sparkles } from "lucide-react";
import { rankAndPick, urgencyBoost, catchUpBoost } from "./score";
import type { Moment, MomentType } from "./types";

// Build a Moment with sane defaults so each test can override just the
// field under examination. Generators in production fill all fields;
// here we only care about score+type for the ranker math.
function m(score: number, type: MomentType, key: string): Moment {
  return {
    key,
    type,
    urgency: "time",
    score,
    icon: Sparkles,
    title: key,
    body: "",
    ctaLabel: "Open",
    ctaHref: "/he",
  };
}

describe("urgencyBoost", () => {
  it("returns 0 when no lock time is supplied", () => {
    expect(urgencyBoost(null)).toBe(0);
  });
  it("returns 20 inside the 1-hour window", () => {
    expect(urgencyBoost(15)).toBe(20);
    expect(urgencyBoost(60)).toBe(20);
  });
  it("returns 10 inside the 1-4h window", () => {
    expect(urgencyBoost(61)).toBe(10);
    expect(urgencyBoost(240)).toBe(10);
  });
  it("returns 0 past the 4h window", () => {
    expect(urgencyBoost(241)).toBe(0);
    expect(urgencyBoost(60 * 24)).toBe(0);
  });
});

describe("catchUpBoost", () => {
  it("boosts only when both flags are true", () => {
    expect(catchUpBoost(true, true)).toBe(10);
    expect(catchUpBoost(true, false)).toBe(0);
    expect(catchUpBoost(false, true)).toBe(0);
    expect(catchUpBoost(false, false)).toBe(0);
  });
});

describe("rankAndPick", () => {
  it("returns empty when candidates are empty", () => {
    expect(rankAndPick([], 4)).toEqual([]);
  });

  it("returns empty when limit is 0", () => {
    expect(rankAndPick([m(100, "unpicked_match_imminent", "a")], 0)).toEqual([]);
  });

  it("picks the highest-scored moments first", () => {
    const list = [
      m(50, "live_bets_open_today", "a"),
      m(80, "pending_duel_invite", "b"),
      m(90, "unpicked_match_imminent", "c"),
    ];
    const r = rankAndPick(list, 2);
    expect(r.map((x) => x.key)).toEqual(["c", "b"]);
  });

  it("applies diversity penalty to repeat types", () => {
    // Two unpicked-match moments at 90 each, one duel at 80. The first
    // unpicked-match is picked at 90 (zero same-type seen). The next
    // unpicked-match would re-score to 90 - 15 = 75; the duel at 80
    // beats it. So picks should be [match, duel, then match].
    const list = [
      m(90, "unpicked_match_imminent", "u1"),
      m(90, "unpicked_match_imminent", "u2"),
      m(80, "pending_duel_invite", "d1"),
    ];
    const r = rankAndPick(list, 3);
    expect(r.map((x) => x.type)).toEqual([
      "unpicked_match_imminent",
      "pending_duel_invite",
      "unpicked_match_imminent",
    ]);
  });

  it("returns at most `limit` items", () => {
    const list = Array.from({ length: 6 }, (_, i) =>
      m(80 - i, "pending_duel_invite", `d${i}`),
    );
    expect(rankAndPick(list, 3)).toHaveLength(3);
  });

  it("is deterministic across runs (stable tiebreak by insertion order)", () => {
    // Two moments with the exact same score+type. The earlier-inserted
    // one wins the tie. Across many calls the order should never flip.
    const list = [
      m(70, "live_bets_open_today", "first"),
      m(70, "live_bets_open_today", "second"),
    ];
    const a = rankAndPick(list, 1);
    const b = rankAndPick(list, 1);
    expect(a[0].key).toBe("first");
    expect(b[0].key).toBe("first");
  });
});
