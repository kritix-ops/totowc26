import { describe, expect, it } from "vitest";
import { demotePlayerIdIfInvalid } from "./generate";
import type { LiveBetSuggestion } from "./schema";

// Fail-closed guard: a player-prop whose api id isn't on either squad must
// have its auto grading stripped so the grader never trusts a hallucinated
// id. See _plans/2026-06-13-live-bet-suggestions-enrichment.md Phase 3.

function playerProp(playerApiId: number): LiveBetSuggestion {
  return {
    questionHe: "מסי יבקיע?",
    questionEn: "Messi to score?",
    answerType: "yes_no",
    yesProbability: 0.4,
    gradingRuleHe: "כן אם יבקיע",
    gradingRuleEn: "Yes if he scores",
    grading: {
      source: "auto_api_football",
      events: { metric: "goal", window: "FT", op: ">=", value: 1, playerApiId },
    },
    rationale: "calibrated",
  };
}

describe("demotePlayerIdIfInvalid", () => {
  it("keeps grading when the player id is on a squad", () => {
    const s = playerProp(35532);
    const changed = demotePlayerIdIfInvalid(s, new Set([35532, 266345]));
    expect(changed).toBe(false);
    expect(s.grading).not.toBeNull();
  });

  it("nulls grading when the player id is NOT on either squad", () => {
    const s = playerProp(999999);
    const changed = demotePlayerIdIfInvalid(s, new Set([35532, 266345]));
    expect(changed).toBe(true);
    expect(s.grading).toBeNull();
  });

  it("leaves a non-player events spec untouched", () => {
    const s: LiveBetSuggestion = {
      questionHe: "כרטיס אדום במחצית הראשונה?",
      questionEn: "Red card in the first half?",
      answerType: "yes_no",
      yesProbability: 0.2,
      gradingRuleHe: "כן אם יהיה אדום",
      gradingRuleEn: "Yes if a red is shown",
      grading: {
        source: "auto_api_football",
        events: { metric: "red_card", window: "1H", op: ">=", value: 1 },
      },
      rationale: "calibrated",
    };
    const changed = demotePlayerIdIfInvalid(s, new Set([1, 2, 3]));
    expect(changed).toBe(false);
    expect(s.grading).not.toBeNull();
  });

  it("fails closed when no valid set is known (unverifiable id -> manual)", () => {
    // No dossier means the model was never given ids; any id it emitted is
    // unverifiable, so the money-safe move is to demote it to manual.
    const s = playerProp(42);
    const changed = demotePlayerIdIfInvalid(s, undefined);
    expect(changed).toBe(true);
    expect(s.grading).toBeNull();
  });

  it("ignores a manual (null) grading", () => {
    const s = playerProp(42);
    s.grading = null;
    const changed = demotePlayerIdIfInvalid(s, new Set([1]));
    expect(changed).toBe(false);
    expect(s.grading).toBeNull();
  });
});
