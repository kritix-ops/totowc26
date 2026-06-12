import { describe, expect, it } from "vitest";
import {
  applyTemplate,
  defaultTemplateOptions,
  DUEL_QUICK_TEMPLATES,
  findTemplate,
} from "./quick-templates";
import { validateOptions } from "./options";

describe("DUEL_QUICK_TEMPLATES", () => {
  it("has stable, unique template ids", () => {
    const ids = new Set(DUEL_QUICK_TEMPLATES.map((t) => t.id));
    expect(ids.size).toBe(DUEL_QUICK_TEMPLATES.length);
  });

  it("renders both languages without leftover placeholders for every template", () => {
    for (const t of DUEL_QUICK_TEMPLATES) {
      const n = t.defaultThreshold;
      expect(t.questionHe(n)).not.toMatch(/\$\{|<n>|TODO/);
      expect(t.questionEn(n)).not.toMatch(/\$\{|<n>|TODO/);
      expect(t.ruleHe(n)).not.toMatch(/\$\{|<n>|TODO/);
      expect(t.ruleEn(n)).not.toMatch(/\$\{|<n>|TODO/);
    }
  });

  it("seeds a valid options array on every template", () => {
    const r = validateOptions(defaultTemplateOptions());
    expect(r.ok).toBe(true);
  });
});

describe("findTemplate", () => {
  it("returns the row for a known id", () => {
    expect(findTemplate("corners_over")?.id).toBe("corners_over");
  });
  it("returns null for an unknown id", () => {
    expect(findTemplate("nope")).toBeNull();
  });
});

describe("applyTemplate", () => {
  it("substitutes the threshold and emits the auto-grade config", () => {
    const t = findTemplate("corners_over")!;
    const out = applyTemplate(t, 12);
    expect(out.questionHe).toContain("12");
    expect(out.questionEn).toContain("12");
    expect(out.ruleHe).toContain("13"); // > 12 -> at least 13
    expect(out.autoGrade).toEqual({
      stat: "corners",
      comparator: ">",
      threshold: 12,
    });
    expect(out.options.length).toBe(2);
  });

  it("clamps thresholds below the floor", () => {
    const t = findTemplate("corners_over")!;
    const out = applyTemplate(t, -5);
    expect(out.autoGrade.threshold).toBe(t.thresholdMin);
  });

  it("clamps thresholds above the ceiling", () => {
    const t = findTemplate("corners_over")!;
    const out = applyTemplate(t, 999);
    expect(out.autoGrade.threshold).toBe(t.thresholdMax);
  });

  it("renders the singular Hebrew form for red_card_yes at threshold 1", () => {
    const t = findTemplate("red_card_yes")!;
    const out = applyTemplate(t, 1);
    expect(out.questionHe).toContain("לפחות כרטיס אדום אחד");
  });
});
