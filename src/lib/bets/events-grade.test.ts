import { describe, expect, it } from "vitest";
import { gradeEventBet, type EventGradeSpec } from "./events-grade";
import type { ApiFootballEvent } from "@/lib/api-football";

// Fixture modelled on the real WC 2026 opener (Mexico 2-0 South Africa,
// fixture 1489369): a yellow at 17' and 23', a red at 49', a yellow at
// 74', a red at 84', a red at 90+2, goals at 9' and 67'. Home = Mexico
// (16), away = South Africa (1531).
const HOME = 16;
const AWAY = 1531;
const events: ApiFootballEvent[] = [
  { minute: 9, extra: null, teamId: HOME, type: "Goal", detail: "Normal Goal" },
  { minute: 17, extra: null, teamId: AWAY, type: "Card", detail: "Yellow Card" },
  { minute: 23, extra: null, teamId: HOME, type: "Card", detail: "Yellow Card" },
  { minute: 49, extra: null, teamId: AWAY, type: "Card", detail: "Red Card" },
  { minute: 67, extra: null, teamId: HOME, type: "Goal", detail: "Normal Goal" },
  { minute: 74, extra: null, teamId: AWAY, type: "Card", detail: "Yellow Card" },
  { minute: 84, extra: null, teamId: AWAY, type: "Card", detail: "Red Card" },
  { minute: 90, extra: 2, teamId: HOME, type: "Card", detail: "Red Card" },
];

const ctx = { homeTeamId: HOME, awayTeamId: AWAY };

describe("gradeEventBet — red cards", () => {
  it("'red card in the first half?' → no (all 3 reds were 2nd half)", () => {
    // The opener's reds were at 49', 84', 90+2 — none in the first half.
    const spec: EventGradeSpec = { metric: "red_card", window: "1H", op: ">=", value: 1 };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: false });
  });

  it("'red card in the second half?' → yes (49', 84', 90+2)", () => {
    const spec: EventGradeSpec = { metric: "red_card", window: "2H", op: ">=", value: 1 };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
  });

  it("'red card in the FIRST 30 minutes?' → no (first red at 49')", () => {
    const spec: EventGradeSpec = {
      metric: "red_card",
      window: { fromMinute: 1, toMinute: 30 },
      op: ">=",
      value: 1,
    };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: false });
  });

  it("counts all red cards in the match (number bet) → 3", () => {
    const spec: EventGradeSpec = { metric: "red_card", window: "FT", op: ">=", value: 0 };
    expect(gradeEventBet(events, spec, "number", ctx)).toEqual({ type: "number", value: 3 });
  });

  it("buckets a 90+2 red into the second half, not extra/overflow", () => {
    const spec: EventGradeSpec = { metric: "red_card", window: "2H", op: ">=", value: 2 };
    // Reds at 49', 84', 90+2 → second half (46..90) has 84' and 90+2 = 2.
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
  });
});

describe("gradeEventBet — team filter", () => {
  it("'red card for the away side?' → yes (49', 84')", () => {
    const spec: EventGradeSpec = { metric: "red_card", window: "FT", op: ">=", value: 1, team: "away" };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
  });

  it("counts home red cards → 1 (the 90+2 red)", () => {
    const spec: EventGradeSpec = { metric: "red_card", window: "FT", op: ">=", value: 0, team: "home" };
    expect(gradeEventBet(events, spec, "number", ctx)).toEqual({ type: "number", value: 1 });
  });

  it("skips a side filter when the team ids are missing", () => {
    const spec: EventGradeSpec = { metric: "red_card", window: "FT", op: ">=", value: 1, team: "home" };
    expect(gradeEventBet(events, spec, "yes_no")).toBe("skip");
  });
});

describe("gradeEventBet — yellows, goals, penalties", () => {
  it("counts yellow cards, excluding reds → 3", () => {
    const spec: EventGradeSpec = { metric: "yellow_card", window: "FT", op: ">=", value: 0 };
    expect(gradeEventBet(events, spec, "number", ctx)).toEqual({ type: "number", value: 3 });
  });

  it("'goal in the opening 15 minutes?' → yes (9')", () => {
    const spec: EventGradeSpec = {
      metric: "goal",
      window: { fromMinute: 1, toMinute: 15 },
      op: ">=",
      value: 1,
    };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
  });

  it("excludes cancelled goals from the count", () => {
    const withCancelled: ApiFootballEvent[] = [
      ...events,
      { minute: 30, extra: null, teamId: HOME, type: "Goal", detail: "Goal cancelled" },
    ];
    const spec: EventGradeSpec = { metric: "goal", window: "FT", op: ">=", value: 0 };
    expect(gradeEventBet(withCancelled, spec, "number", ctx)).toEqual({ type: "number", value: 2 });
  });

  it("counts converted penalties only", () => {
    const withPen: ApiFootballEvent[] = [
      { minute: 55, extra: null, teamId: HOME, type: "Goal", detail: "Penalty" },
      { minute: 70, extra: null, teamId: AWAY, type: "Goal", detail: "Missed Penalty" },
    ];
    const spec: EventGradeSpec = { metric: "penalty", window: "FT", op: ">=", value: 1 };
    expect(gradeEventBet(withPen, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
    expect(gradeEventBet(withPen, spec, "number", ctx)).toEqual({ type: "number", value: 1 });
  });
});

describe("gradeEventBet — unsupported", () => {
  it("never auto-grades a VAR market", () => {
    const spec: EventGradeSpec = { metric: "var", window: "FT", op: ">=", value: 1 };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toBe("skip");
  });

  it("skips multi_choice and free_text answer types", () => {
    const spec: EventGradeSpec = { metric: "red_card", window: "1H", op: ">=", value: 1 };
    expect(gradeEventBet(events, spec, "multi_choice", ctx)).toBe("skip");
    expect(gradeEventBet(events, spec, "free_text", ctx)).toBe("skip");
  });

  it("skips a malformed window", () => {
    const spec = {
      metric: "red_card",
      window: { fromMinute: 30 },
      op: ">=",
      value: 1,
    } as unknown as EventGradeSpec;
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toBe("skip");
  });

  it("resolves 'no red card' correctly when none fall in the window", () => {
    const spec: EventGradeSpec = {
      metric: "red_card",
      window: { fromMinute: 1, toMinute: 10 },
      op: ">=",
      value: 1,
    };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: false });
  });
});
