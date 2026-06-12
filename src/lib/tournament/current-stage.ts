// Helpers around the tournament's current-stage label that surfaces in
// the landing hero card once the countdown reaches zero. Split out of
// the page module so the pure functions are testable without dragging
// in server-only DB code.
//
// The selection rule lives in two places:
//   • `getCurrentStage` in `db/queries.ts` runs it as SQL against the
//     `matches` table (hot path).
//   • `pickCurrentStage` below mirrors the same rule in JS so it can be
//     unit-tested with synthetic match rows.
//
// Keep them in lockstep — if the SQL changes, update the JS twin (and
// vice versa) so the tests guard real behaviour.

import type { Locale } from "@/app/[lang]/dictionaries";
import { t, type TermKey } from "@/lib/translations";

// Mirrors the `stage` Postgres enum in `db/schema.ts`. Duplicated here
// instead of importing from the DB schema so this module stays a pure
// leaf that test code can pull in without a Postgres driver in scope.
export type CurrentStage =
  | "group"
  | "r32"
  | "r16"
  | "qf"
  | "sf"
  | "third_place"
  | "final";

export type MatchStatus = "scheduled" | "live" | "final";

// Hero-stat label keys. Exhaustive Record so adding a new stage to the
// DB enum forces a compile-time entry here.
const STAGE_TO_TERM: Record<CurrentStage, TermKey> = {
  group: "group_stage",
  r32: "round_of_32",
  r16: "round_of_16",
  qf: "quarter_final",
  sf: "semi_final",
  third_place: "third_place_match",
  final: "final",
};

// Defensive fallback covers two edge cases:
//   1. Countdown has hit zero but the fixtures table is empty (a partial
//      sync). Showing "Tournament" reads less like a bug than a blank.
//   2. A future stage value reaches prod before this file ships. The
//      exhaustive map above means TypeScript would catch it, but the
//      runtime fallback costs nothing.
export function currentStageLabel(
  stage: CurrentStage | null,
  locale: Locale,
): string {
  if (!stage) return locale === "he" ? "המונדיאל" : "Tournament";
  return t(locale, STAGE_TO_TERM[stage]);
}

export type MatchForStage = {
  stage: CurrentStage;
  status: MatchStatus;
  kickoffAt: Date;
};

// Pure twin of the SQL in `getCurrentStage`. Picks the stage of the
// next match that is not yet final (earliest kickoff among scheduled +
// live); if every match is final, falls back to the latest-played
// stage so the hero card reads e.g. "Final" rather than going blank
// once the tournament wraps. Returns null when the input is empty
// (caller keeps showing the countdown).
//
// Why next-non-final and not "latest stage that has any started match":
// the third-place match is scheduled before the final in WC2026, so we
// want the label to advance to "Third-place match" once the semis wrap,
// then to "Final" once that game finishes.
export function pickCurrentStage(
  matches: ReadonlyArray<MatchForStage>,
): CurrentStage | null {
  let nextUpcoming: MatchForStage | null = null;
  let lastPlayed: MatchForStage | null = null;
  for (const m of matches) {
    if (m.status === "scheduled" || m.status === "live") {
      if (!nextUpcoming || m.kickoffAt < nextUpcoming.kickoffAt) {
        nextUpcoming = m;
      }
    } else if (m.status === "final") {
      if (!lastPlayed || m.kickoffAt > lastPlayed.kickoffAt) {
        lastPlayed = m;
      }
    }
  }
  if (nextUpcoming) return nextUpcoming.stage;
  if (lastPlayed) return lastPlayed.stage;
  return null;
}
