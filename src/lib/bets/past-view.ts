// Pure helpers for the "Past" bet-history surfaces. Kept out of the
// row components so the display logic (what tone a points chip gets,
// what sub-label a match pick earns) is unit-testable without rendering
// React. See _plans/2026-06-12-bet-history-per-surface.md.

export type PointsTone = "positive" | "negative" | "neutral";

// What a past-bet points chip should show. `kind` drives whether a chip
// renders at all:
//   - "none"    → the user never picked this bet (render a dash)
//   - "pending" → picked, but not graded yet (live match / awaiting grade)
//   - "points"  → graded; `tone` colours the value by sign
export type PointsDisplay =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "points"; tone: PointsTone; points: number };

// Resolve the chip state for a custom-bet (tournament / group / live)
// past row. `cancelled` bets never paid out, so a picked-but-cancelled
// row shows a dash rather than a zero that would imply "you scored 0".
export function customBetPointsDisplay({
  hasPick,
  status,
  points,
}: {
  hasPick: boolean;
  status: "graded" | "reversed" | "cancelled";
  points: number | null;
}): PointsDisplay {
  if (!hasPick) return { kind: "none" };
  if (status === "cancelled") return { kind: "none" };
  if (points === null) return { kind: "pending" };
  return { kind: "points", tone: pointsTone(points), points };
}

// Resolve the chip state for a match-pick past row. A match that has
// kicked off but isn't graded yet (live, or final-but-ungraded) has
// null points → pending.
export function matchPickPointsDisplay({
  hasPick,
  points,
}: {
  hasPick: boolean;
  points: number | null;
}): PointsDisplay {
  if (!hasPick) return { kind: "none" };
  if (points === null) return { kind: "pending" };
  return { kind: "points", tone: pointsTone(points), points };
}

export function pointsTone(points: number): PointsTone {
  if (points > 0) return "positive";
  if (points < 0) return "negative";
  return "neutral";
}

// Which scoring sub-label a graded match pick earned. Drives the small
// caption under the points chip ("Exact score" / "Correct direction" /
// "Wrong"). Exact wins over direction when both flags are set.
export type MatchPickOutcome = "exact" | "direction" | "wrong";

export function matchPickOutcome({
  wasExact,
  wasCorrectOutcome,
}: {
  wasExact: boolean | null;
  wasCorrectOutcome: boolean | null;
}): MatchPickOutcome {
  if (wasExact === true) return "exact";
  if (wasCorrectOutcome === true) return "direction";
  return "wrong";
}
