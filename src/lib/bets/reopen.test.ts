import { describe, expect, it } from "vitest";
import { canReopen, reopenBlockedReason } from "./reopen";

// The reopen rule: only a reversed bet, and only while lock_at is still in the
// future, can be put back to 'open'. These guard the exact case that bit us on
// 2026-06-19 (a bet reversed by mistake, match not yet started) plus every
// status that must NOT be blindly reopened.

const NOW = new Date("2026-06-19T00:00:00Z");
const FUTURE = new Date("2026-06-19T00:55:00Z"); // lock still ahead
const PAST = new Date("2026-06-18T23:00:00Z"); // lock already gone

describe("reopenBlockedReason", () => {
  it("allows a reversed bet with time left (the golden path)", () => {
    expect(reopenBlockedReason("reversed", FUTURE, NOW)).toBeNull();
    expect(canReopen("reversed", FUTURE, NOW)).toBe(true);
  });

  it("blocks a reversed bet whose lock has already passed", () => {
    expect(reopenBlockedReason("reversed", PAST, NOW)).toBe("no_time_left");
    expect(canReopen("reversed", PAST, NOW)).toBe(false);
  });

  it("treats lock_at exactly equal to now as no time left (boundary)", () => {
    expect(reopenBlockedReason("reversed", NOW, NOW)).toBe("no_time_left");
  });

  it("blocks every non-reversed status regardless of time left", () => {
    for (const status of [
      "draft",
      "open",
      "locked",
      "graded",
      "cancelled",
    ] as const) {
      expect(reopenBlockedReason(status, FUTURE, NOW)).toBe("not_reopenable");
      expect(canReopen(status, FUTURE, NOW)).toBe(false);
    }
  });

  it("checks status before time — a graded bet is not_reopenable even past lock", () => {
    expect(reopenBlockedReason("graded", PAST, NOW)).toBe("not_reopenable");
  });
});
