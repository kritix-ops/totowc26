// Auto-grade event-timing live bets (red card in the first half, goal in
// the opening 15 minutes, more than 2 cards in the match) from the
// API-Football `/fixtures/events` timeline. Pure module: it takes the
// already-fetched events and returns a resolved value, so the sync grader
// owns the fetch + the "match is final" gate and this stays unit-testable.
//
// What it does NOT do:
//   - VAR: the feed under-reports silent checks (the WC opener returned
//     zero Var events despite on-field reviews), so a VAR metric never
//     auto-resolves — it returns "skip" and the bet waits in the manual
//     queue. Never infer "no VAR" from absence.
//   - multi_choice / free_text answer types: which-window-was-first style
//     markets need ordering logic out of scope here; they return "skip".
// See _plans/2026-06-12-live-bets-llm-overhaul.md Phase 3.

import type { ApiFootballEvent } from "@/lib/api-football";

// Named half windows or an explicit clock-minute range. Half buckets use
// the clock minute (event.minute), so 45+2 stoppage stays in the first
// half and 90+4 stays in the second.
export type EventWindow =
  | "1H"
  | "2H"
  | "FT"
  | { fromMinute: number; toMinute: number };

export type EventMetric =
  | "red_card"
  | "yellow_card"
  | "card"
  | "goal"
  | "penalty"
  | "var";

export type EventOp = ">=" | ">" | "=" | "<=" | "<";

export type EventGradeSpec = {
  metric: EventMetric;
  window: EventWindow;
  // For yes_no bets the count is compared to `value` with `op`; for number
  // bets the count itself is the resolved value (op/value ignored).
  op: EventOp;
  value: number;
  // Restrict to one side. Requires the caller to pass the team ids in ctx;
  // without them a side filter degrades to "any" rather than mis-counting.
  team?: "home" | "away" | "any";
  // Restrict to one player by API-Football player id (players.api_football_id
  // joins to the event's player/assist id). Powers player-prop markets like
  // "Messi to score" (metric goal + this id) or "X to be booked" (metric
  // yellow_card + this id). null/undefined = team-or-match level, unchanged.
  playerApiId?: number;
  // When true with a `goal` metric, count goals this player ASSISTED rather
  // than scored — the "X to assist" market. Ignored for non-goal metrics.
  byAssist?: boolean;
};

export type EventGradeContext = {
  homeTeamId?: number;
  awayTeamId?: number;
};

type ResolvedYesNo = { type: "yes_no"; value: boolean };
type ResolvedNumber = { type: "number"; value: number };

// Grade an event bet. Returns a resolved value, or "skip" when the spec
// isn't auto-gradable (VAR, unsupported answer type, malformed spec) so
// the caller leaves it for manual grading.
export function gradeEventBet(
  events: ApiFootballEvent[],
  spec: EventGradeSpec,
  answerType: "yes_no" | "number" | "multi_choice" | "free_text",
  ctx?: EventGradeContext,
): ResolvedYesNo | ResolvedNumber | "skip" {
  if (spec.metric === "var") return "skip";
  if (answerType !== "yes_no" && answerType !== "number") return "skip";
  if (!isWindow(spec.window)) return "skip";

  const count = countEvents(events, spec, ctx);
  if (count === null) return "skip";

  if (answerType === "number") {
    return { type: "number", value: count };
  }
  return { type: "yes_no", value: compare(count, spec.op, spec.value) };
}

// Count the events matching metric + window + team. null signals a
// malformed spec (e.g. a team filter with no ids) the caller should skip.
function countEvents(
  events: ApiFootballEvent[],
  spec: EventGradeSpec,
  ctx?: EventGradeContext,
): number | null {
  const side = spec.team ?? "any";
  let teamId: number | undefined;
  if (side === "home") teamId = ctx?.homeTeamId;
  if (side === "away") teamId = ctx?.awayTeamId;
  if (side !== "any" && teamId === undefined) return null;

  // A player filter that names a specific id but the spec asks for an
  // assist on a non-goal metric is malformed — skip to manual rather than
  // silently counting the wrong thing.
  if (spec.playerApiId !== undefined && spec.byAssist && spec.metric !== "goal") {
    return null;
  }

  let n = 0;
  for (const e of events) {
    if (!matchesMetric(e, spec.metric)) continue;
    if (!inWindow(e.minute, spec.window)) continue;
    if (side !== "any" && e.teamId !== teamId) continue;
    if (spec.playerApiId !== undefined) {
      const actorId = spec.byAssist ? e.assistId : e.playerId;
      if (actorId !== spec.playerApiId) continue;
    }
    n += 1;
  }
  return n;
}

function matchesMetric(e: ApiFootballEvent, metric: EventMetric): boolean {
  const detail = e.detail.toLowerCase();
  switch (metric) {
    case "red_card":
      // Covers "Red Card" and "Second Yellow card" upgrades that the feed
      // labels with "red".
      return e.type === "Card" && detail.includes("red");
    case "yellow_card":
      // Plain yellow only — exclude the second-yellow→red upgrade.
      return e.type === "Card" && detail.includes("yellow") && !detail.includes("red");
    case "card":
      return e.type === "Card";
    case "goal":
      // Real goals only. The feed uses "Goal cancelled" / "Missed Penalty"
      // for non-goals, which we exclude.
      return e.type === "Goal" && !detail.includes("cancel") && !detail.includes("missed");
    case "penalty":
      // A converted penalty.
      return e.type === "Goal" && detail.includes("penalty") && !detail.includes("missed");
    case "var":
      return false; // unreachable — guarded in gradeEventBet
  }
}

function inWindow(minute: number, window: EventWindow): boolean {
  if (window === "1H") return minute <= 45;
  if (window === "2H") return minute >= 46 && minute <= 90;
  if (window === "FT") return true;
  return minute >= window.fromMinute && minute <= window.toMinute;
}

function compare(count: number, op: EventOp, value: number): boolean {
  switch (op) {
    case ">=": return count >= value;
    case ">":  return count > value;
    case "=":  return count === value;
    case "<=": return count <= value;
    case "<":  return count < value;
  }
}

// Runtime guard so a malformed jsonb spec (e.g. a window object missing a
// bound) is skipped to manual rather than mis-graded.
function isWindow(w: unknown): w is EventWindow {
  if (w === "1H" || w === "2H" || w === "FT") return true;
  if (typeof w === "object" && w !== null) {
    const o = w as { fromMinute?: unknown; toMinute?: unknown };
    return (
      typeof o.fromMinute === "number" &&
      typeof o.toMinute === "number" &&
      o.fromMinute <= o.toMinute
    );
  }
  return false;
}
