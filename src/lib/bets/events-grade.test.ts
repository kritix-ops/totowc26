import { describe, expect, it } from "vitest";
import { gradeEventBet, type EventGradeSpec } from "./events-grade";
import type { ApiFootballEvent } from "@/lib/api-football";

// Fixture modelled on the real WC 2026 opener (Mexico 2-0 South Africa,
// fixture 1489369): a yellow at 17' and 23', a red at 49', a yellow at
// 74', a red at 84', a red at 90+2, goals at 9' and 67'. Home = Mexico
// (16), away = South Africa (1531). Player ids mirror the live feed shape:
// the 9' goal was scored by 35532 (assist 266345); 35532 then assisted the
// 67' goal scored by 1001. Mokoena (3287) was booked at 17'.
const HOME = 16;
const AWAY = 1531;
const QUINONES = 35532;
const LIRA = 266345;
const MOKOENA = 3287;
const SECOND_SCORER = 1001;
const events: ApiFootballEvent[] = [
  { minute: 9, extra: null, teamId: HOME, type: "Goal", detail: "Normal Goal", playerId: QUINONES, assistId: LIRA },
  { minute: 17, extra: null, teamId: AWAY, type: "Card", detail: "Yellow Card", playerId: MOKOENA, assistId: null },
  { minute: 23, extra: null, teamId: HOME, type: "Card", detail: "Yellow Card", playerId: 2001, assistId: null },
  { minute: 49, extra: null, teamId: AWAY, type: "Card", detail: "Red Card", playerId: 3001, assistId: null },
  { minute: 67, extra: null, teamId: HOME, type: "Goal", detail: "Normal Goal", playerId: SECOND_SCORER, assistId: QUINONES },
  { minute: 74, extra: null, teamId: AWAY, type: "Card", detail: "Yellow Card", playerId: 3002, assistId: null },
  { minute: 84, extra: null, teamId: AWAY, type: "Card", detail: "Red Card", playerId: 3003, assistId: null },
  { minute: 90, extra: 2, teamId: HOME, type: "Card", detail: "Red Card", playerId: 2002, assistId: null },
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
      { minute: 30, extra: null, teamId: HOME, type: "Goal", detail: "Goal cancelled", playerId: 4001, assistId: null },
    ];
    const spec: EventGradeSpec = { metric: "goal", window: "FT", op: ">=", value: 0 };
    expect(gradeEventBet(withCancelled, spec, "number", ctx)).toEqual({ type: "number", value: 2 });
  });

  it("counts converted penalties only", () => {
    const withPen: ApiFootballEvent[] = [
      { minute: 55, extra: null, teamId: HOME, type: "Goal", detail: "Penalty", playerId: 5001, assistId: null },
      { minute: 70, extra: null, teamId: AWAY, type: "Goal", detail: "Missed Penalty", playerId: 5002, assistId: null },
    ];
    const spec: EventGradeSpec = { metric: "penalty", window: "FT", op: ">=", value: 1 };
    expect(gradeEventBet(withPen, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
    expect(gradeEventBet(withPen, spec, "number", ctx)).toEqual({ type: "number", value: 1 });
  });
});

describe("gradeEventBet — player filter (player props)", () => {
  it("'Quinones (35532) to score?' → yes (scored at 9')", () => {
    const spec: EventGradeSpec = { metric: "goal", window: "FT", op: ">=", value: 1, playerApiId: QUINONES };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
  });

  it("'second scorer (1001) to score?' → yes (67'), and not credited to Quinones", () => {
    const spec: EventGradeSpec = { metric: "goal", window: "FT", op: ">=", value: 1, playerApiId: SECOND_SCORER };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
  });

  it("'Quinones to score in the SECOND half?' → no (his goal was at 9')", () => {
    const spec: EventGradeSpec = { metric: "goal", window: "2H", op: ">=", value: 1, playerApiId: QUINONES };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: false });
  });

  it("a player who never scored → no", () => {
    const spec: EventGradeSpec = { metric: "goal", window: "FT", op: ">=", value: 1, playerApiId: 999999 };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: false });
  });

  it("'Lira (266345) to assist?' → yes (assisted the 9' goal)", () => {
    const spec: EventGradeSpec = { metric: "goal", window: "FT", op: ">=", value: 1, playerApiId: LIRA, byAssist: true };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
  });

  it("'Quinones to assist?' → yes (assisted the 67' goal), distinct from his own goal", () => {
    const spec: EventGradeSpec = { metric: "goal", window: "FT", op: ">=", value: 1, playerApiId: QUINONES, byAssist: true };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
  });

  it("'Mokoena (3287) to be booked?' → yes (yellow at 17')", () => {
    const spec: EventGradeSpec = { metric: "yellow_card", window: "FT", op: ">=", value: 1, playerApiId: MOKOENA };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
  });

  it("a clean player carded market → no", () => {
    const spec: EventGradeSpec = { metric: "card", window: "FT", op: ">=", value: 1, playerApiId: QUINONES };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: false });
  });

  it("byAssist on a non-goal metric is malformed → skip to manual", () => {
    const spec: EventGradeSpec = { metric: "yellow_card", window: "FT", op: ">=", value: 1, playerApiId: MOKOENA, byAssist: true };
    expect(gradeEventBet(events, spec, "yes_no", ctx)).toBe("skip");
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
