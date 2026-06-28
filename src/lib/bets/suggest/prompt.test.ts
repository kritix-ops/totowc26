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
