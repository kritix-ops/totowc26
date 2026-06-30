import "server-only";

import {
  SUGGESTION_INPUT_SCHEMA,
  SUGGESTION_TOOL_NAME,
  type LiveBetSuggestion,
  type SuggestionBatch,
} from "./schema";
import { validateSuggestion } from "./transform";
import { modelById } from "./models";
import {
  buildSystemPrompt,
  buildUserPrompt,
  type GenerationContext,
  type GenerateOptions,
} from "./prompt";

// Re-exported so existing callers that imported these from generate keep
// working; the definitions now live in the pure ./prompt module.
export type { GenerationContext, GenerationScope, GenerateOptions } from "./prompt";

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

// Diagnostics for one generation run, surfaced in the admin log (live_gen_runs)
// and the [live-gen ok] console line. Partially filled on the error paths
// where the values aren't known yet (e.g. the model never returned a batch).
export type GenStats = {
  returned: number;
  valid: number;
  dropped: number;
  demotedToManual: number;
  searchRequests: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type GenerateResult =
  | { ok: true; suggestions: LiveBetSuggestion[]; stats: GenStats }
  | {
      ok: false;
      error: "no_key" | "api_error" | "no_tool_use" | "empty";
      stats?: GenStats;
    };

const DEFAULT_COUNT = 8;
const MIN_COUNT = 2;
const MAX_COUNT = 10;

function clampCount(count: number | undefined): number {
  if (count === undefined || !Number.isFinite(count)) return DEFAULT_COUNT;
  return Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round(count)));
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
    system: buildSystemPrompt(context.scope, opts?.guidance, opts?.dataGuidance),
    userContent: buildUserPrompt(context, count, opts),
    // A rich bilingual bet (a 5-7 bucket distribution with He+En labels, a
    // bilingual question + grading rule, grading config and rationale) runs
    // ~550-650 output tokens — far more than a plain yes/no — so the old
    // 4096 ceiling truncated a varied batch mid-tool-call and returned zero
    // bets. Scale ~650/bet and cap at 8192 (well within the 4.x models' 64k
    // output limit) so a 10-bet varied batch always completes. Web search
    // adds reasoning tokens, so a touch more headroom when it's on.
    maxTokens: Math.min(8192, (maxUses > 0 ? 1400 : 1000) + count * 650),
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
  if (!call.ok) {
    // The API/transport never produced a batch — return what little we know
    // (search count) so the run log can still record the failure shape.
    return {
      ok: false,
      error: call.error,
      stats: {
        returned: 0,
        valid: 0,
        dropped: 0,
        demotedToManual: 0,
        searchRequests: 0,
      },
    };
  }

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

  const stats: GenStats = {
    returned: rawList.length,
    valid: valid.length,
    dropped,
    demotedToManual,
    searchRequests: call.searchRequests,
    inputTokens: call.usage?.input_tokens,
    outputTokens: call.usage?.output_tokens,
  };

  console.info("[live-gen ok]", {
    subject: context.label,
    scope: context.scope,
    model,
    ...stats,
    usage: call.usage,
  });

  if (valid.length === 0) return { ok: false, error: "empty", stats };
  return { ok: true, suggestions: valid, stats };
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
