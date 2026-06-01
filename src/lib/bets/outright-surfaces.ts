// Maps a tournament bet's Hebrew question to its outright odds surface.
//
// Used so a freshly created tournament bet can immediately auto-publish
// the correct odds curve (see publishTournamentTemplate). Without this,
// re-creating a bet leaves it on the flat template payout until someone
// re-runs the publish step, which silently wipes the live odds.
//
// Only the five tournament-wide surfaces are mapped. Group winners
// (group_A..group_L) are created and priced through their own path.
// Mirrors SURFACE_TO_QUESTION_PATTERN in scripts/auto-publish-outright.mjs.
//
// Kept dependency-light (type-only import) so server actions can import
// it without pulling in DB or auth code. See
// _plans/2026-06-01-tournament-bet-recreate-wipes-odds.md.

import type { OutrightSurface } from "@/db/schema";

const QUESTION_PATTERNS: ReadonlyArray<readonly [RegExp, OutrightSurface]> = [
  [/מלך השערים/, "top_scorer"],
  [/כדור הזהב/, "golden_ball"],
  [/מי תזכה במונדיאל/, "champion"],
  [/מי תהיה סגנית/, "runner_up"],
  [/מי תזכה במקום השלישי/, "third"],
];

// Returns the outright surface for a question, or null when the question
// is not one of the five tournament-wide markets (e.g. a custom special
// or a number/yes-no template that has no per-option odds).
export function outrightSurfaceForQuestion(
  questionHe: string,
): OutrightSurface | null {
  for (const [pattern, surface] of QUESTION_PATTERNS) {
    if (pattern.test(questionHe)) return surface;
  }
  return null;
}
