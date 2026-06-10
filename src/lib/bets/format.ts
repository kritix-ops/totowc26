import type { AnswerConfig, MultiChoiceConfig } from "./types";

// Renders a pick's JSON `answer` blob as a human-readable label. Shared by
// the admin bet surfaces (the per-user inspector, the cross-user matrix, and
// the lazy drawer) so they can never drift apart. Replaces the two identical
// `renderAnswer` helpers that used to live inline in those pages.
//
// Pure: no IO, safe to call from a server component or a server action.
//
// The one piece that needs help from the caller is dynamic-roster bets. Top
// scorer / golden ball are `multi_choice` with `dynamicSource: 'players'` and
// an EMPTY `options` array (the ~1,357-row roster is hydrated client-side, not
// embedded in answer_config), so the pick stores a raw `api_football_id`. Pass
// `playerNames` (api_football_id → localized name) and those values resolve to
// the real player name instead of leaking the id. Without the map, or for an
// id no longer on the roster, it falls back to the raw value so the cell is
// never blank.
export type PlayerNameMap = Map<string, { he: string; en: string }>;

export function renderPickAnswer(
  answerType: "yes_no" | "number" | "multi_choice" | "free_text",
  config: unknown,
  answer: unknown,
  isHebrew: boolean,
  playerNames?: PlayerNameMap,
): string {
  if (!answer || typeof answer !== "object") return "—";
  const a = answer as { type?: string; value?: unknown };
  if (a.type === "yes_no") {
    return a.value ? (isHebrew ? "כן" : "Yes") : isHebrew ? "לא" : "No";
  }
  if (a.type === "number") return String(a.value ?? "—");
  if (a.type === "multi_choice" && typeof a.value === "string") {
    const c = config as Partial<MultiChoiceConfig> | null;
    const opt = c?.options?.find((o) => o.value === a.value);
    if (opt) return isHebrew ? opt.labelHe : opt.labelEn;
    // Dynamic player roster: the option list is empty, so resolve the stored
    // api_football_id against the player-name map the caller supplies.
    if (c?.dynamicSource === "players" && playerNames) {
      const player = playerNames.get(a.value);
      if (player) return isHebrew ? player.he : player.en;
    }
    return a.value;
  }
  if (a.type === "free_text" && typeof a.value === "string") return a.value;
  return "—";
}

// Narrow re-export so callers that already hold a typed AnswerConfig don't
// have to widen to `unknown` at the call site.
export type { AnswerConfig };
