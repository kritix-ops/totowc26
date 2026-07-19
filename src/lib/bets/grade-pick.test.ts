import { describe, expect, it } from "vitest";
import { isPickCorrect, validateResolvedValue } from "./grade-pick";
import type { ResolvedValue } from "./types";

// Guards for the extracted grading primitives. These were moved verbatim out
// of admin/bets/actions.ts so the self-backdate writer can grade a single late
// pick; the tests lock the behaviour in place.

describe("isPickCorrect", () => {
  it("yes_no: matches the boolean side", () => {
    const resolved: ResolvedValue = { type: "yes_no", value: true };
    expect(isPickCorrect("yes_no", { type: "yes_no", value: true }, resolved)).toBe(true);
    expect(isPickCorrect("yes_no", { type: "yes_no", value: false }, resolved)).toBe(false);
  });

  it("number: exact equality only", () => {
    const resolved: ResolvedValue = { type: "number", value: 3 };
    expect(isPickCorrect("number", { type: "number", value: 3 }, resolved)).toBe(true);
    expect(isPickCorrect("number", { type: "number", value: 2 }, resolved)).toBe(false);
  });

  it("multi_choice: matches the chosen value", () => {
    const resolved: ResolvedValue = { type: "multi_choice", value: "mbappe" };
    expect(isPickCorrect("multi_choice", { type: "multi_choice", value: "mbappe" }, resolved)).toBe(true);
    expect(isPickCorrect("multi_choice", { type: "multi_choice", value: "messi" }, resolved)).toBe(false);
  });

  it("free_text: trimmed + case-insensitive", () => {
    const resolved: ResolvedValue = { type: "free_text", value: "Messi" };
    expect(isPickCorrect("free_text", { type: "free_text", value: "messi " }, resolved)).toBe(true);
    expect(isPickCorrect("free_text", { type: "free_text", value: "ronaldo" }, resolved)).toBe(false);
  });

  it("type mismatch or junk pick is never correct", () => {
    const resolved: ResolvedValue = { type: "yes_no", value: true };
    expect(isPickCorrect("yes_no", null, resolved)).toBe(false);
    expect(isPickCorrect("yes_no", { type: "number", value: 1 }, resolved)).toBe(false);
  });
});

describe("validateResolvedValue", () => {
  it("rejects a value whose type differs from the answer type", () => {
    expect(
      validateResolvedValue("yes_no", null, { type: "number", value: 1 } as ResolvedValue),
    ).toBe(false);
  });

  it("number respects min/max bounds from config", () => {
    const cfg = { min: 0, max: 10 };
    expect(validateResolvedValue("number", cfg, { type: "number", value: 5 })).toBe(true);
    expect(validateResolvedValue("number", cfg, { type: "number", value: 11 })).toBe(false);
  });

  it("multi_choice must be one of the configured options", () => {
    const cfg = { options: [{ value: "a" }, { value: "b" }] };
    expect(validateResolvedValue("multi_choice", cfg, { type: "multi_choice", value: "a" })).toBe(true);
    expect(validateResolvedValue("multi_choice", cfg, { type: "multi_choice", value: "z" })).toBe(false);
  });

  // Player markets (top scorer / golden ball) keep options=[] and hydrate the
  // roster client-side. Grading must accept a real roster id even though the
  // inline option list is empty — this is what lets an admin settle "who is
  // top scorer?" by picking Mbappé. Mirrors validateAnswer's submit path.
  it("multi_choice dynamic-source with no price map accepts any non-empty id", () => {
    const cfg = { dynamicSource: "players", options: [] };
    expect(validateResolvedValue("multi_choice", cfg, { type: "multi_choice", value: "1100" })).toBe(true);
    expect(validateResolvedValue("multi_choice", cfg, { type: "multi_choice", value: "" })).toBe(false);
  });

  it("multi_choice dynamic-source with a price map restricts to priced ids", () => {
    const cfg = {
      dynamicSource: "players",
      options: [],
      payoutOverridesByValue: { "1100": 5, "2200": 8 },
    };
    expect(validateResolvedValue("multi_choice", cfg, { type: "multi_choice", value: "1100" })).toBe(true);
    expect(validateResolvedValue("multi_choice", cfg, { type: "multi_choice", value: "9999" })).toBe(false);
  });

  it("free_text must be 1..200 chars", () => {
    expect(validateResolvedValue("free_text", null, { type: "free_text", value: "x" })).toBe(true);
    expect(validateResolvedValue("free_text", null, { type: "free_text", value: "" })).toBe(false);
    expect(
      validateResolvedValue("free_text", null, { type: "free_text", value: "a".repeat(201) }),
    ).toBe(false);
  });
});
