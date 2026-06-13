import { describe, expect, it } from "vitest";
import {
  currentStageLabel,
  pickCurrentStage,
  type MatchForStage,
} from "./current-stage";

// Reference dates from the WC2026 calendar so test scenarios read like
// the real tournament timeline rather than abstract toy data.
const D = (iso: string): Date => new Date(iso);
const GROUP_DAY_1 = D("2026-06-11T20:00:00Z");
const GROUP_DAY_LAST = D("2026-06-26T22:00:00Z");
const R32_START = D("2026-06-28T20:00:00Z");
const R16_START = D("2026-07-04T20:00:00Z");
const QF_START = D("2026-07-09T20:00:00Z");
const SF_START = D("2026-07-14T20:00:00Z");
const THIRD_PLACE = D("2026-07-18T20:00:00Z");
const FINAL = D("2026-07-19T20:00:00Z");

const m = (
  stage: MatchForStage["stage"],
  status: MatchForStage["status"],
  kickoffAt: Date,
): MatchForStage => ({ stage, status, kickoffAt });

describe("pickCurrentStage", () => {
  it("returns null when no matches exist", () => {
    expect(pickCurrentStage([])).toBeNull();
  });

  it("picks the stage of the next scheduled match before kickoff", () => {
    const out = pickCurrentStage([
      m("group", "scheduled", GROUP_DAY_1),
      m("group", "scheduled", GROUP_DAY_LAST),
      m("r32", "scheduled", R32_START),
    ]);
    expect(out).toBe("group");
  });

  it("treats a live group match as the current stage", () => {
    const out = pickCurrentStage([
      m("group", "final", GROUP_DAY_1),
      m("group", "live", GROUP_DAY_LAST),
      m("r32", "scheduled", R32_START),
    ]);
    expect(out).toBe("group");
  });

  it("advances to r32 once every group match is final", () => {
    const out = pickCurrentStage([
      m("group", "final", GROUP_DAY_1),
      m("group", "final", GROUP_DAY_LAST),
      m("r32", "scheduled", R32_START),
      m("r16", "scheduled", R16_START),
    ]);
    expect(out).toBe("r32");
  });

  it("shows third_place before the final once semis wrap", () => {
    const out = pickCurrentStage([
      m("sf", "final", SF_START),
      m("third_place", "scheduled", THIRD_PLACE),
      m("final", "scheduled", FINAL),
    ]);
    expect(out).toBe("third_place");
  });

  it("advances to final once the third-place match finishes", () => {
    const out = pickCurrentStage([
      m("sf", "final", SF_START),
      m("third_place", "final", THIRD_PLACE),
      m("final", "scheduled", FINAL),
    ]);
    expect(out).toBe("final");
  });

  it("falls back to the latest-played stage once everything is final", () => {
    const out = pickCurrentStage([
      m("sf", "final", SF_START),
      m("third_place", "final", THIRD_PLACE),
      m("final", "final", FINAL),
    ]);
    expect(out).toBe("final");
  });

  it("survives an out-of-order input array — selection is by kickoff, not row order", () => {
    const out = pickCurrentStage([
      m("r32", "scheduled", R32_START),
      m("group", "scheduled", GROUP_DAY_LAST),
      m("group", "scheduled", GROUP_DAY_1),
    ]);
    expect(out).toBe("group");
  });

  it("handles an unexpectedly rescheduled match (kickoff moved earlier into another stage)", () => {
    // Simulates the user's worry: an unplanned change ships from
    // API-Football. If, say, a knockout match got rescheduled before a
    // straggling group match, the label tracks the next real kickoff.
    const out = pickCurrentStage([
      m("group", "scheduled", D("2026-06-30T20:00:00Z")),
      m("r32", "scheduled", R32_START),
    ]);
    expect(out).toBe("r32");
  });
});

describe("currentStageLabel", () => {
  it("renders the Hebrew group-stage label for stage=group", () => {
    expect(currentStageLabel("group", "he")).toBe("שלב הבתים");
  });

  it("renders the English group-stage label for stage=group", () => {
    expect(currentStageLabel("group", "en")).toBe("Group stage");
  });

  it("renders each stage with a non-empty Hebrew label", () => {
    const stages = ["group", "r32", "r16", "qf", "sf", "third_place", "final"] as const;
    for (const s of stages) {
      const label = currentStageLabel(s, "he");
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe("המונדיאל"); // fallback should not fire
    }
  });

  it("falls back to a generic label when the stage is null", () => {
    expect(currentStageLabel(null, "he")).toBe("המונדיאל");
    expect(currentStageLabel(null, "en")).toBe("Tournament");
  });
});
