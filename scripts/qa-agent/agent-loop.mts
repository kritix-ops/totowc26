// Anthropic tool-use loop with two hard backstops:
//   1) BUDGET_USD_HARD_CAP - sum of spend across all model calls in a
//      run. Stops a runaway loop from costing real money.
//   2) MAX_TURNS_PER_SCENARIO - sum of model turns across a scenario.
//      Backstop in case the model gets stuck looping on the same step
//      below the budget cap.

import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import {
  MODEL,
  BUDGET_USD_HARD_CAP,
  MAX_TURNS_PER_SCENARIO,
  PRICE_PER_MTOK_INPUT_USD,
  PRICE_PER_MTOK_OUTPUT_USD,
  PRICE_PER_MTOK_CACHE_READ_USD,
  PRICE_PER_MTOK_CACHE_WRITE_USD,
} from "./config.mts";
import type { ToolRunner } from "./browser-tools.mts";

export type RunOutcome = {
  scenario: string;
  turns: number;
  stoppedReason: "complete" | "budget_cap" | "turn_cap" | "error";
  usdSpent: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  finalAssistantText: string | null;
  error?: string;
};

export type Budget = {
  usdSpent: number;
  inputTokens: number;
  outputTokens: number;
  add: (u: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  }) => void;
  withinCap: () => boolean;
};

export function makeBudget(): Budget {
  const b: Budget = {
    usdSpent: 0,
    inputTokens: 0,
    outputTokens: 0,
    add(u) {
      const input = u.input_tokens ?? 0;
      const output = u.output_tokens ?? 0;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const cacheWrite = u.cache_creation_input_tokens ?? 0;
      this.inputTokens += input + cacheRead + cacheWrite;
      this.outputTokens += output;
      this.usdSpent +=
        (input / 1_000_000) * PRICE_PER_MTOK_INPUT_USD +
        (output / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD +
        (cacheRead / 1_000_000) * PRICE_PER_MTOK_CACHE_READ_USD +
        (cacheWrite / 1_000_000) * PRICE_PER_MTOK_CACHE_WRITE_USD;
    },
    withinCap() {
      return this.usdSpent < BUDGET_USD_HARD_CAP;
    },
  };
  return b;
}

export async function runScenario(opts: {
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  scenarioName: string;
  tools: ToolRunner;
  budget: Budget;
  log: (line: string) => void;
}): Promise<RunOutcome> {
  const start = Date.now();
  const client = new Anthropic({ apiKey: opts.apiKey });
  const messages: MessageParam[] = [
    { role: "user", content: opts.userPrompt },
  ];
  let turns = 0;
  let stoppedReason: RunOutcome["stoppedReason"] = "complete";
  let finalText: string | null = null;
  let errorMsg: string | undefined;

  try {
    for (;;) {
      if (!opts.budget.withinCap()) {
        stoppedReason = "budget_cap";
        opts.log(
          `[qa.budget] HARD CAP HIT at $${opts.budget.usdSpent.toFixed(4)} (cap $${BUDGET_USD_HARD_CAP}). Aborting.`,
        );
        break;
      }
      if (turns >= MAX_TURNS_PER_SCENARIO) {
        stoppedReason = "turn_cap";
        opts.log(`[qa.turns] hit MAX_TURNS_PER_SCENARIO=${MAX_TURNS_PER_SCENARIO}. Aborting.`);
        break;
      }
      turns += 1;

      // Prompt caching: mark the system prompt, the tools array, and the
      // most-recent tool_result so the entire conversation prefix gets
      // cached. Cached input is billed at the cache-read rate (~10x
      // cheaper than fresh input) for the next 5 minutes - which is
      // exactly the window in which we will make our next turn. Without
      // this, every turn pays the full input rate on the entire growing
      // history (which scales quadratically with turn count).
      //
      // Anthropic allows up to 4 breakpoints. We use 3:
      //   1. system prompt
      //   2. tools array (last tool gets the marker)
      //   3. latest tool_result in the conversation
      // Older tool_result breakpoints are cleared so we never exceed 4.
      stampCacheControl(messages);
      const cachedTools = withToolsCacheControl(opts.tools.schemas);

      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: [
          {
            type: "text",
            text: opts.systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: cachedTools as Parameters<typeof client.messages.create>[0]["tools"],
        messages,
      });

      opts.budget.add({
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
      });
      const cacheRead = res.usage.cache_read_input_tokens ?? 0;
      const cacheWrite = res.usage.cache_creation_input_tokens ?? 0;
      opts.log(
        `[qa.budget] turn=${turns} in=${res.usage.input_tokens} out=${res.usage.output_tokens} cache_r=${cacheRead} cache_w=${cacheWrite} run_total=$${opts.budget.usdSpent.toFixed(4)} reqId=${res.id}`,
      );

      messages.push({ role: "assistant", content: res.content });

      if (res.stop_reason !== "tool_use") {
        finalText = extractText(res.content);
        opts.log(`[qa.scenario] model stopped: ${res.stop_reason}`);
        break;
      }

      const toolUses = res.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use",
      );
      const toolResults = await Promise.all(
        toolUses.map(async (block) => {
          const out = await opts.tools.run(block.name, block.input);
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: out,
            is_error: out.startsWith("ERROR:"),
          };
        }),
      );
      messages.push({ role: "user", content: toolResults });
    }
  } catch (e) {
    stoppedReason = "error";
    errorMsg = e instanceof Error ? e.message : String(e);
    opts.log(`[qa.fatal] ${errorMsg}`);
  }

  return {
    scenario: opts.scenarioName,
    turns,
    stoppedReason,
    usdSpent: opts.budget.usdSpent,
    inputTokens: opts.budget.inputTokens,
    outputTokens: opts.budget.outputTokens,
    durationMs: Date.now() - start,
    finalAssistantText: finalText,
    error: errorMsg,
  };
}

function extractText(content: ReadonlyArray<ContentBlock>): string | null {
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === "text") parts.push(b.text);
  }
  return parts.length ? parts.join("\n").trim() : null;
}

// Ensure exactly one tool_result block in the message history carries a
// cache_control marker: the last one. Older markers are stripped so the
// 4-breakpoint API limit is never exceeded as the conversation grows.
// Mutates `messages` in place so the next create() call sees the result.
function stampCacheControl(messages: MessageParam[]): void {
  let lastIndex: { msg: number; block: number } | null = null;
  for (let m = 0; m < messages.length; m += 1) {
    const msg = messages[m];
    if (typeof msg.content === "string") continue;
    for (let b = 0; b < msg.content.length; b += 1) {
      const block = msg.content[b];
      if (block.type !== "tool_result") continue;
      // Strip any cache_control that may have been set on a previous
      // turn. We will re-add it to the truly-last one in a moment.
      const tr = block as ToolResultBlockParam & { cache_control?: unknown };
      if ("cache_control" in tr) delete tr.cache_control;
      lastIndex = { msg: m, block: b };
    }
  }
  if (!lastIndex) return;
  const msg = messages[lastIndex.msg];
  if (typeof msg.content === "string") return;
  const target = msg.content[lastIndex.block] as ToolResultBlockParam & {
    cache_control?: { type: "ephemeral" };
  };
  target.cache_control = { type: "ephemeral" };
}

// Attach cache_control to the final tool in the tools array so the
// tools-definition block becomes cacheable too. Returns a shallow copy
// so the source ToolRunner stays pure.
function withToolsCacheControl(
  schemas: ReadonlyArray<{ name: string; description: string; input_schema: unknown }>,
): unknown[] {
  if (schemas.length === 0) return [];
  const copy = schemas.map((s) => ({ ...s }));
  (copy[copy.length - 1] as { cache_control?: { type: "ephemeral" } }).cache_control = {
    type: "ephemeral",
  };
  return copy;
}
