import { describe, expect, it } from "vitest";
import { matchRangeOption, parseRangeToken } from "./range-grade";

// parseRangeToken turns a single option token into an inclusive interval.
// matchRangeOption picks the one option whose interval contains a measured
// number. Together they let "how many goals? 0-1 / 2-3 / 4+" auto-grade.

describe("parseRangeToken", () => {
  it("parses over tokens (N+, Nplus, 'N or more', Hebrew) as [N, ∞)", () => {
    expect(parseRangeToken("4+")).toEqual({ min: 4, max: Infinity });
    expect(parseRangeToken("4plus")).toEqual({ min: 4, max: Infinity });
    expect(parseRangeToken("4 goals or more")).toEqual({ min: 4, max: Infinity });
    expect(parseRangeToken("4 שערים או יותר")).toEqual({ min: 4, max: Infinity });
    expect(parseRangeToken("2.5+")).toEqual({ min: 2.5, max: Infinity });
  });

  it("parses range tokens (N-M, N to M, N עד M)", () => {
    expect(parseRangeToken("0-1")).toEqual({ min: 0, max: 1 });
    expect(parseRangeToken("2-3")).toEqual({ min: 2, max: 3 });
    expect(parseRangeToken("0 to 1 goals")).toEqual({ min: 0, max: 1 });
    expect(parseRangeToken("2 עד 3 שערים")).toEqual({ min: 2, max: 3 });
  });

  it("parses under tokens and bare exact numbers", () => {
    expect(parseRangeToken("under 3")).toEqual({ min: -Infinity, max: 3 });
    expect(parseRangeToken("3 or less")).toEqual({ min: -Infinity, max: 3 });
    expect(parseRangeToken("5")).toEqual({ min: 5, max: 5 });
  });

  it("returns null for non-numeric tokens", () => {
    expect(parseRangeToken("high")).toBeNull();
    expect(parseRangeToken("")).toBeNull();
    expect(parseRangeToken("ברזיל")).toBeNull();
  });
});

describe("matchRangeOption", () => {
  const GOALS = [
    { value: "0-1", labelHe: "0-1", labelEn: "0-1" },
    { value: "2-3", labelHe: "2-3", labelEn: "2-3" },
    { value: "4+", labelHe: "4+", labelEn: "4+" },
  ];

  it("maps a 5-goal game to the 4+ option (the live-bet regression)", () => {
    expect(matchRangeOption(GOALS, 5)).toBe("4+");
  });

  it("maps numbers into the correct inclusive range", () => {
    expect(matchRangeOption(GOALS, 0)).toBe("0-1");
    expect(matchRangeOption(GOALS, 1)).toBe("0-1");
    expect(matchRangeOption(GOALS, 2)).toBe("2-3");
    expect(matchRangeOption(GOALS, 3)).toBe("2-3");
    expect(matchRangeOption(GOALS, 4)).toBe("4+");
  });

  it("works when option values are keys but labels carry the ranges", () => {
    const keyed = [
      { value: "low", labelHe: "0 עד 1 שערים", labelEn: "0 to 1 goals" },
      { value: "mid", labelHe: "2 עד 3 שערים", labelEn: "2 to 3 goals" },
      { value: "high", labelHe: "4 שערים או יותר", labelEn: "4 goals or more" },
    ];
    expect(matchRangeOption(keyed, 5)).toBe("high");
    expect(matchRangeOption(keyed, 1)).toBe("low");
  });

  it("returns null when nothing matches so the bet stays manual", () => {
    // A partition with a hole: 4 falls in no range.
    const holed = [
      { value: "0-1", labelHe: "", labelEn: "" },
      { value: "2-3", labelHe: "", labelEn: "" },
    ];
    expect(matchRangeOption(holed, 4)).toBeNull();
  });

  it("returns null on an ambiguous overlap (two options match)", () => {
    const overlap = [
      { value: "0-3", labelHe: "", labelEn: "" },
      { value: "2-5", labelHe: "", labelEn: "" },
    ];
    expect(matchRangeOption(overlap, 3)).toBeNull();
  });
});
