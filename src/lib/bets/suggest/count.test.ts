import { describe, expect, it } from "vitest";
import {
  clampSuggestionCount,
  DEFAULT_SUGGESTION_COUNT,
  MAX_SUGGESTION_COUNT,
  MIN_SUGGESTION_COUNT,
} from "./count";

describe("clampSuggestionCount", () => {
  it("returns the default for an empty string", () => {
    expect(clampSuggestionCount("")).toBe(DEFAULT_SUGGESTION_COUNT);
  });

  it("returns the default for non-numeric input", () => {
    expect(clampSuggestionCount("abc")).toBe(DEFAULT_SUGGESTION_COUNT);
  });

  it("keeps an in-range value as-is", () => {
    expect(clampSuggestionCount("3")).toBe(3);
    expect(clampSuggestionCount("7")).toBe(7);
  });

  it("clamps above the max down to the max (the old snap-to-10 bug input)", () => {
    expect(clampSuggestionCount("63")).toBe(MAX_SUGGESTION_COUNT);
    expect(clampSuggestionCount("11")).toBe(MAX_SUGGESTION_COUNT);
  });

  it("clamps below the min up to the min", () => {
    expect(clampSuggestionCount("0")).toBe(MIN_SUGGESTION_COUNT);
    expect(clampSuggestionCount("1")).toBe(MIN_SUGGESTION_COUNT);
  });

  it("parses leading digits with trailing junk", () => {
    expect(clampSuggestionCount("8x")).toBe(8);
  });
});
