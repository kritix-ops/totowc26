// Pure, DB-free validation for the admin "manual match result" entry. Kept free
// of any db/server imports so it is unit-testable in isolation and safe to
// import from the server action. The admin uses this when the API sync is
// delayed (or wrong) and they need to punch a result in by hand, mark the match
// final, and trigger grading. Fail-closed: anything not explicitly allowed is
// rejected. See _plans/2026-07-03-manual-match-result-entry.md.

// What the admin submits. reg_* is the 90-minute regulation score the 1/X/2
// grader reads; final_* is the result incl. extra time (excl. penalties) used
// for display + live-bet grading. Penalties + advancingTeam are knockout-only.
export type MatchResultInput = {
  regHome: number;
  regAway: number;
  finalHome: number;
  finalAway: number;
  wentToPenalties: boolean;
  penHome: number | null;
  penAway: number | null;
  advancingTeam: string | null;
};

// The immutable facts about the match the validation checks against.
export type MatchResultContext = {
  stage: string; // 'group' or a knockout stage
  status: string; // current match status
  homeTeam: string; // teams.code
  awayTeam: string; // teams.code
  kickoffAt: Date;
  now: Date;
};

export type MatchResultError =
  | "invalid_status"
  | "match_not_started"
  | "invalid_score"
  | "invalid_penalties"
  | "invalid_advancing_team";

// Validate an admin-supplied result against the match context before it is
// persisted. Returns null when valid, otherwise a short machine-readable code.
export function validateMatchResult(
  input: MatchResultInput,
  ctx: MatchResultContext,
): null | MatchResultError {
  // A postponed / canceled match has its own dedicated flow (reopen first).
  // scheduled / live / final are all fair game — final allows correcting a
  // wrong API score.
  if (ctx.status === "postponed" || ctx.status === "canceled") {
    return "invalid_status";
  }

  // Can't finalize a match that has not kicked off yet.
  if (ctx.now.getTime() < ctx.kickoffAt.getTime()) {
    return "match_not_started";
  }

  // Score bounds. Both the 90' and the final scoreline must be 0..99, and the
  // final can only be >= regulation per side (extra-time goals only add).
  if (
    !isScore(input.regHome) ||
    !isScore(input.regAway) ||
    !isScore(input.finalHome) ||
    !isScore(input.finalAway)
  ) {
    return "invalid_score";
  }
  if (input.finalHome < input.regHome || input.finalAway < input.regAway) {
    return "invalid_score";
  }

  const isKnockout = ctx.stage !== "group";

  // Penalties: knockout-only, only when the match is level after extra time,
  // and the shootout must have a distinct winner.
  if (input.wentToPenalties) {
    if (!isKnockout) return "invalid_penalties";
    if (input.finalHome !== input.finalAway) return "invalid_penalties";
    if (!isScore(input.penHome) || !isScore(input.penAway)) {
      return "invalid_penalties";
    }
    if (input.penHome === input.penAway) return "invalid_penalties";
  } else if (input.penHome !== null || input.penAway !== null) {
    // No shootout means no penalty score may be carried.
    return "invalid_penalties";
  }

  // Advancing team ("who advances?"). Group matches have no advancement.
  if (!isKnockout) {
    if (input.advancingTeam !== null) return "invalid_advancing_team";
    return null;
  }

  // Knockout: null means "undecided" (allowed). A set team must be one of the
  // two sides AND must match who actually won on the scoreline / shootout, so
  // an admin can't award advancement to a team that visibly lost.
  if (input.advancingTeam !== null) {
    if (
      input.advancingTeam !== ctx.homeTeam &&
      input.advancingTeam !== ctx.awayTeam
    ) {
      return "invalid_advancing_team";
    }
    const winner = knockoutWinner(input, ctx);
    if (winner === null || input.advancingTeam !== winner) {
      return "invalid_advancing_team";
    }
  }

  return null;
}

// The team that advances given the scoreline, or null when it can't be
// determined (level after extra time with no valid shootout). Exported so the
// UI and the action can prefill / cross-check consistently.
export function knockoutWinner(
  input: MatchResultInput,
  ctx: Pick<MatchResultContext, "homeTeam" | "awayTeam">,
): string | null {
  if (input.finalHome > input.finalAway) return ctx.homeTeam;
  if (input.finalAway > input.finalHome) return ctx.awayTeam;
  // Level after extra time: decided only by a valid shootout.
  if (
    input.wentToPenalties &&
    isScore(input.penHome) &&
    isScore(input.penAway) &&
    input.penHome !== input.penAway
  ) {
    return input.penHome > input.penAway ? ctx.homeTeam : ctx.awayTeam;
  }
  return null;
}

function isScore(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 99;
}
