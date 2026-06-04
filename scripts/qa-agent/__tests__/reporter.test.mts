import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { writeReport, pruneOldReports, makeReportDir } from "../reporter.mts";
import { KEEP_LAST_N_RUNS } from "../config.mts";
import type { Finding } from "../browser-tools.mts";
import type { RunOutcome } from "../agent-loop.mts";

const FIXED_NOW = new Date("2026-06-04T18:00:00Z"); // 21:00 in Asia/Jerusalem

function mkFinding(severity: Finding["severity"], area = "test area"): Finding {
  return {
    severity,
    area,
    expected: "expected text",
    actual: "actual text",
    recordedAt: FIXED_NOW.toISOString(),
  };
}

function mkOutcome(scenario: string, findings: Finding[]): { outcome: RunOutcome; findings: Finding[] } {
  return {
    outcome: {
      scenario,
      turns: 5,
      stoppedReason: "complete",
      usdSpent: 0.123,
      inputTokens: 1234,
      outputTokens: 567,
      durationMs: 4500,
      finalAssistantText: `wrap-up note for ${scenario}`,
    },
    findings,
  };
}

describe("makeReportDir", () => {
  it("formats the folder name as YYYY-MM-DD-HHmm in Asia/Jerusalem", () => {
    const dir = makeReportDir("/tmp/project", FIXED_NOW);
    // 2026-06-04 18:00 UTC = 2026-06-04 21:00 IDT.
    expect(dir.endsWith("_qa-reports" + path.sep + "2026-06-04-2100")).toBe(true);
  });
});

describe("writeReport", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "qa-reporter-"));
  });

  it("writes report.md with a CLEAN verdict when there are no findings", async () => {
    const reportDir = path.join(tmp, "run");
    const { reportPath, summary } = await writeReport({
      reportDir,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      scenarios: [mkOutcome("live-bets", [])],
      startedAt: FIXED_NOW,
      finishedAt: new Date(FIXED_NOW.getTime() + 30_000),
    });
    const md = await readFile(reportPath, "utf8");
    expect(md).toContain("✅ CLEAN");
    expect(md).toContain("**Critical:** 0");
    expect(md).toContain("No findings recorded");
    expect(summary).toMatch(/CLEAN/);
  });

  it("escalates verdict to CRITICAL when a critical finding is present", async () => {
    const reportDir = path.join(tmp, "run");
    const { reportPath } = await writeReport({
      reportDir,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      scenarios: [
        mkOutcome("live-bets", [mkFinding("critical", "login broken")]),
      ],
      startedAt: FIXED_NOW,
      finishedAt: FIXED_NOW,
    });
    const md = await readFile(reportPath, "utf8");
    expect(md).toContain("❌ CRITICAL");
    expect(md).toContain("[CRITICAL] login broken");
  });

  it("sums spend across multiple scenarios in the header", async () => {
    const reportDir = path.join(tmp, "run");
    const a = mkOutcome("live-bets", []);
    const b = mkOutcome("outrights", [mkFinding("medium")]);
    a.outcome.usdSpent = 0.10;
    b.outcome.usdSpent = 0.07;
    const { reportPath } = await writeReport({
      reportDir,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      scenarios: [a, b],
      startedAt: FIXED_NOW,
      finishedAt: FIXED_NOW,
    });
    const md = await readFile(reportPath, "utf8");
    expect(md).toContain("**Spend:** $0.1700");
  });

  it("embeds the screenshotRef as a markdown image when set", async () => {
    const reportDir = path.join(tmp, "run");
    const f = mkFinding("high", "overflow");
    f.screenshotRef = "screenshots/001-overflow.png";
    const { reportPath } = await writeReport({
      reportDir,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      scenarios: [mkOutcome("rtl-mobile", [f])],
      startedAt: FIXED_NOW,
      finishedAt: FIXED_NOW,
    });
    const md = await readFile(reportPath, "utf8");
    expect(md).toContain("![overflow](screenshots/001-overflow.png)");
  });
});

describe("pruneOldReports", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "qa-prune-"));
  });

  it("keeps all runs when count is at or below the cap", async () => {
    const base = path.join(tmp, "project");
    await mkdir(path.join(base, "_qa-reports"), { recursive: true });
    for (let i = 0; i < KEEP_LAST_N_RUNS; i += 1) {
      const folder = `2026-06-04-${String(i).padStart(4, "0")}`;
      const dir = path.join(base, "_qa-reports", folder);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "report.md"), "**Critical:** 0\n", "utf8");
    }
    const logs: string[] = [];
    await pruneOldReports(base, (s) => logs.push(s));
    expect(logs.some((l) => l.includes("nothing to prune"))).toBe(true);
  });

  it("prunes oldest non-critical runs but keeps the last N + critical runs", async () => {
    const base = path.join(tmp, "project");
    await mkdir(path.join(base, "_qa-reports"), { recursive: true });
    // Make KEEP_LAST_N_RUNS + 5 folders. The 3 oldest (which are
    // outside the keep-last window) get a "critical" report so they
    // should survive pruning. The other 2 oldest should be removed.
    const total = KEEP_LAST_N_RUNS + 5;
    for (let i = 0; i < total; i += 1) {
      const folder = `2026-06-04-${String(i).padStart(4, "0")}`;
      const dir = path.join(base, "_qa-reports", folder);
      await mkdir(dir, { recursive: true });
      // The 3 oldest folders get a critical marker.
      const md = i < 3 ? "**Critical:** 2\n[CRITICAL] x\n" : "**Critical:** 0\n";
      await writeFile(path.join(dir, "report.md"), md, "utf8");
    }
    const logs: string[] = [];
    await pruneOldReports(base, (s) => logs.push(s));
    const { readdir } = await import("node:fs/promises");
    const remaining = await readdir(path.join(base, "_qa-reports"));
    // Should keep: last KEEP_LAST_N_RUNS + 3 critical.
    expect(remaining.length).toBe(KEEP_LAST_N_RUNS + 3);
    expect(logs.some((l) => /pruned 2/.test(l))).toBe(true);
  });

  it("is a no-op when the reports directory does not exist", async () => {
    const base = path.join(tmp, "project");
    await expect(pruneOldReports(base, () => {})).resolves.toBeUndefined();
  });
});
