import { describe, expect, it } from "vitest";
import { buildSystemPrompt, MAX_GUIDANCE_CHARS } from "./prompt";

// The admin guidance is a SAFE, fenced steer: it must be appended (never
// replace the hard rules) and capped so it can't blow the token budget or
// bury the format/schema/grading rules baked into the prompt.

describe("buildSystemPrompt guidance", () => {
  it("does not add a guidance block when none is given", () => {
    const base = buildSystemPrompt("match");
    expect(base).not.toContain("House guidance from the pool admin");
  });

  it("treats empty/whitespace guidance as none", () => {
    expect(buildSystemPrompt("match", "   ")).toBe(buildSystemPrompt("match"));
  });

  it("appends the guidance after the hard rules, fenced as subordinate", () => {
    const prompt = buildSystemPrompt("match", "Focus on corners and cards.");
    expect(prompt).toContain("House guidance from the pool admin");
    expect(prompt).toContain("Focus on corners and cards.");
    // The hard rules still come first — guidance is appended at the end.
    expect(prompt.indexOf("Hard rules:")).toBeLessThan(
      prompt.indexOf("House guidance from the pool admin"),
    );
  });

  it("truncates guidance past the cap", () => {
    const long = "x".repeat(MAX_GUIDANCE_CHARS + 500);
    const prompt = buildSystemPrompt("day", long);
    expect(prompt).toContain("x".repeat(MAX_GUIDANCE_CHARS));
    expect(prompt).not.toContain("x".repeat(MAX_GUIDANCE_CHARS + 1));
  });

  it("works for the day scope too", () => {
    const prompt = buildSystemPrompt("day", "Lead with total goals today.");
    expect(prompt).toContain("Lead with total goals today.");
  });
});

// The data steer is a SECOND fenced block, independent of the admin guidance:
// auto-computed from history, selection-only, never a probability instruction.
describe("buildSystemPrompt data steer", () => {
  const steer = "Offer offside markets sparingly.";

  it("adds no data block when none is given", () => {
    expect(buildSystemPrompt("match")).not.toContain("Data steer from this pool's own history");
    expect(buildSystemPrompt("match", "house", "  ")).not.toContain("Data steer from this pool's own history");
  });

  it("appends the data steer after the hard rules, fenced as selection-only", () => {
    const prompt = buildSystemPrompt("match", undefined, steer);
    expect(prompt).toContain("Data steer from this pool's own history");
    expect(prompt).toContain(steer);
    expect(prompt).toContain("steers SELECTION only");
    expect(prompt.indexOf("Hard rules:")).toBeLessThan(
      prompt.indexOf("Data steer from this pool's own history"),
    );
  });

  it("keeps the data steer and the admin guidance as separate blocks", () => {
    const prompt = buildSystemPrompt("match", "House rule X.", steer);
    expect(prompt).toContain("Data steer from this pool's own history");
    expect(prompt).toContain("House guidance from the pool admin");
    expect(prompt).toContain("House rule X.");
    expect(prompt).toContain(steer);
  });
});
