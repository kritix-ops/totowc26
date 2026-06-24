import { describe, expect, it } from "vitest";
import { buildGroupBetTemplate } from "./group-bet-template";

describe("buildGroupBetTemplate", () => {
  const teams = [
    { code: "ARG", nameHe: "ארגנטינה", nameEn: "Argentina" },
    { code: "MEX", nameHe: "מקסיקו", nameEn: "Mexico" },
  ];

  it("writes the question and grading rule for the group letter", () => {
    const t = buildGroupBetTemplate("A", teams);
    expect(t.questionHe).toBe("מי תסיים ראשונה בבית A?");
    expect(t.questionEn).toBe("Who will finish 1st in Group A?");
    expect(t.gradingRuleHe).toContain("בבית A");
    expect(t.gradingRuleEn).toContain("Group A");
  });

  it("upper-cases a lower-case group id so copy is consistent", () => {
    expect(buildGroupBetTemplate("c", teams).questionEn).toBe(
      "Who will finish 1st in Group C?",
    );
  });

  it("maps each team to a choice option keyed by its code", () => {
    const t = buildGroupBetTemplate("A", teams);
    expect(t.options).toEqual([
      { value: "ARG", labelHe: "ארגנטינה", labelEn: "Argentina" },
      { value: "MEX", labelHe: "מקסיקו", labelEn: "Mexico" },
    ]);
  });

  it("yields an option-less template when the group has no teams yet", () => {
    expect(buildGroupBetTemplate("B", []).options).toEqual([]);
  });
});
