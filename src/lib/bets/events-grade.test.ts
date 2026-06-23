import { describe, expect, it } from "vitest";
import {
  gradeEventBet,
  gradeFirstEventWindow,
  gradeComeback,
  type EventGradeSpec,
  type FirstEventWindowSpec,
} from "./events-grade";
import type { ApiFootballEvent } from "@/lib/api-football";
import type { RangeOption } from "./range-grade";

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

// ─── substitution metric ──────────────────────────────────────────
// Subs come from the same /fixtures/events feed (type "subst"): player =
// coming on, assist = going off. A 46' and 62' sub for the away side, a 70'
// sub for the home side, modelled on a normal in-game shape.
const subEvents: ApiFootballEvent[] = [
  { minute: 46, extra: null, teamId: AWAY, type: "subst", detail: "Substitution 1", playerId: 6001, assistId: 6002 },
  { minute: 62, extra: null, teamId: AWAY, type: "subst", detail: "Substitution 2", playerId: 6003, assistId: 6004 },
  { minute: 70, extra: null, teamId: HOME, type: "subst", detail: "Substitution 1", playerId: 6005, assistId: 6006 },
];

describe("gradeEventBet — substitution metric", () => {
  it("'a substitution before the hour?' → yes (46')", () => {
    const spec: EventGradeSpec = { metric: "substitution", window: { fromMinute: 1, toMinute: 60 }, op: ">=", value: 1 };
    expect(gradeEventBet(subEvents, spec, "yes_no", ctx)).toEqual({ type: "yes_no", value: true });
  });

  it("counts all substitutions in the match → 3", () => {
    const spec: EventGradeSpec = { metric: "substitution", window: "FT", op: ">=", value: 0 };
    expect(gradeEventBet(subEvents, spec, "number", ctx)).toEqual({ type: "number", value: 3 });
  });

  it("does not count cards or goals as substitutions", () => {
    const spec: EventGradeSpec = { metric: "substitution", window: "FT", op: ">=", value: 0 };
    expect(gradeEventBet(events, spec, "number", ctx)).toEqual({ type: "number", value: 0 });
  });
});

// ─── gradeFirstEventWindow (distribution markets) ──────────────────
// Six 15-minute buckets plus a non-range "no event" bucket — the shape the
// prompt instructs the model to emit.
const WINDOWS: RangeOption[] = [
  { value: "1-15" },
  { value: "16-30" },
  { value: "31-45" },
  { value: "46-60" },
  { value: "61-75" },
  { value: "76-90" },
  { value: "none", labelEn: "no goal", labelHe: "אין שער" },
];

describe("gradeFirstEventWindow", () => {
  it("first goal at 9' → '1-15' bucket", () => {
    const spec: FirstEventWindowSpec = { metric: "goal" };
    expect(gradeFirstEventWindow(events, spec, WINDOWS, ctx)).toEqual({
      type: "multi_choice",
      value: "1-15",
    });
  });

  it("picks the EARLIEST matching event even when events are out of order", () => {
    const spec: FirstEventWindowSpec = { metric: "goal" };
    const shuffled = [events[4], events[0]]; // 67' goal before 9' goal
    expect(gradeFirstEventWindow(shuffled, spec, WINDOWS, ctx)).toEqual({
      type: "multi_choice",
      value: "1-15",
    });
  });

  it("first card at 17' → '16-30' bucket (metric card)", () => {
    const spec: FirstEventWindowSpec = { metric: "card" };
    expect(gradeFirstEventWindow(events, spec, WINDOWS, ctx)).toEqual({
      type: "multi_choice",
      value: "16-30",
    });
  });

  it("first RED card at 49' → '46-60' bucket", () => {
    const spec: FirstEventWindowSpec = { metric: "red_card" };
    expect(gradeFirstEventWindow(events, spec, WINDOWS, ctx)).toEqual({
      type: "multi_choice",
      value: "46-60",
    });
  });

  it("buckets a 45+2 first goal into '31-45' by clock minute", () => {
    const spec: FirstEventWindowSpec = { metric: "goal" };
    const stoppage: ApiFootballEvent[] = [
      { minute: 45, extra: 2, teamId: HOME, type: "Goal", detail: "Normal Goal", playerId: 7001, assistId: null },
    ];
    expect(gradeFirstEventWindow(stoppage, spec, WINDOWS, ctx)).toEqual({
      type: "multi_choice",
      value: "31-45",
    });
  });

  it("no matching event → the non-range 'none' bucket", () => {
    const spec: FirstEventWindowSpec = { metric: "goal", team: "away" };
    // All goals in the fixture are home; the away side never scores.
    expect(gradeFirstEventWindow(events, spec, WINDOWS, ctx)).toEqual({
      type: "multi_choice",
      value: "none",
    });
  });

  it("first home goal honours the team filter → '1-15'", () => {
    const spec: FirstEventWindowSpec = { metric: "goal", team: "home" };
    expect(gradeFirstEventWindow(events, spec, WINDOWS, ctx)).toEqual({
      type: "multi_choice",
      value: "1-15",
    });
  });

  it("player filter: Quinones' first goal → '1-15'", () => {
    const spec: FirstEventWindowSpec = { metric: "goal", playerApiId: QUINONES };
    expect(gradeFirstEventWindow(events, spec, WINDOWS, ctx)).toEqual({
      type: "multi_choice",
      value: "1-15",
    });
  });

  it("first substitution window → '46-60' (sub at 46')", () => {
    const spec: FirstEventWindowSpec = { metric: "substitution" };
    expect(gradeFirstEventWindow(subEvents, spec, WINDOWS, ctx)).toEqual({
      type: "multi_choice",
      value: "46-60",
    });
  });

  it("skips when no event AND no non-range bucket exists (fail closed)", () => {
    const spec: FirstEventWindowSpec = { metric: "goal", team: "away" };
    const numericOnly = WINDOWS.slice(0, 6); // drop the 'none' bucket
    expect(gradeFirstEventWindow(events, spec, numericOnly, ctx)).toBe("skip");
  });

  it("skips ambiguous overlapping windows (more than one bucket matches)", () => {
    const spec: FirstEventWindowSpec = { metric: "goal" };
    const overlap: RangeOption[] = [{ value: "1-15" }, { value: "5-20" }];
    // The 9' goal falls in both → ambiguous → skip to manual.
    expect(gradeFirstEventWindow(events, spec, overlap, ctx)).toBe("skip");
  });

  it("skips a VAR metric", () => {
    const spec = { metric: "var" } as unknown as FirstEventWindowSpec;
    expect(gradeFirstEventWindow(events, spec, WINDOWS, ctx)).toBe("skip");
  });

  it("skips byAssist on a non-goal metric", () => {
    const spec: FirstEventWindowSpec = { metric: "card", byAssist: true };
    expect(gradeFirstEventWindow(events, spec, WINDOWS, ctx)).toBe("skip");
  });

  it("skips a side filter with no team ids in context", () => {
    const spec: FirstEventWindowSpec = { metric: "goal", team: "home" };
    expect(gradeFirstEventWindow(events, spec, WINDOWS)).toBe("skip");
  });
});

// ─── gradeComeback (lead-then-lose) ────────────────────────────────
const goal = (minute: number, teamId: number, detail = "Normal Goal"): ApiFootballEvent => ({
  minute,
  extra: null,
  teamId,
  type: "Goal",
  detail,
  playerId: null,
  assistId: null,
});

describe("gradeComeback", () => {
  it("away comes back from 0-1 to win 2-1 → yes", () => {
    const tl = [goal(10, HOME), goal(55, AWAY), goal(80, AWAY)];
    expect(gradeComeback(tl, {}, 1, 2, ctx)).toEqual({ type: "yes_no", value: true });
  });

  it("attributes that comeback to the away side, not the home side", () => {
    const tl = [goal(10, HOME), goal(55, AWAY), goal(80, AWAY)];
    expect(gradeComeback(tl, { team: "away" }, 1, 2, ctx)).toEqual({ type: "yes_no", value: true });
    // The market asked about HOME coming back, but home lost → no.
    expect(gradeComeback(tl, { team: "home" }, 1, 2, ctx)).toEqual({ type: "yes_no", value: false });
  });

  it("a wire-to-wire 2-0 win is not a comeback → no", () => {
    // The opener fixture: both home goals (9', 67'), final 2-0.
    expect(gradeComeback(events, {}, 2, 0, ctx)).toEqual({ type: "yes_no", value: false });
  });

  it("leading, being pegged level, then winning is NOT a comeback (never strictly behind)", () => {
    const tl = [goal(20, HOME), goal(60, AWAY), goal(80, HOME)]; // 1-0, 1-1, 2-1
    expect(gradeComeback(tl, {}, 2, 1, ctx)).toEqual({ type: "yes_no", value: false });
  });

  it("a draw has no scoreboard winner → no comeback", () => {
    const tl = [goal(30, AWAY), goal(70, HOME)]; // 0-1, 1-1
    expect(gradeComeback(tl, {}, 1, 1, ctx)).toEqual({ type: "yes_no", value: false });
  });

  it("credits an own goal to the opponent (home comeback via an away own goal)", () => {
    // away scores at 10 (0-1); away own goal at 50 credits home (1-1); home
    // wins it at 80 (2-1). Home trailed early → comeback.
    const tl = [goal(10, AWAY), goal(50, AWAY, "Own Goal"), goal(80, HOME)];
    expect(gradeComeback(tl, {}, 2, 1, ctx)).toEqual({ type: "yes_no", value: true });
  });

  it("fails closed when the reconstructed score does not match the real final", () => {
    const tl = [goal(10, HOME), goal(55, AWAY), goal(80, AWAY)]; // reconstructs 1-2
    expect(gradeComeback(tl, {}, 3, 2, ctx)).toBe("skip"); // real final says 3-2
  });

  it("skips when team ids are missing from context", () => {
    const tl = [goal(10, HOME), goal(55, AWAY), goal(80, AWAY)];
    expect(gradeComeback(tl, {}, 1, 2, {})).toBe("skip");
  });
});
