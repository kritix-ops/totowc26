import "server-only";

import {
  SUGGESTION_INPUT_SCHEMA,
  SUGGESTION_TOOL_NAME,
  type LiveBetSuggestion,
  type SuggestionBatch,
} from "./schema";
import { validateSuggestion } from "./transform";

// LLM live-bet suggestion generator. Given a fixture, asks Claude for a
// batch of complete, in-format live bets — each with a probability per
// outcome — and returns only the ones that pass shape validation. The
// caller (the generate action) prices them via suggestionToDraft and queues
// them as drafts for the admin to review. The model never sets odds or
// publishes; it proposes probabilities and copy.
//
// Cost: ~4k in + 3k out per call on Sonnet 4.6 ≈ $0.057. A whole World Cup
// of regeneration is a few dollars. Pricing flagged in
// _plans/2026-06-12-live-bets-llm-overhaul.md §Cost.
//
// Follows the same forced-tool-use call shape the player-translation script
// uses (scripts/translate-players.mjs) — a pattern already verified against
// the live Messages API in this repo.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = process.env.CLAUDE_MODEL_SUGGEST ?? "claude-sonnet-4-6";

export type FixtureContext = {
  homeNameHe: string;
  homeNameEn: string;
  awayNameHe: string;
  awayNameEn: string;
  // Stage label for context, e.g. "Group Stage" / "Round of 16".
  stage: string;
  // Asia/Jerusalem kickoff string for the prompt (display only).
  kickoffLabel: string;
};

export type GenerateResult =
  | { ok: true; suggestions: LiveBetSuggestion[] }
  | { ok: false; error: "no_key" | "api_error" | "no_tool_use" | "empty" };

// The settlement vocabulary the model may target. Anything outside this set
// must be `grading: null` (manual). Kept in sync with the auto sources the
// system can actually evaluate today (src/lib/bets/types.ts + the grader).
// Event-window markets (VAR, red-in-half) have no auto source yet, so the
// prompt tells the model to leave those manual.
const AUTO_FOOTBALL_DATA_FIELDS = [
  "winner", "total_goals", "ht_total", "second_half_total", "home_score",
  "away_score", "winning_margin", "went_to_penalties", "btts", "home_scored",
  "away_scored", "clean_sheet_home", "clean_sheet_away", "first_half_goal",
  "second_half_goal", "both_halves_scored", "over_0_5_goals", "over_1_5_goals",
  "over_2_5_goals", "over_3_5_goals", "over_4_5_goals",
];
const AUTO_API_FOOTBALL_STATS = [
  "corners", "yellow_cards", "red_cards", "shots", "shots_on_goal",
  "shots_inside_box", "shots_outside_box", "possession", "fouls", "offsides",
  "saves", "total_passes", "pass_accuracy",
];

function buildSystemPrompt(): string {
  return [
    "You design live in-play betting markets for a friends World Cup pool.",
    "Return a batch of varied, sensible bets for the given fixture via the tool.",
    "",
    "Hard rules:",
    "- Every bet has Hebrew AND English question + grading rule. Hebrew must read naturally (not translated-sounding). No em dashes.",
    "- Give each outcome a calibrated PROBABILITY (0..1). For multi_choice the options are mutually exclusive and their probabilities should roughly sum to 1. Be realistic: a likely outcome gets a high probability so it pays little; do not flatten probabilities.",
    "- Prefer ONE grouped multi_choice market over several yes/no bets when outcomes are related (e.g. first-goal window: 0-15 / 16-30 / 31-45 / 46-60 / 61-75 / 76-90 / no goal; or VAR: 1st half / 2nd half / none).",
    "- Set grading to an auto source ONLY when the outcome is fully derivable from the final score or team match-stats listed below; otherwise grading must be null (manual).",
    `  auto_football_data fields: ${AUTO_FOOTBALL_DATA_FIELDS.join(", ")}.`,
    `  auto_api_football stats: ${AUTO_API_FOOTBALL_STATS.join(", ")} (aggregate per_match).`,
    "- Event-timing or VAR markets have no auto source yet — leave their grading null.",
    "- The grading rule must be unambiguous and match the grading source when set.",
    "- rationale: one short sentence on why the probabilities are calibrated that way.",
    "",
    "Aim for 6-10 diverse bets: a couple of safe ones, a couple of grouped exotic markets, and a few stat-based ones.",
  ].join("\n");
}

function buildUserPrompt(fx: FixtureContext): string {
  return [
    `Fixture: ${fx.homeNameEn} (HE: ${fx.homeNameHe}) vs ${fx.awayNameEn} (HE: ${fx.awayNameHe}).`,
    `Stage: ${fx.stage}. Kickoff: ${fx.kickoffLabel}.`,
    "Produce the live-bet batch now.",
  ].join("\n");
}

export async function generateSuggestions(
  fx: FixtureContext,
): Promise<GenerateResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.warn("[live-gen stubbed]", { reason: "ANTHROPIC_API_KEY not set" });
    return { ok: false, error: "no_key" };
  }

  const body = {
    model: MODEL,
    max_tokens: 4096,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(fx) }],
    tools: [
      {
        name: SUGGESTION_TOOL_NAME,
        description: "Emit the batch of live-bet suggestions for the fixture.",
        input_schema: SUGGESTION_INPUT_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: SUGGESTION_TOOL_NAME },
  };

  let json: AnthropicResponse;
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      // Generation is interactive (admin clicks "generate"); a hung
      // upstream must not pin the action. 30s is generous for one call.
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[live-gen api_error]", { status: res.status, body: text.slice(0, 300) });
      return { ok: false, error: "api_error" };
    }
    json = (await res.json()) as AnthropicResponse;
  } catch (err) {
    console.error("[live-gen fetch failed]", { err });
    return { ok: false, error: "api_error" };
  }

  const toolUse = json.content?.find(
    (b) => b.type === "tool_use" && b.name === SUGGESTION_TOOL_NAME,
  );
  if (!toolUse || !toolUse.input) {
    console.error("[live-gen no_tool_use]", { stopReason: json.stop_reason });
    return { ok: false, error: "no_tool_use" };
  }

  const batch = toolUse.input as SuggestionBatch;
  const raw = Array.isArray(batch.suggestions) ? batch.suggestions : [];
  const valid: LiveBetSuggestion[] = [];
  let dropped = 0;
  for (const s of raw) {
    const reason = validateSuggestion(s);
    if (reason) {
      dropped += 1;
      console.warn("[live-gen dropped]", { reason, question: s?.questionEn });
      continue;
    }
    valid.push(s);
  }

  console.info("[live-gen ok]", {
    fixture: `${fx.homeNameEn} vs ${fx.awayNameEn}`,
    model: MODEL,
    returned: raw.length,
    valid: valid.length,
    dropped,
    usage: json.usage,
  });

  if (valid.length === 0) return { ok: false, error: "empty" };
  return { ok: true, suggestions: valid };
}

// Minimal shape of the Messages API response we read.
type AnthropicResponse = {
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  content?: Array<{
    type: string;
    name?: string;
    input?: unknown;
  }>;
};
