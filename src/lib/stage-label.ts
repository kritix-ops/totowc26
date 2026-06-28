// Canonical tournament-stage labels, bilingual. New surfaces (the quick-picks
// cards, the "who advances?" picker) import this instead of hand-rolling yet
// another copy of the stage→Hebrew map. Group matches fold the group letter in
// when one is supplied ("בית A" / "Group A").
import type { StageKey } from "@/db/schema";

const STAGE_LABELS: Record<StageKey, [he: string, en: string]> = {
  group: ["שלב הבתים", "Group stage"],
  r32: ["שלב 32 האחרונות", "Round of 32"],
  r16: ["שמינית גמר", "Round of 16"],
  qf: ["רבע גמר", "Quarter-final"],
  sf: ["חצי גמר", "Semi-final"],
  third_place: ["משחק על המקום השלישי", "Third-place play-off"],
  final: ["גמר", "Final"],
};

export function stageLabel(
  stage: string,
  groupId: string | null,
  locale: "he" | "en",
): string {
  if (stage === "group" && groupId) {
    return locale === "he" ? `בית ${groupId}` : `Group ${groupId}`;
  }
  const pair = STAGE_LABELS[stage as StageKey];
  if (!pair) return stage;
  return pair[locale === "he" ? 0 : 1];
}

// True for any post-group knockout stage — the surfaces that show the
// "who advances?" pick gate on this.
export function isKnockoutStage(stage: string): boolean {
  return stage !== "group";
}
