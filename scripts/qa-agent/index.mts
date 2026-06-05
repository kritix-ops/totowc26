// QA agent CLI entry point.
//
// Usage:
//   pnpm qa-agent <scenario|all>
//
// Where scenario ∈ { live-bets | outrights | rtl-mobile }.
//
// "all" runs the three scenarios in sequence, sharing a single
// budget cap and a single report folder.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { readAgentEnv, VIEWPORTS } from "./config.mts";
import { makeBrowserTools, type Finding, appendTrace } from "./browser-tools.mts";
import { makeBudget, runScenario, type RunOutcome } from "./agent-loop.mts";
import { makeReportDir, writeReport, pruneOldReports } from "./reporter.mts";
import { liveBetsScenario } from "./scenarios/live-bets.mts";
import { outrightsScenario } from "./scenarios/outrights.mts";
import { rtlMobileScenario } from "./scenarios/rtl-mobile.mts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

type ScenarioKey = "live-bets" | "outrights" | "rtl-mobile";

const SCENARIO_REGISTRY: Record<
  ScenarioKey,
  { name: string; userPrompt: (a: { baseUrl: string; qaBotEmail: string; qaBotPassword: string }) => string }
> = {
  "live-bets": liveBetsScenario,
  outrights: outrightsScenario,
  "rtl-mobile": rtlMobileScenario,
};

function usage(): never {
  console.error("Usage: pnpm qa-agent <live-bets|outrights|rtl-mobile|all>");
  process.exit(1);
}

const arg = process.argv[2];
if (!arg) usage();

let scenariosToRun: ScenarioKey[];
if (arg === "all") {
  scenariosToRun = ["live-bets", "outrights", "rtl-mobile"];
} else if (arg in SCENARIO_REGISTRY) {
  scenariosToRun = [arg as ScenarioKey];
} else {
  usage();
}

const env = readAgentEnv();
const startedAt = new Date();
const reportDir = makeReportDir(PROJECT_ROOT, startedAt);

const logBuffer: string[] = [];
function log(line: string): void {
  // Console first (so the user sees progress live), trace.log second
  // (so the run is replayable). We buffer the file writes and flush
  // at the end to avoid sequencing every single write through the
  // event loop.
  console.info(line);
  logBuffer.push(line);
}

async function flushTrace(): Promise<void> {
  if (logBuffer.length === 0) return;
  for (const line of logBuffer) {
    await appendTrace(reportDir, line);
  }
  logBuffer.length = 0;
}

log(`[qa.boot] starting QA agent`);
log(`[qa.boot] target=${env.baseUrl}`);
log(`[qa.boot] scenarios=${scenariosToRun.join(",")}`);
log(`[qa.boot] reportDir=${reportDir}`);

const systemPrompt = await readFile(
  path.join(SCRIPT_DIR, "prompts", "system.md"),
  "utf8",
);

const browser = await chromium.launch();
log(`[qa.boot] browser launched (chromium)`);

const tools = await makeBrowserTools({
  browser,
  reportDir,
  baseUrl: env.baseUrl,
  startViewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
  locale: "he-IL",
  log,
});

const budget = makeBudget();
const scenarioResults: Array<{ outcome: RunOutcome; findings: Finding[] }> = [];

try {
  for (const key of scenariosToRun) {
    const scenario = SCENARIO_REGISTRY[key];
    log(`[qa.scenario] start ${scenario.name}`);
    const findingsBefore = tools.findings.length;

    const outcome = await runScenario({
      apiKey: env.anthropicApiKey,
      systemPrompt,
      userPrompt: scenario.userPrompt({
        baseUrl: env.baseUrl,
        qaBotEmail: env.qaBotEmail,
        qaBotPassword: env.qaBotPassword,
      }),
      scenarioName: scenario.name,
      tools,
      budget,
      log,
    });

    const scenarioFindings = tools.findings.slice(findingsBefore);
    scenarioResults.push({ outcome, findings: scenarioFindings });

    log(
      `[qa.scenario] end ${scenario.name} stopped=${outcome.stoppedReason} turns=${outcome.turns} findings=${scenarioFindings.length} $${outcome.usdSpent.toFixed(4)}`,
    );

    // Bail out of the loop if budget is already gone.
    if (outcome.stoppedReason === "budget_cap") {
      log(`[qa.run] budget cap hit, skipping remaining scenarios`);
      break;
    }
  }
} finally {
  await tools.context.close().catch(() => {});
  await browser.close().catch(() => {});
}

const finishedAt = new Date();
const { summary } = await writeReport({
  reportDir,
  baseUrl: env.baseUrl,
  scenarios: scenarioResults,
  startedAt,
  finishedAt,
});

await pruneOldReports(PROJECT_ROOT, log);
await flushTrace();

console.info("");
console.info(summary);

// Non-zero exit code if any critical findings — useful when this
// gets wired to CI later (out of scope for this iteration but
// future-friendly is free).
const totalCritical = scenarioResults.reduce(
  (n, s) => n + s.findings.filter((f) => f.severity === "critical").length,
  0,
);
process.exit(totalCritical > 0 ? 2 : 0);
