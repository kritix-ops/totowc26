import { describe, expect, it } from "vitest";
import { stageLabel, isKnockoutStage } from "./stage-label";

// The canonical stage-label map drives the quick-picks card chip and the
// "who advances?" picker gating. These pin the Hebrew/English strings and the
// group-letter fold so a stray edit can't quietly relabel a round.

describe("stageLabel", () => {
  it("folds the group letter into group-stage matches", () => {
    expect(stageLabel("group", "A", "he")).toBe("בית A");
    expect(stageLabel("group", "A", "en")).toBe("Group A");
  });

  it("falls back to a generic group-stage label without a letter", () => {
    expect(stageLabel("group", null, "he")).toBe("שלב הבתים");
    expect(stageLabel("group", null, "en")).toBe("Group stage");
  });

  it("labels each knockout round", () => {
    expect(stageLabel("r32", null, "he")).toBe("שלב 32 האחרונות");
    expect(stageLabel("r16", null, "he")).toBe("שמינית גמר");
    expect(stageLabel("qf", null, "he")).toBe("רבע גמר");
    expect(stageLabel("sf", null, "he")).toBe("חצי גמר");
    expect(stageLabel("third_place", null, "en")).toBe("Third-place play-off");
    expect(stageLabel("final", null, "en")).toBe("Final");
  });

  it("returns the raw value for an unknown stage rather than throwing", () => {
    expect(stageLabel("mystery", null, "he")).toBe("mystery");
  });
});

describe("isKnockoutStage", () => {
  it("is false only for the group stage", () => {
    expect(isKnockoutStage("group")).toBe(false);
    for (const s of ["r32", "r16", "qf", "sf", "third_place", "final"]) {
      expect(isKnockoutStage(s)).toBe(true);
    }
  });
});
