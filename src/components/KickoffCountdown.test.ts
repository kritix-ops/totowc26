import { describe, expect, it } from "vitest";
import { formatKickoffRemaining } from "./KickoffCountdown";

describe("formatKickoffRemaining", () => {
  it("renders MM:SS when under an hour", () => {
    expect(formatKickoffRemaining(59 * 60 * 1000)).toBe("59:00");
    expect(formatKickoffRemaining(90 * 1000)).toBe("01:30");
    expect(formatKickoffRemaining(5 * 1000)).toBe("00:05");
  });

  it("renders H:MM:SS when one to twenty-three hours remain", () => {
    expect(formatKickoffRemaining(3600 * 1000)).toBe("1:00:00");
    expect(formatKickoffRemaining(3661 * 1000)).toBe("1:01:01");
    expect(formatKickoffRemaining(23 * 3600 * 1000)).toBe("23:00:00");
  });

  it("switches to a day-aware label past 24 hours so the badge stays compact", () => {
    expect(formatKickoffRemaining(24 * 3600 * 1000)).toBe("1d 00:00");
    expect(formatKickoffRemaining((24 + 3) * 3600 * 1000 + 15 * 60 * 1000)).toBe(
      "1d 03:15",
    );
    expect(formatKickoffRemaining(2 * 24 * 3600 * 1000)).toBe("2d 00:00");
  });

  it("zero-pads single digits in MM and SS slots", () => {
    expect(formatKickoffRemaining(9 * 1000)).toBe("00:09");
    expect(formatKickoffRemaining(67 * 1000)).toBe("01:07");
  });

  it("clamps zero and negative input to 00:00", () => {
    expect(formatKickoffRemaining(0)).toBe("00:00");
    expect(formatKickoffRemaining(-5000)).toBe("00:00");
  });

  it("floors sub-second remainders to the same whole second", () => {
    expect(formatKickoffRemaining(1999)).toBe("00:01");
  });

  it("transitions cleanly across boundaries", () => {
    expect(formatKickoffRemaining(3599 * 1000)).toBe("59:59");
    expect(formatKickoffRemaining(3600 * 1000)).toBe("1:00:00");
    expect(formatKickoffRemaining(24 * 3600 * 1000 - 1000)).toBe("23:59:59");
    expect(formatKickoffRemaining(24 * 3600 * 1000)).toBe("1d 00:00");
  });
});
