import { describe, expect, it } from "vitest";
import { formatRemaining } from "./LocksInCountdown";

describe("formatRemaining", () => {
  it("renders H:MM:SS when at least one hour remains", () => {
    expect(formatRemaining(3600 * 1000)).toBe("1:00:00");
    expect(formatRemaining(3661 * 1000)).toBe("1:01:01");
    expect(formatRemaining(25 * 3600 * 1000)).toBe("25:00:00");
  });

  it("renders MM:SS when under an hour", () => {
    expect(formatRemaining(59 * 60 * 1000)).toBe("59:00");
    expect(formatRemaining(90 * 1000)).toBe("01:30");
    expect(formatRemaining(5 * 1000)).toBe("00:05");
  });

  it("zero-pads single digits", () => {
    expect(formatRemaining(9 * 1000)).toBe("00:09");
    expect(formatRemaining(60 * 1000 + 7 * 1000)).toBe("01:07");
  });

  it("clamps zero and negative input to 00:00", () => {
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(-5000)).toBe("00:00");
  });

  it("floors sub-second remainders to the same whole second", () => {
    // 1.999s should show 1s remaining, not 2s.
    expect(formatRemaining(1999)).toBe("00:01");
  });

  it("transitions cleanly across the hour boundary", () => {
    expect(formatRemaining(3599 * 1000)).toBe("59:59"); // just under
    expect(formatRemaining(3600 * 1000)).toBe("1:00:00"); // exact
  });
});
