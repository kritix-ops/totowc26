import { describe, expect, it } from "vitest";
import { adaptTemplateText } from "./template-adapt";

// Two adaptation passes, both verified here:
//   1. {HOME}/{AWAY} placeholder substitution (and bilingual aliases)
//   2. Literal source-team-name → target-team-name swap
//
// Either pass can run on its own (template with placeholders + no source
// match info, or template with literal team names + matching source info)
// and they compose when both apply.

const MEXICO_VS_SA = {
  questionHe: "האם {HOME} תנצח את {AWAY}?",
  questionEn: "Will {HOME} beat {AWAY}?",
  gradingRuleHe: "{HOME} מנצחת בסיום 90 דקות.",
  gradingRuleEn: "{HOME} wins after 90 minutes.",
  sourceHomeNameHe: "מקסיקו",
  sourceHomeNameEn: "Mexico",
  sourceAwayNameHe: "דרום אפריקה",
  sourceAwayNameEn: "South Africa",
};

const ARGENTINA_VS_SAUDI = {
  homeNameHe: "ארגנטינה",
  homeNameEn: "Argentina",
  awayNameHe: "ערב הסעודית",
  awayNameEn: "Saudi Arabia",
};

describe("adaptTemplateText — placeholder substitution", () => {
  it("replaces {HOME} and {AWAY} with the target locale-matching names", () => {
    const out = adaptTemplateText(MEXICO_VS_SA, ARGENTINA_VS_SAUDI);
    expect(out.questionHe).toBe("האם ארגנטינה תנצח את ערב הסעודית?");
    expect(out.questionEn).toBe("Will Argentina beat Saudi Arabia?");
    expect(out.gradingRuleHe).toBe("ארגנטינה מנצחת בסיום 90 דקות.");
    expect(out.gradingRuleEn).toBe("Argentina wins after 90 minutes.");
  });

  it("recognises {home} and {away} lowercase aliases", () => {
    const out = adaptTemplateText(
      {
        ...MEXICO_VS_SA,
        questionHe: "כמה שערים יבקיע {home}?",
        questionEn: "How many goals will {home} score?",
      },
      ARGENTINA_VS_SAUDI,
    );
    expect(out.questionHe).toBe("כמה שערים יבקיע ארגנטינה?");
    expect(out.questionEn).toBe("How many goals will Argentina score?");
  });

  it("recognises bilingual Hebrew placeholders {בית}/{חוץ}", () => {
    const out = adaptTemplateText(
      {
        ...MEXICO_VS_SA,
        questionHe: "האם {בית} תנצח את {חוץ}?",
        questionEn: "Will {HOME} beat {AWAY}?",
      },
      ARGENTINA_VS_SAUDI,
    );
    expect(out.questionHe).toBe("האם ארגנטינה תנצח את ערב הסעודית?");
  });

  it("replaces every occurrence even when the token appears twice", () => {
    const out = adaptTemplateText(
      {
        ...MEXICO_VS_SA,
        questionHe: "{HOME} תבקיע ראשון. ל-{HOME} יש יתרון.",
        questionEn: "{HOME} scores first. {HOME} have the edge.",
      },
      ARGENTINA_VS_SAUDI,
    );
    expect(out.questionHe).toBe("ארגנטינה תבקיע ראשון. ל-ארגנטינה יש יתרון.");
    expect(out.questionEn).toBe("Argentina scores first. Argentina have the edge.");
  });
});

describe("adaptTemplateText — literal name swap", () => {
  it("swaps source team names with target names when no placeholders are present", () => {
    const out = adaptTemplateText(
      {
        ...MEXICO_VS_SA,
        questionHe: "האם מקסיקו תנצח את דרום אפריקה?",
        questionEn: "Will Mexico beat South Africa?",
        gradingRuleHe: "מקסיקו מנצחת בסיום 90 דקות.",
        gradingRuleEn: "Mexico wins after 90 minutes.",
      },
      ARGENTINA_VS_SAUDI,
    );
    expect(out.questionHe).toBe("האם ארגנטינה תנצח את ערב הסעודית?");
    expect(out.questionEn).toBe("Will Argentina beat Saudi Arabia?");
    expect(out.gradingRuleHe).toBe("ארגנטינה מנצחת בסיום 90 דקות.");
    expect(out.gradingRuleEn).toBe("Argentina wins after 90 minutes.");
  });

  it("leaves text alone when source team names are not known", () => {
    const out = adaptTemplateText(
      {
        questionHe: "האם מקסיקו תנצח?",
        questionEn: "Will Mexico win?",
        gradingRuleHe: "מקסיקו מנצחת בסיום 90 דקות.",
        gradingRuleEn: "Mexico wins after 90 minutes.",
        sourceHomeNameHe: null,
        sourceHomeNameEn: null,
        sourceAwayNameHe: null,
        sourceAwayNameEn: null,
      },
      ARGENTINA_VS_SAUDI,
    );
    expect(out.questionHe).toBe("האם מקסיקו תנצח?");
    expect(out.questionEn).toBe("Will Mexico win?");
  });

  it("composes both passes — placeholders first, then literal swap", () => {
    const out = adaptTemplateText(
      {
        ...MEXICO_VS_SA,
        // Mixed template: a placeholder for home + a literal away name.
        questionHe: "האם {HOME} תנצח את דרום אפריקה?",
        questionEn: "Will {HOME} beat South Africa?",
      },
      ARGENTINA_VS_SAUDI,
    );
    expect(out.questionHe).toBe("האם ארגנטינה תנצח את ערב הסעודית?");
    expect(out.questionEn).toBe("Will Argentina beat Saudi Arabia?");
  });

  it("prefers the longer source name first so overlapping substrings don't break", () => {
    // Hypothetical case: source home = "USA United" (contains "USA").
    // Target home = "Mexico". If swap goes shortest-first, "USA" → "Mexico"
    // would land on the embedded substring and the longer name would
    // already be mangled. We exercise the safe ordering.
    const out = adaptTemplateText(
      {
        questionHe: "USA United תנצח?",
        questionEn: "USA United to win?",
        gradingRuleHe: "USA United מנצחת.",
        gradingRuleEn: "USA United wins.",
        sourceHomeNameHe: "USA United",
        sourceHomeNameEn: "USA United",
        sourceAwayNameHe: "USA",
        sourceAwayNameEn: "USA",
      },
      {
        homeNameHe: "Mexico",
        homeNameEn: "Mexico",
        awayNameHe: "Argentina",
        awayNameEn: "Argentina",
      },
    );
    expect(out.questionEn).toBe("Mexico to win?");
  });

  it("does nothing when source and target names match", () => {
    // Quick-add from the source match to itself (edge case — same anchor)
    // should be a no-op.
    const out = adaptTemplateText(
      {
        questionHe: "האם מקסיקו תנצח?",
        questionEn: "Will Mexico win?",
        gradingRuleHe: "מקסיקו מנצחת.",
        gradingRuleEn: "Mexico wins.",
        sourceHomeNameHe: "מקסיקו",
        sourceHomeNameEn: "Mexico",
        sourceAwayNameHe: "דרום אפריקה",
        sourceAwayNameEn: "South Africa",
      },
      {
        homeNameHe: "מקסיקו",
        homeNameEn: "Mexico",
        awayNameHe: "דרום אפריקה",
        awayNameEn: "South Africa",
      },
    );
    expect(out.questionEn).toBe("Will Mexico win?");
    expect(out.questionHe).toBe("האם מקסיקו תנצח?");
  });
});
