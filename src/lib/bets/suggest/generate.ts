import "server-only";

import {
  SUGGESTION_INPUT_SCHEMA,
  SUGGESTION_TOOL_NAME,
  type LiveBetSuggestion,
  type SuggestionBatch,
} from "./schema";
import { validateSuggestion } from "./transform";
import { modelById } from "./models";

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

// Scope-aware generation context. Today's surfaces are `match` (one fixture)
// and `day` (a whole matchday), but the shape is deliberately open so
// tournament/stage/group generation can slot in later without reworking the
// generator. The scope drives the prompt header + the grading note; the
// actual dossier text + valid player ids ride in GenerateOptions.
//
// See _plans/2026-06-13-live-bet-suggestions-enrichment.md (clarification 5).
export type GenerationScope = "match" | "day" | "tournament" | "stage" | "group";

export type GenerationContext = {
  scope: GenerationScope;
  // One-line description of what we're generating for, rendered at the top
  // of the user prompt, e.g. "Argentina (HE: ארגנטינה) vs Mexico ..." or
  // "All matches on Sat 14 Jun (Asia/Jerusalem)".
  label: string;
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

function buildSystemPrompt(scope: GenerationScope): string {
  const subject = scope === "match" ? "this exact fixture" : "these fixtures";
  return [
    "You design live in-play betting markets for a private World Cup pool played between friends.",
    scope === "match"
      ? "You are generating markets for ONE fixture."
      : "You are generating markets that span a whole matchday. Day-scope markets that aggregate across fixtures (total goals on the day, how many red cards across all games) are great, but they have no single-match settlement feed, so set their grading to null (manual). A market that is really about one specific fixture should be generated at match scope instead.",
    `You are given a DOSSIER of real data for ${subject} (form, injuries, key players with ids, the model's win probabilities, recent results). Treat it as a toolbox, not a checklist: read it, judge what actually fits, and build markets around what you find. The goal is bets that could only have been written for ${subject}, not generic ones that would fit any game ('over 2.5 goals', 'will there be a red card') unless the dossier gives a concrete reason to feature them.`,
    "Return a batch of varied bets via the tool.",
    "",
    "Capabilities available to you (use the ones that fit, skip the ones that don't):",
    "- Player markets keyed to a real player from the dossier (to score, to score or assist, to be booked). Reach for these when the dossier shows a player worth featuring; a scrappy game with no standout names does not need forced star props.",
    "- A team that concedes / keeps clean sheets a lot -> a clean-sheet or both-teams-to-score angle aimed at the side the data points at.",
    "- The model's projected scoreline -> a winning-margin or first-goal-window market around it.",
    "- A key injury/suspension -> a market that turns on who is missing.",
    "- Stat and event markets (cards, corners, shots) when the matchup or referee context supports them.",
    "Vary the shapes across the batch and do not repeat the same idea twice. YOU decide the mix that fits this specific game; nothing here is mandatory.",
    "",
    "Hard rules:",
    "- Every bet has Hebrew AND English question + grading rule. No em dashes anywhere.",
    "- Give each outcome a calibrated PROBABILITY (0..1). For multi_choice the options are mutually exclusive and their probabilities should roughly sum to 1. Be realistic and use the dossier: a likely outcome gets a high probability so it pays little. Do not flatten probabilities, and do not make a star striker's 'to score' a coin flip when the data says otherwise.",
    "- Prefer ONE grouped multi_choice market over several yes/no bets when outcomes are related (e.g. first-goal window: 0-15 / 16-30 / 31-45 / 46-60 / 61-75 / 76-90 / no goal).",
    "- Set grading to an auto source ONLY when the outcome is fully derivable from the data below; otherwise grading must be null (manual).",
    `  auto_football_data fields (final score / halves): ${AUTO_FOOTBALL_DATA_FIELDS.join(", ")}.`,
    `  auto_api_football stats (team totals, number bets): ${AUTO_API_FOOTBALL_STATS.join(", ")} (aggregate per_match).`,
    "  auto_api_football events (timeline, yes/no bets ONLY): { source:'auto_api_football', events:{ metric, window, op, value, team?, playerApiId?, byAssist? } }.",
    "    metric ∈ red_card|yellow_card|card|goal|penalty. window ∈ '1H'|'2H'|'FT' or {fromMinute,toMinute}. op ∈ >=|>|=|<=|<. team ∈ home|away|any (default any).",
    "    Use this for markets like 'red card in the first half?' (metric red_card, window 1H, op >=, value 1) or 'goal in the opening 15 minutes?' ({fromMinute:1,toMinute:15}).",
    "  PLAYER markets auto-grade too: set events with playerApiId = the player's id FROM THE DOSSIER (never invent an id). 'X to score' -> metric goal, window FT, op >=, value 1, playerApiId. 'X to assist' -> same plus byAssist:true. 'X to be booked' -> metric yellow_card (or card), window FT, op >=, value 1, playerApiId. Player markets must be yes_no.",
    "- Only reference a player id that appears in the dossier. If you want a player market for someone not listed, set grading null (manual) instead of guessing an id.",
    "- VAR markets have NO reliable auto source — always leave their grading null (manual).",
    "- The grading rule must be unambiguous and match the grading source/spec exactly.",
    "- rationale: one short sentence on why the probabilities are calibrated that way, citing the dossier where relevant.",
    "",
    hebrewRegisterBlock(),
  ].join("\n");
}

// Hebrew quality is a first-class requirement, not a translation afterthought.
// The pool is Israeli and reads these on their phones; translated-sounding
// Hebrew is exactly what the user flagged. Give the model register, a small
// glossary, and contrasting examples so the output reads like a friend wrote
// it, not like a localized bookmaker.
function hebrewRegisterBlock(): string {
  return [
    "Hebrew quality (critical):",
    "- Write the Hebrew like an Israeli football fan texting friends, casual and natural, NOT like a translated betting slip. It should never read as if run through a translator.",
    "- Use the natural Hebrew football register. Glossary: שער (goal), בישול/אסיסט (assist), כרטיס צהוב/אדום (yellow/red card), פנדל (penalty), קרן (corner), הפסקה/מחצית ראשונה/שנייה (half-time / first / second half), ניצחון/תיקו/הפסד (win/draw/loss), שער נקי (clean sheet), שתי הקבוצות יבקיעו (both teams to score).",
    "- Phrase player markets with the player's Hebrew name naturally, e.g. 'מסי יבקיע במשחק?' not 'האם השחקן ליאו מסי ירשום הבקעה'.",
    "- Numbers and ranges read right in Hebrew: 'יותר מ-2.5 שערים', 'השער הראשון ייפול ב-15 הדקות הראשונות'.",
    "- Examples. Natural: 'יבקיע אמבפה בכל זמן שהוא?' / 'יותר מ-9 קרנות במשחק?' / 'מי יבקיע ראשון, צרפת או אנגליה?'. Translated-sounding (AVOID): 'האם מבאפה יבצע הבקעה?' / 'מעל תשע קרניות בהתמודדות' / 'איזו נבחרת תשיג את ההבקעה הראשונה'.",
  ].join("\n");
}

export type GenerateOptions = {
  // How many bets to ask for (clamped 2..10). Default 6.
  count?: number;
  // Free-text admin steer appended to the prompt, e.g. "focus on cards and
  // corners" or "no VAR bets". Untrusted text — it can only influence the
  // wording/selection, never bypass the schema validation downstream.
  instructions?: string;
  // Rendered match dossier (src/lib/bets/suggest/dossier.ts). The whole
  // point of the overhaul: without it the model has nothing fixture-specific
  // to say and regresses to generic markets.
  dossierText?: string;
  // Every valid API-Football player id for this fixture. Any player-prop the
  // model emits with an id outside this set has its grading nulled (manual)
  // so a hallucinated id can never reach the auto grader.
  validPlayerIds?: Set<number>;
  // Questions already live/drafted for this fixture, so the model does not
  // re-propose them — the anti-repetition lever the user asked for.
  existingQuestions?: string[];
  // How many web searches the model may run before emitting (0 = off, the
  // forced-tool single shot). Clamped to 0..3. The user chose focused search.
  webSearchMaxUses?: number;
};

const DEFAULT_COUNT = 6;
const MIN_COUNT = 2;
const MAX_COUNT = 10;

function clampCount(count: number | undefined): number {
  if (count === undefined || !Number.isFinite(count)) return DEFAULT_COUNT;
  return Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round(count)));
}

function buildUserPrompt(
  context: GenerationContext,
  count: number,
  opts?: GenerateOptions,
): string {
  const subjectWord = context.scope === "match" ? "fixture" : "matchday";
  const lines = [`${context.scope === "match" ? "Fixture" : "Matchday"}: ${context.label}`];

  const dossier = opts?.dossierText?.trim();
  if (dossier) {
    lines.push("", `=== DOSSIER (real data for this ${subjectWord}) ===`, dossier, "=== END DOSSIER ===");
  } else {
    lines.push("", `(No dossier available for this ${subjectWord} — fall back to general knowledge, but stay specific to the teams involved.)`);
  }

  const existing = (opts?.existingQuestions ?? [])
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 25);
  if (existing.length > 0) {
    lines.push(
      "",
      `Bets ALREADY live for this ${subjectWord} — do NOT repeat these or trivial rewordings of them:`,
      ...existing.map((q) => `- ${q}`),
    );
  }

  lines.push("", `Produce about ${count} bets now, each specific to this ${subjectWord}.`);

  const steer = opts?.instructions?.trim();
  if (steer) {
    // Fence the admin's request so the model treats it as guidance, not as
    // instructions that could override the hard rules above.
    lines.push("", "Admin request (follow within the hard rules above):", steer.slice(0, 600));
  }
  return lines.join("\n");
}

export async function generateSuggestions(
  context: GenerationContext,
  modelId?: string,
  opts?: GenerateOptions,
): Promise<GenerateResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.warn("[live-gen stubbed]", { reason: "ANTHROPIC_API_KEY not set" });
    return { ok: false, error: "no_key" };
  }

  // Admin-selected model from settings, falling back to the catalogue
  // default (and honouring a CLAUDE_MODEL_SUGGEST override only when no
  // explicit id is passed) so a retired id can never wedge generation.
  const model = modelById(modelId ?? process.env.CLAUDE_MODEL_SUGGEST).id;
  const count = clampCount(opts?.count);
  const maxUses = clampSearchUses(opts?.webSearchMaxUses);

  const shared = {
    key,
    model,
    system: buildSystemPrompt(context.scope),
    userContent: buildUserPrompt(context, count, opts),
    // ~340 output tokens per bilingual bet; scale the cap to the requested
    // count (+headroom). Web search adds its own reasoning tokens, so give a
    // little more headroom when it's on.
    maxTokens: Math.min(4096, (maxUses > 0 ? 1000 : 700) + count * 420),
  };

  // Web search needs an agentic loop (the model searches, then emits), so we
  // can't force the emit tool from the first token. With search off we keep
  // the simple, well-worn forced-tool single shot.
  let call = maxUses > 0
    ? await callWithSearch({ ...shared, maxUses })
    : await callForcedEmit(shared);
  // Graceful degrade: if the search path errors (most likely web search is
  // not enabled on the org's Claude Console, which 4xx's the request), retry
  // once WITHOUT search. The dossier alone is still a huge quality lift, so a
  // disabled-search org gets good suggestions instead of total failure.
  if (!call.ok && maxUses > 0 && call.error === "api_error") {
    console.warn("[live-gen] search path failed; retrying without web search");
    call = await callForcedEmit(shared);
  }
  if (!call.ok) return { ok: false, error: call.error };

  const batch = call.toolInput as SuggestionBatch;
  const rawList = Array.isArray(batch.suggestions) ? batch.suggestions : [];
  const valid: LiveBetSuggestion[] = [];
  let dropped = 0;
  let demotedToManual = 0;
  for (const s of rawList) {
    // Fail closed on hallucinated player ids: if a player-prop grading spec
    // names an id that isn't on either squad, strip the auto grading so the
    // bet drops to manual rather than the grader trusting a bad id.
    if (demotePlayerIdIfInvalid(s, opts?.validPlayerIds)) demotedToManual += 1;
    const reason = validateSuggestion(s);
    if (reason) {
      dropped += 1;
      console.warn("[live-gen dropped]", { reason, question: s?.questionEn });
      continue;
    }
    valid.push(s);
  }

  console.info("[live-gen ok]", {
    subject: context.label,
    scope: context.scope,
    model,
    searchRequests: call.searchRequests,
    returned: rawList.length,
    valid: valid.length,
    dropped,
    demotedToManual,
    usage: call.usage,
  });

  if (valid.length === 0) return { ok: false, error: "empty" };
  return { ok: true, suggestions: valid };
}

// Clamp the admin/caller's requested web-search budget into a sane band.
// 0 disables search entirely (the forced-emit path). The user picked
// "focused 1-3 searches" so the ceiling stays low to keep latency + cost
// bounded.
const MAX_SEARCH_USES = 3;
function clampSearchUses(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_SEARCH_USES, Math.round(n)));
}

// If a suggestion grades on a player-id events spec whose id isn't confirmed
// to be on a squad, null its grading (manual). Returns true when it demoted
// one. Fail closed: if no valid set is known (the dossier failed, so the
// model was never given any ids) any player id it emitted is unverifiable and
// gets demoted too. Exported for unit testing — this is the guard that keeps
// a hallucinated player id from ever reaching the auto grader.
export function demotePlayerIdIfInvalid(
  s: LiveBetSuggestion,
  validPlayerIds: Set<number> | undefined,
): boolean {
  const grading = s?.grading;
  if (!grading || typeof grading !== "object" || !("events" in grading)) return false;
  const events = (grading as { events?: { playerApiId?: number } }).events;
  const id = events?.playerApiId;
  if (id === undefined) return false;
  if (validPlayerIds && validPlayerIds.has(id)) return false;
  console.warn("[live-gen player-id demote]", { id, question: s.questionEn });
  s.grading = null;
  return true;
}

// ─── transport ────────────────────────────────────────────────────

const EMIT_TOOL = {
  name: SUGGESTION_TOOL_NAME,
  description: "Emit the batch of live-bet suggestions.",
  input_schema: SUGGESTION_INPUT_SCHEMA,
};

type CallArgs = {
  key: string;
  model: string;
  system: string;
  userContent: string;
  maxTokens: number;
};

type CallOk = {
  ok: true;
  toolInput: unknown;
  usage?: AnthropicResponse["usage"];
  searchRequests: number;
};
type CallErr = { ok: false; error: "api_error" | "no_tool_use" };

// Single forced-tool shot, no web search. The original, low-latency path.
async function callForcedEmit(a: CallArgs): Promise<CallOk | CallErr> {
  const res = await postMessages(a, {
    messages: [{ role: "user", content: a.userContent }],
    tools: [EMIT_TOOL],
    tool_choice: { type: "tool", name: SUGGESTION_TOOL_NAME },
    timeoutMs: 55_000,
  });
  if (!res.ok) return res;
  const toolUse = res.json.content?.find(
    (b) => b.type === "tool_use" && b.name === SUGGESTION_TOOL_NAME,
  );
  if (!toolUse?.input) {
    console.error("[live-gen no_tool_use]", { stopReason: res.json.stop_reason });
    return { ok: false, error: "no_tool_use" };
  }
  return { ok: true, toolInput: toolUse.input, usage: res.json.usage, searchRequests: 0 };
}

// Agentic loop with the server-side web search tool. The model may search
// (Anthropic executes the search and feeds results back within the request),
// possibly across `pause_turn` continuations, then calls the emit tool. If it
// ends without emitting, we nudge it once with a forced emit so structured
// output is guaranteed.
async function callWithSearch(a: CallArgs & { maxUses: number }): Promise<CallOk | CallErr> {
  const webSearchTool = {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: a.maxUses,
    // Localize to the pool's audience so "latest news" leans Israel/Europe.
    user_location: {
      type: "approximate",
      country: "IL",
      timezone: "Asia/Jerusalem",
    },
  };
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "user", content: a.userContent },
  ];
  let searchRequests = 0;
  let forceEmit = false;
  const MAX_STEPS = 5;

  // Total wall-clock budget for the whole loop. The route's function ceiling
  // is 60s, so we MUST finish (across every search + the forced-emit
  // fallback) inside it or the function is killed mid-flight and the admin
  // sees a generic failure. 54s leaves headroom for the action's own DB work.
  const deadline = Date.now() + 54_000;
  const MIN_STEP_MS = 8_000;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_STEP_MS) {
      // Not enough budget left to risk another model round trip.
      console.error("[live-gen no_tool_use]", { reason: "search budget exhausted", searchRequests });
      return { ok: false, error: "no_tool_use" };
    }
    const res = await postMessages(a, {
      messages,
      tools: forceEmit ? [EMIT_TOOL] : [webSearchTool, EMIT_TOOL],
      tool_choice: forceEmit
        ? { type: "tool", name: SUGGESTION_TOOL_NAME }
        : { type: "auto" },
      timeoutMs: remaining,
    });
    if (!res.ok) return res;
    searchRequests += res.json.usage?.server_tool_use?.web_search_requests ?? 0;

    const toolUse = res.json.content?.find(
      (b) => b.type === "tool_use" && b.name === SUGGESTION_TOOL_NAME,
    );
    if (toolUse?.input) {
      return { ok: true, toolInput: toolUse.input, usage: res.json.usage, searchRequests };
    }

    // Carry the model's turn (text + any server_tool_use / search results)
    // back so the conversation stays coherent on the next step.
    if (res.json.content) messages.push({ role: "assistant", content: res.json.content });

    if (res.json.stop_reason === "pause_turn") {
      // Long-running search: just continue the same turn.
      continue;
    }
    // The model answered without emitting. Force the emit tool next step.
    if (!forceEmit) {
      messages.push({
        role: "user",
        content: "Now call emit_live_bet_suggestions with the full batch of bets.",
      });
      forceEmit = true;
      continue;
    }
    break; // already forced and still nothing — give up below
  }

  console.error("[live-gen no_tool_use]", { reason: "search loop exhausted", searchRequests });
  return { ok: false, error: "no_tool_use" };
}

// One POST to the Messages API. Returns the parsed body or a tagged error so
// callers branch without re-implementing the fetch + error logging.
async function postMessages(
  a: CallArgs,
  req: {
    messages: Array<{ role: string; content: unknown }>;
    tools: unknown[];
    tool_choice: unknown;
    timeoutMs: number;
  },
): Promise<{ ok: true; json: AnthropicResponse } | CallErr> {
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": a.key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: a.model,
        max_tokens: a.maxTokens,
        system: a.system,
        messages: req.messages,
        tools: req.tools,
        tool_choice: req.tool_choice,
      }),
      signal: AbortSignal.timeout(req.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[live-gen api_error]", { status: res.status, body: text.slice(0, 300) });
      return { ok: false, error: "api_error" };
    }
    return { ok: true, json: (await res.json()) as AnthropicResponse };
  } catch (err) {
    console.error("[live-gen fetch failed]", { err });
    return { ok: false, error: "api_error" };
  }
}

// Minimal shape of the Messages API response we read.
type AnthropicResponse = {
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    // Present when server tools (web search) ran; counts billed searches.
    server_tool_use?: { web_search_requests?: number };
  };
  // Content blocks. Besides text + our `tool_use` (emit), a search turn also
  // carries `server_tool_use` and `web_search_tool_result` blocks; we don't
  // read their internals, we just pass them back verbatim for continuation.
  content?: Array<{
    type: string;
    name?: string;
    input?: unknown;
  }>;
};
