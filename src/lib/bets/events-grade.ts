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
//
// gradeEventBet still grades only yes_no / number (a count compared to a
// threshold). The multi_choice "which window did the FIRST <event> fall in"
// distribution markets — the juiciest live bets — are graded by the separate
// gradeFirstEventWindow below, which buckets the first matching event's clock
// minute onto a window option. See
// _plans/2026-06-23-live-bet-distribution-and-day-aggregation.md.

import type { ApiFootballEvent } from "@/lib/api-football";
import { matchRangeOption, optionRange, type RangeOption } from "./range-grade";

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
  | "substitution"
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

// Spec for a "which window did the FIRST <metric> fall in" multi_choice
// market. No op/value/window: the windows live in the bet's multi_choice
// options (as minute-range tokens), and the answer is the bucket containing
// the first matching event's clock minute. A "no event" option (a non-range
// bucket like "no goal") catches the case where the metric never occurs.
export type FirstEventWindowSpec = {
  metric: EventMetric;
  team?: "home" | "away" | "any";
  // Restrict to one player by API-Football id (e.g. "in which window does
  // Messi score his first goal"). Unset = team-or-match level.
  playerApiId?: number;
  // With metric goal, bucket the player's first ASSIST instead of goal.
  byAssist?: boolean;
};

type ResolvedYesNo = { type: "yes_no"; value: boolean };
type ResolvedNumber = { type: "number"; value: number };
type ResolvedMultiChoice = { type: "multi_choice"; value: string };

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
    case "substitution":
      // The feed labels substitutions `type:"subst"` (player = coming on,
      // assist = going off). Exact type match so nothing else is miscounted.
      return e.type.toLowerCase() === "subst";
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

// Grade a "which window did the FIRST <metric> fall in" multi_choice market.
// Buckets the first matching event's clock minute onto the option whose range
// token contains it (reusing the tested range matcher). When the metric never
// occurs, resolves to the single non-range "no event" option. Fails closed —
// ambiguous options, a malformed filter, or a minute that no/many options
// claim → "skip" → the bet stays in the manual queue rather than risk a wrong
// credit. The caller owns the "match is final + feed reachable" gate.
export function gradeFirstEventWindow(
  events: ApiFootballEvent[],
  spec: FirstEventWindowSpec,
  options: RangeOption[],
  ctx?: EventGradeContext,
): ResolvedMultiChoice | "skip" {
  if (spec.metric === "var") return "skip";
  // An assist filter only makes sense on goals.
  if (spec.byAssist && spec.metric !== "goal") return "skip";

  const side = spec.team ?? "any";
  let teamId: number | undefined;
  if (side === "home") teamId = ctx?.homeTeamId;
  if (side === "away") teamId = ctx?.awayTeamId;
  if (side !== "any" && teamId === undefined) return "skip";

  const first = events
    .filter((e) => {
      if (!matchesMetric(e, spec.metric)) return false;
      if (side !== "any" && e.teamId !== teamId) return false;
      if (spec.playerApiId !== undefined) {
        const actorId = spec.byAssist ? e.assistId : e.playerId;
        if (actorId !== spec.playerApiId) return false;
      }
      return true;
    })
    // Earliest event wins. Stoppage (extra) breaks ties within a minute so a
    // 45+2 event sorts after a clean 45'. Clock minute is used for bucketing
    // so 45+2 stays in the first-half window.
    .sort((a, b) => a.minute - b.minute || (a.extra ?? 0) - (b.extra ?? 0))[0];

  if (!first) {
    // No matching event: resolve to the sole non-range bucket ("no goal").
    const none = options.filter((o) => optionRange(o) === null);
    return none.length === 1
      ? { type: "multi_choice", value: none[0].value }
      : "skip";
  }

  const value = matchRangeOption(options, first.minute);
  return value ? { type: "multi_choice", value } : "skip";
}

// Spec for a comeback (lead-then-lose) market: did the full-time winner trail
// on the scoreboard at some point? `team` narrows to one side completing the
// comeback ("will HOME come back to win"); "any"/unset = either side.
export type ComebackSpec = {
  team?: "home" | "away" | "any";
};

// Grade a comeback market (yes_no). Reconstructs the running score from goal
// events in minute order — own goals credited to the OTHER side — and reports
// whether the eventual full-time winner was ever strictly behind. Needs the
// real final score: it determines the winner AND guards feed completeness
// (if the reconstructed final does not equal the real final the timeline is
// missing or carries stray goals, so we fail closed to manual rather than
// risk a wrong grade). A drawn match (incl. decided on penalties) has no
// scoreboard winner, so it is never a comeback.
export function gradeComeback(
  events: ApiFootballEvent[],
  spec: ComebackSpec,
  finalHomeScore: number,
  finalAwayScore: number,
  ctx: EventGradeContext,
): ResolvedYesNo | "skip" {
  if (ctx.homeTeamId === undefined || ctx.awayTeamId === undefined) return "skip";

  const goals = events
    .filter(
      (e) =>
        e.type === "Goal" &&
        !e.detail.toLowerCase().includes("cancel") &&
        !e.detail.toLowerCase().includes("missed"),
    )
    .sort((a, b) => a.minute - b.minute || (a.extra ?? 0) - (b.extra ?? 0));

  const winner =
    finalHomeScore > finalAwayScore
      ? "home"
      : finalAwayScore > finalHomeScore
        ? "away"
        : "draw";

  let home = 0;
  let away = 0;
  let winnerEverBehind = false;
  for (const g of goals) {
    // An own goal is logged under the conceding player's team, so it scores
    // for the opponent.
    const ownGoal = g.detail.toLowerCase().includes("own goal");
    let scoringSide: "home" | "away" | null = null;
    if (g.teamId === ctx.homeTeamId) scoringSide = ownGoal ? "away" : "home";
    else if (g.teamId === ctx.awayTeamId) scoringSide = ownGoal ? "home" : "away";
    if (scoringSide === null) continue; // stray team id → trips the guard below

    if (scoringSide === "home") home += 1;
    else away += 1;
    if (winner === "home" && home < away) winnerEverBehind = true;
    if (winner === "away" && away < home) winnerEverBehind = true;
  }

  // Feed-completeness guard: the reconstructed final must match the real one.
  if (home !== finalHomeScore || away !== finalAwayScore) return "skip";

  if (winner === "draw") return { type: "yes_no", value: false };
  if (spec.team && spec.team !== "any" && spec.team !== winner) {
    return { type: "yes_no", value: false };
  }
  return { type: "yes_no", value: winnerEverBehind };
}
