import { describe, expect, it } from "vitest";
import { outrightSurfaceForQuestion } from "./outright-surfaces";

// The five tournament-wide markets must map to their odds surface so a
// freshly created bet auto-publishes the curve. Strings below are the
// real question_he values from the live custom_bets rows.

describe("outrightSurfaceForQuestion", () => {
  it.each([
    ["מי יהיה מלך השערים של המונדיאל?", "top_scorer"],
    ["מי יזכה בכדור הזהב של המונדיאל?", "golden_ball"],
    ["מי תזכה במונדיאל 2026?", "champion"],
    ["מי תהיה סגנית אלוף המונדיאל?", "runner_up"],
    ["מי תזכה במקום השלישי?", "third"],
  ])("maps %s -> %s", (question, surface) => {
    expect(outrightSurfaceForQuestion(question)).toBe(surface);
  });

  it("does not confuse champion with third (both start with מי תזכה)", () => {
    expect(outrightSurfaceForQuestion("מי תזכה במונדיאל 2026?")).toBe("champion");
    expect(outrightSurfaceForQuestion("מי תזכה במקום השלישי?")).toBe("third");
  });

  it("returns null for a non-outright question", () => {
    expect(outrightSurfaceForQuestion("כמה שערים יובקעו בסך הכל?")).toBeNull();
    expect(outrightSurfaceForQuestion("האם הגמר יוכרע בפנדלים?")).toBeNull();
  });

  it("returns null for a group-winner question (priced via its own path)", () => {
    expect(outrightSurfaceForQuestion("מי תנצח בקבוצה C?")).toBeNull();
  });
});
