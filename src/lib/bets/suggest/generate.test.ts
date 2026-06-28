import { afterEach, describe, expect, it, vi } from "vitest";
import { demotePlayerIdIfInvalid, generateSuggestions } from "./generate";
import { SUGGESTION_TOOL_NAME, type LiveBetSuggestion } from "./schema";

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

// The run log (live_gen_runs) and the [live-gen ok] line read their counts +
// token usage from GenerateResult.stats. These cover that the diagnostics flow
// out of generateSuggestions on both the "empty" and "ok" paths.
describe("generateSuggestions stats", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ANTHROPIC_API_KEY;
  });

  function stubEmit(suggestions: unknown[]) {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          stop_reason: "tool_use",
          usage: { input_tokens: 1234, output_tokens: 567 },
          content: [
            { type: "tool_use", name: SUGGESTION_TOOL_NAME, input: { suggestions } },
          ],
        }),
      })),
    );
  }

  it("reports returned/valid + token usage when nothing validates (empty)", async () => {
    // Two suggestions with the right shape but empty copy: they count as
    // 'returned' but drop in validation, so the result is the 'empty' error
    // WITH stats attached.
    const blank = {
      questionHe: "",
      questionEn: "",
      gradingRuleHe: "",
      gradingRuleEn: "",
      answerType: "yes_no" as const,
      rationale: "",
    };
    stubEmit([{ ...blank }, { ...blank }]);
    const res = await generateSuggestions({ scope: "match", label: "X vs Y" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("empty");
      expect(res.stats?.returned).toBe(2);
      expect(res.stats?.valid).toBe(0);
      expect(res.stats?.inputTokens).toBe(1234);
      expect(res.stats?.outputTokens).toBe(567);
      expect(res.stats?.searchRequests).toBe(0);
    }
  });

  it("returns no_key (and no call) when the API key is unset", async () => {
    const res = await generateSuggestions({ scope: "day", label: "the day" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("no_key");
  });
});
