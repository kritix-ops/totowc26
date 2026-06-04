// Build the markdown report for a single run and prune older runs
// per the retention policy (last KEEP_LAST_N_RUNS + every run that
// contains a critical finding, up to KEEP_CRITICAL_CAP).
//
// Timezone note: per the Jerusalem-timezone rule, every human-
// readable timestamp in the report renders in Asia/Jerusalem.
// Internal ordering uses ISO UTC; only the display strings shift.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  KEEP_LAST_N_RUNS,
  KEEP_CRITICAL_CAP,
} from "./config.mts";
import type { Finding } from "./browser-tools.mts";
import type { RunOutcome } from "./agent-loop.mts";

const IL_TZ = "Asia/Jerusalem";
const REPORTS_DIR = "_qa-reports";

export function makeReportDir(baseDir: string, now: Date): string {
  const parts = ilParts(now);
  const folder = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}`;
  return path.join(baseDir, REPORTS_DIR, folder);
}

export async function writeReport(opts: {
  reportDir: string;
  baseUrl: string;
  scenarios: Array<{ outcome: RunOutcome; findings: Finding[] }>;
  startedAt: Date;
  finishedAt: Date;
}): Promise<{ reportPath: string; summary: string }> {
  await mkdir(opts.reportDir, { recursive: true });

  const allFindings = opts.scenarios.flatMap((s) => s.findings);
  const counts = countBySeverity(allFindings);
  const verdict = counts.critical > 0 ? "❌ CRITICAL" : counts.high > 0 ? "⚠️ HIGH" : counts.medium + counts.low > 0 ? "▲ ISSUES" : "✅ CLEAN";

  const totalUsd = opts.scenarios.reduce((s, x) => s + x.outcome.usdSpent, 0);
  const totalIn = opts.scenarios.reduce((s, x) => s + x.outcome.inputTokens, 0);
  const totalOut = opts.scenarios.reduce((s, x) => s + x.outcome.outputTokens, 0);
  const totalMs = opts.scenarios.reduce((s, x) => s + x.outcome.durationMs, 0);

  const lines: string[] = [];
  lines.push(`# QA agent run — ${verdict}`);
  lines.push("");
  lines.push(`**Started:** ${fmt(opts.startedAt)} (Asia/Jerusalem)`);
  lines.push(`**Finished:** ${fmt(opts.finishedAt)}`);
  lines.push(`**Duration:** ${(totalMs / 1000).toFixed(1)}s`);
  lines.push(`**Target:** ${opts.baseUrl}`);
  lines.push("");
  lines.push("## Findings summary");
  lines.push("");
  lines.push(`- **Critical:** ${counts.critical}`);
  lines.push(`- **High:** ${counts.high}`);
  lines.push(`- **Medium:** ${counts.medium}`);
  lines.push(`- **Low:** ${counts.low}`);
  lines.push("");
  lines.push("## Token + cost");
  lines.push("");
  lines.push(`- **Input tokens:** ${totalIn.toLocaleString()}`);
  lines.push(`- **Output tokens:** ${totalOut.toLocaleString()}`);
  lines.push(`- **Spend:** $${totalUsd.toFixed(4)}`);
  lines.push("");

  for (const { outcome, findings } of opts.scenarios) {
    lines.push(`## Scenario: ${outcome.scenario}`);
    lines.push("");
    lines.push(`- **Turns:** ${outcome.turns}`);
    lines.push(`- **Stopped:** ${outcome.stoppedReason}${outcome.error ? ` (${outcome.error})` : ""}`);
    lines.push(`- **Duration:** ${(outcome.durationMs / 1000).toFixed(1)}s`);
    lines.push(`- **Spend:** $${outcome.usdSpent.toFixed(4)}`);
    lines.push("");

    if (findings.length === 0) {
      lines.push("_No findings recorded._");
      lines.push("");
    } else {
      for (const f of findings) {
        lines.push(`### [${f.severity.toUpperCase()}] ${f.area}`);
        lines.push("");
        lines.push(`- **Expected:** ${f.expected}`);
        lines.push(`- **Actual:** ${f.actual}`);
        lines.push(`- **Recorded:** ${fmt(new Date(f.recordedAt))}`);
        if (f.screenshotRef) {
          lines.push(`- **Screenshot:** \`${f.screenshotRef}\``);
          lines.push("");
          lines.push(`![${f.area}](${f.screenshotRef})`);
        }
        lines.push("");
      }
    }

    if (outcome.finalAssistantText) {
      lines.push("#### Final note from agent");
      lines.push("");
      lines.push("> " + outcome.finalAssistantText.split("\n").join("\n> "));
      lines.push("");
    }
  }

  const reportPath = path.join(opts.reportDir, "report.md");
  await writeFile(reportPath, lines.join("\n"), "utf8");

  const summary = `${verdict} — ${counts.critical}C/${counts.high}H/${counts.medium}M/${counts.low}L, $${totalUsd.toFixed(4)}, ${(totalMs / 1000).toFixed(1)}s. Report: ${reportPath}`;
  return { reportPath, summary };
}

export async function pruneOldReports(baseDir: string, log: (s: string) => void): Promise<void> {
  const dir = path.join(baseDir, REPORTS_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // nothing to prune
  }

  // Newest first - folder names sort lexicographically because they
  // are zero-padded ISO timestamps.
  const folders = entries.filter((e) => /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(e)).sort().reverse();

  if (folders.length <= KEEP_LAST_N_RUNS) {
    log(`[qa.retention] ${folders.length} runs on disk, under cap (${KEEP_LAST_N_RUNS}). nothing to prune.`);
    return;
  }

  const keepLast = new Set(folders.slice(0, KEEP_LAST_N_RUNS));
  const candidates = folders.slice(KEEP_LAST_N_RUNS);

  let criticalKept = 0;
  let pruned = 0;
  for (const f of candidates) {
    const reportPath = path.join(dir, f, "report.md");
    let hasCritical = false;
    try {
      const md = await readFile(reportPath, "utf8");
      hasCritical = /\[CRITICAL\]/.test(md) || /\*\*Critical:\*\*\s*[1-9]/.test(md);
    } catch {
      // Report file missing - treat as not-critical, fair game to prune.
    }
    if (hasCritical && criticalKept < KEEP_CRITICAL_CAP) {
      criticalKept += 1;
      continue;
    }
    if (keepLast.has(f)) continue;
    await rm(path.join(dir, f), { recursive: true, force: true });
    pruned += 1;
  }

  log(
    `[qa.retention] kept ${keepLast.size} recent + ${criticalKept} critical, pruned ${pruned}.`,
  );
}

function countBySeverity(findings: Finding[]) {
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const f of findings) {
    if (f.severity === "critical") critical += 1;
    else if (f.severity === "high") high += 1;
    else if (f.severity === "medium") medium += 1;
    else if (f.severity === "low") low += 1;
  }
  return { critical, high, medium, low };
}

function fmt(d: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: IL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

function ilParts(d: Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}
