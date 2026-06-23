// One-off: preview the live-bet suggestions the LLM produces with the new
// distribution-first / day-aggregation / comeback prompts, WITHOUT publishing
// anything. Uses the REAL prompt builders (src/lib/bets/suggest/prompt.ts) and
// the REAL tool schema (schema.ts), so what it prints is faithful to what the
// admin "generate" button would queue as drafts.
//
// The dossier here is representative (a marquee group-stage clash + a 3-match
// day), not pulled from the DB — the prompt behaviour we're checking (does it
// LEAD with multi_choice distributions? do day bets AGGREGATE across the slate
// and self-grade?) is driven by the prompt, not the specific teams.
//
// Run: npx tsx --env-file=.env.local scripts/one-off/preview-live-suggestions-2026-06-23.mts
// Cost: ~$0.06 per call on Sonnet 4.6 (two calls). Forced-tool, no web search.

import { buildSystemPrompt, buildUserPrompt, type GenerationScope } from "../../src/lib/bets/suggest/prompt.ts";
import { SUGGESTION_INPUT_SCHEMA, SUGGESTION_TOOL_NAME } from "../../src/lib/bets/suggest/schema.ts";

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL_SUGGEST || "claude-sonnet-4-6";
if (!KEY) {
  console.error("ANTHROPIC_API_KEY not set. Run with --env-file=.env.local");
  process.exit(1);
}

const MATCH_DOSSIER = `
Fixture: Spain vs Germany — Group E, matchday 2.
Model: Spain win 44% / draw 28% / Germany win 28%. Projected scoreline 1-1 (tight).
Spain: form W-W-D, 5 scored / 2 conceded, 2 clean sheets in 3. Possession-heavy, draws lots of corners.
Germany: form W-D-L, 4 scored / 4 conceded, 0 clean sheets. Concedes set pieces; physical midfield, books often.
Referee: averages 4.8 yellows / game.
Spain key players:
- Lamine Yamal (id 360812, Winger)[2G 1A 1Y]
- Alvaro Morata (id 2003, Forward)[1G 0A 1Y]
- Rodri (id 18981, Midfield)[0G 1A 2Y]
Germany key players:
- Jamal Musiala (id 246424, Midfield)[2G 1A 0Y]
- Kai Havertz (id 1101, Forward)[1G 1A 1Y]
- Joshua Kimmich (id 999, Midfield)[0G 2A 3Y]
Injuries: Germany — Antonio Rudiger (knock, doubtful).
`.trim();

const DAY_DOSSIER = `
--- Fixture 1: Brazil vs Switzerland (Group G) ---
Model: Brazil 58% / draw 24% / Switzerland 18%. Projected 2-0. Brazil attack-heavy, ~6 corners/game.
Brazil: form W-W-W, 7 scored / 1 conceded. Switzerland: form D-W-L, low-event games.

--- Fixture 2: Portugal vs Uruguay (Group H) ---
Model: Portugal 47% / draw 27% / Uruguay 26%. Projected 1-1. Both sides book heavily; ref averages 5.3 yellows.
Portugal: 4 scored / 3 conceded. Uruguay: physical, 6 yellows across 2 games, 1 red.

--- Fixture 3: Mexico vs South Korea (Group F) ---
Model: Mexico 41% / draw 30% / South Korea 29%. Projected 1-1. Open, end-to-end; high shot counts both sides.
Mexico: 3 scored / 3 conceded. South Korea: counter-attacking, draws fouls.
`.trim();

type Bet = {
  questionHe: string;
  questionEn: string;
  answerType: "yes_no" | "multi_choice";
  options?: Array<{ value: string; labelHe: string; labelEn: string; probability: number }>;
  yesProbability?: number;
  grading: unknown;
  rationale: string;
};

async function generate(scope: GenerationScope, label: string, dossier: string, count: number) {
  const system = buildSystemPrompt(scope);
  const user = buildUserPrompt({ scope, label }, count, { dossierText: dossier });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
      tools: [
        {
          name: SUGGESTION_TOOL_NAME,
          description: "Emit the batch of live-bet suggestions.",
          input_schema: SUGGESTION_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: SUGGESTION_TOOL_NAME },
    }),
  });
  const json: any = await res.json();
  if (!res.ok) {
    console.error("API error", res.status, JSON.stringify(json).slice(0, 500));
    process.exit(1);
  }
  const tool = json.content?.find((b: any) => b.type === "tool_use");
  return { bets: (tool?.input?.suggestions ?? []) as Bet[], usage: json.usage };
}

function gradingLabel(g: any): string {
  if (g == null) return "MANUAL";
  if (g.source === "auto_football_data") return `auto_football_data:${g.field}`;
  if (g.source === "auto_api_football") {
    if (g.stat) return `auto_api_football:${g.stat}/${g.aggregate}`;
    if (g.events) return `events:${g.events.metric}`;
    if (g.firstEventWindow) return `firstEventWindow:${g.firstEventWindow.metric}`;
    if (g.comeback) return `comeback:${g.comeback.team ?? "any"}`;
  }
  return JSON.stringify(g);
}

function printBatch(title: string, bets: Bet[], usage: any) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
  let multi = 0;
  let auto = 0;
  bets.forEach((b, i) => {
    const isMulti = b.answerType === "multi_choice";
    if (isMulti) multi += 1;
    if (b.grading != null) auto += 1;
    console.log(`\n[${i + 1}] (${b.answerType})  grading=${gradingLabel(b.grading)}`);
    console.log(`    HE: ${b.questionHe}`);
    console.log(`    EN: ${b.questionEn}`);
    if (isMulti && b.options) {
      for (const o of b.options) {
        console.log(`       - ${o.value.padEnd(8)} ${o.labelHe}  (${Math.round(o.probability * 100)}%)`);
      }
    } else if (b.yesProbability != null) {
      console.log(`       yes ${Math.round(b.yesProbability * 100)}%`);
    }
    console.log(`    why: ${b.rationale}`);
  });
  console.log(
    `\n  -> ${bets.length} bets | ${multi} distributions (multi_choice) | ${auto} auto-grading | ${bets.length - auto} manual`,
  );
  if (usage) console.log(`  tokens: in ${usage.input_tokens}, out ${usage.output_tokens}`);
}

const matchRes = await generate("match", "Spain (HE: ספרד) vs Germany (HE: גרמניה) — Group E", MATCH_DOSSIER, 7);
printBatch("MATCH SCOPE — Spain vs Germany", matchRes.bets, matchRes.usage);

const dayRes = await generate("day", "All matches on Sat 27 Jun (3 fixtures)", DAY_DOSSIER, 6);
printBatch("DAY SCOPE — 3-match slate (must aggregate across ALL)", dayRes.bets, dayRes.usage);
