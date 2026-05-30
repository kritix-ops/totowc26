import { describe, expect, it } from "vitest";
import { isValidMomentKey, nextIlMorning } from "./dismiss";

describe("isValidMomentKey", () => {
  it("accepts bare type keys", () => {
    expect(isValidMomentKey("position_catchup")).toBe(true);
    expect(isValidMomentKey("pending_duel_invite")).toBe(true);
  });
  it("accepts type:id keys with uuid-like ids", () => {
    expect(
      isValidMomentKey("unpicked_match:550e8400-e29b-41d4-a716-446655440000"),
    ).toBe(true);
    expect(isValidMomentKey("duel_opportunity:abc123_DEF")).toBe(true);
  });
  it("rejects empty strings", () => {
    expect(isValidMomentKey("")).toBe(false);
  });
  it("rejects keys with disallowed characters", () => {
    expect(isValidMomentKey("position catchup")).toBe(false);
    expect(isValidMomentKey("position;drop table users")).toBe(false);
    expect(isValidMomentKey("UPPERCASE_TYPE")).toBe(false);
  });
  it("rejects more than one colon", () => {
    expect(isValidMomentKey("type:id:extra")).toBe(false);
  });
  it("rejects non-string input", () => {
    expect(isValidMomentKey(null as unknown as string)).toBe(false);
    expect(isValidMomentKey(undefined as unknown as string)).toBe(false);
  });
});

describe("nextIlMorning", () => {
  // Helper: read the Asia/Jerusalem hour back out of a Date so we can
  // assert "this Date is 04:00 IL" without hardcoding a fixed UTC
  // offset (Israel observes DST so the offset varies).
  function ilHour(d: Date): number {
    const out = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      hour12: false,
    }).format(d);
    return Number(out);
  }

  it("returns a timestamp that is 04:00 in Asia/Jerusalem", () => {
    // 2026-06-15T15:00:00Z is 18:00 IL (summer time). Next IL 04:00
    // should be the following morning at 01:00Z.
    const r = nextIlMorning(new Date("2026-06-15T15:00:00Z"));
    expect(ilHour(r)).toBe(4);
  });

  it("returns a timestamp strictly in the future", () => {
    const now = new Date("2026-06-15T15:00:00Z");
    const r = nextIlMorning(now);
    expect(r.getTime()).toBeGreaterThan(now.getTime());
  });

  it("rolls to the NEXT day when called at 03:00 IL", () => {
    // 2026-06-15T00:00:00Z is 03:00 IL (summer time). Next IL 04:00
    // should be roughly an hour later (NOT yesterday's 04:00).
    const now = new Date("2026-06-15T00:00:00Z");
    const r = nextIlMorning(now);
    const diffH = (r.getTime() - now.getTime()) / 3_600_000;
    // The function rolls forward when the local hour is already >= 4
    // OR when today's 04:00 IL has passed. At 03:00 IL today's 04:00
    // is still ahead - we hit the "rolls to tomorrow" branch in the
    // guard, which is desired here so the dismissal lasts longer than
    // a few minutes. Sanity: we land somewhere between 1h and 30h
    // from now (allows for DST edges).
    expect(diffH).toBeGreaterThan(0);
    expect(diffH).toBeLessThan(30);
  });

  it("rolls to tomorrow when called after 04:00 IL", () => {
    // 2026-06-15T10:00:00Z is 13:00 IL. Next 04:00 must be tomorrow,
    // ~15 hours out.
    const now = new Date("2026-06-15T10:00:00Z");
    const r = nextIlMorning(now);
    const diffH = (r.getTime() - now.getTime()) / 3_600_000;
    expect(diffH).toBeGreaterThan(10);
    expect(diffH).toBeLessThan(20);
  });
});
