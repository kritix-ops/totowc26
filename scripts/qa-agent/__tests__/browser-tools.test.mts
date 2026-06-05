// Integration test for browser-tools. Uses a real headless Chromium
// against an in-memory data: URL so we test our wrapper without
// needing a server. Chromium launch is ~500ms - acceptable for a
// single test file.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeBrowserTools } from "../browser-tools.mts";

const TEST_HTML = `<!DOCTYPE html>
<html lang="he" dir="rtl">
  <head><title>QA fixture</title></head>
  <body>
    <h1>שלום</h1>
    <button id="primary" aria-label="primary action">לחץ כאן</button>
    <a href="#about" aria-label="about">קישור לדף</a>
    <input type="text" placeholder="שם" />
    <div style="width: 2000px; height: 50px;">very wide row</div>
    <button style="width: 20px; height: 20px;">tiny</button>
  </body>
</html>`;

describe("browser-tools (integration)", () => {
  let browser: Browser;
  let tmp: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    tmp = await mkdtemp(path.join(tmpdir(), "qa-tools-"));
  });

  afterAll(async () => {
    await browser.close();
  });

  it("exposes the expected MCP-shaped tool surface", async () => {
    const tools = await makeBrowserTools({
      browser,
      reportDir: tmp,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      startViewport: { width: 360, height: 800 },
      locale: "he-IL",
      log: () => {},
    });
    const names = tools.schemas.map((s) => s.name).sort();
    expect(names).toEqual(
      [
        "browser_check_horizontal_overflow",
        "browser_check_tap_targets",
        "browser_click",
        "browser_navigate",
        "browser_resize",
        "browser_screenshot",
        "browser_select",
        "browser_snapshot",
        "browser_type",
        "browser_wait",
        "qa_record_finding",
      ].sort(),
    );
    await tools.context.close();
  });

  it("snapshot lists interactive elements with stable [ref=N] tokens", async () => {
    const tools = await makeBrowserTools({
      browser,
      reportDir: tmp,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      startViewport: { width: 360, height: 800 },
      locale: "he-IL",
      log: () => {},
    });
    await tools.page.setContent(TEST_HTML);
    const snap = await tools.run("browser_snapshot", {});
    expect(snap).toContain("primary action");
    expect(snap).toContain("about");
    expect(snap).toMatch(/\[ref=\d+\] h1 "שלום"/);
    await tools.context.close();
  });

  it("horizontal-overflow check reports the wide row at 360px", async () => {
    const tools = await makeBrowserTools({
      browser,
      reportDir: tmp,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      startViewport: { width: 360, height: 800 },
      locale: "he-IL",
      log: () => {},
    });
    await tools.page.setContent(TEST_HTML);
    const result = await tools.run("browser_check_horizontal_overflow", {});
    const parsed = JSON.parse(result);
    expect(parsed.viewportWidth).toBe(360);
    expect(parsed.offenders.length).toBeGreaterThan(0);
    await tools.context.close();
  });

  it("tap-target check flags the 20x20 button as too small", async () => {
    const tools = await makeBrowserTools({
      browser,
      reportDir: tmp,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      startViewport: { width: 360, height: 800 },
      locale: "he-IL",
      log: () => {},
    });
    await tools.page.setContent(TEST_HTML);
    const result = await tools.run("browser_check_tap_targets", {});
    const parsed = JSON.parse(result);
    expect(parsed.tooSmallCount).toBeGreaterThan(0);
    expect(parsed.offenders.some((o: { text: string }) => o.text === "tiny")).toBe(true);
    await tools.context.close();
  });

  it("qa_record_finding stores the finding and increments the counter", async () => {
    const tools = await makeBrowserTools({
      browser,
      reportDir: tmp,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      startViewport: { width: 360, height: 800 },
      locale: "he-IL",
      log: () => {},
    });
    const out = await tools.run("qa_record_finding", {
      severity: "high",
      area: "test area",
      expected: "x",
      actual: "y",
    });
    expect(out).toMatch(/recorded finding #1 \(high\)/);
    expect(tools.findings).toHaveLength(1);
    expect(tools.findings[0].severity).toBe("high");
    await tools.context.close();
  });

  it("refuses browser_navigate to an off-host URL", async () => {
    const tools = await makeBrowserTools({
      browser,
      reportDir: tmp,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      startViewport: { width: 360, height: 800 },
      locale: "he-IL",
      log: () => {},
    });
    const out = await tools.run("browser_navigate", { url: "https://example.com" });
    expect(out).toMatch(/^ERROR:/);
    await tools.context.close();
  });

  it("returns a stale-ref error when a ref no longer matches", async () => {
    const tools = await makeBrowserTools({
      browser,
      reportDir: tmp,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      startViewport: { width: 360, height: 800 },
      locale: "he-IL",
      log: () => {},
    });
    await tools.page.setContent(TEST_HTML);
    const out = await tools.run("browser_click", { ref: 9999 });
    expect(out).toMatch(/ERROR.*stale/);
    await tools.context.close();
  });

  it("resolves implicit labels for inputs wrapped in a <label>", async () => {
    // Mirrors the duels/new form: text input + textarea + select each
    // wrapped in their own <label> with the visible text inside. Before
    // the placeholder-defaults-to-"" fix the snapshot reported these as
    // "(no label)" because placeholder short-circuited the ?? chain.
    const tools = await makeBrowserTools({
      browser,
      reportDir: tmp,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      startViewport: { width: 360, height: 800 },
      locale: "he-IL",
      log: () => {},
    });
    await tools.page.setContent(`<!DOCTYPE html>
      <html lang="he" dir="rtl"><body>
        <label>השאלה (עברית)<input type="text" /></label>
        <label>כלל הכרעה<textarea></textarea></label>
        <label for="stake">השקעה</label>
        <input id="stake" type="number" />
      </body></html>`);
    const snap = await tools.run("browser_snapshot", {});
    expect(snap).toContain("השאלה (עברית)");
    expect(snap).toContain("כלל הכרעה");
    expect(snap).toContain("השקעה");
    await tools.context.close();
  });

  it("snapshot tails recent console errors emitted by the page", async () => {
    const tools = await makeBrowserTools({
      browser,
      reportDir: tmp,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      startViewport: { width: 360, height: 800 },
      locale: "he-IL",
      log: () => {},
    });
    await tools.page.setContent(TEST_HTML);
    // Take a baseline snapshot so the cursor advances past any boot
    // chatter, then emit a known error and take a second snapshot.
    await tools.run("browser_snapshot", {});
    await tools.page.evaluate(() => {
      console.error("[match-bet save http]", { status: 500, body: "<html>oops</html>" });
    });
    // Console events arrive on the next microtask; give them a beat.
    await new Promise((r) => setTimeout(r, 50));
    const snap = await tools.run("browser_snapshot", {});
    expect(snap).toContain("--- console (since last snapshot) ---");
    expect(snap).toContain("[error]");
    expect(snap).toContain("match-bet save http");
    await tools.context.close();
  });

  it("screenshot saves under reportDir/screenshots and returns the relative path", async () => {
    const tools = await makeBrowserTools({
      browser,
      reportDir: tmp,
      baseUrl: "https://toto-mundial-sandbox.vercel.app",
      startViewport: { width: 360, height: 800 },
      locale: "he-IL",
      log: () => {},
    });
    await tools.page.setContent(TEST_HTML);
    const out = await tools.run("browser_screenshot", { name: "fixture" });
    expect(out).toMatch(/^saved: screenshots\/\d{3}-fixture\.png/);
    const files = await readdir(path.join(tmp, "screenshots"));
    expect(files.some((f) => f.endsWith("-fixture.png"))).toBe(true);
    await tools.context.close();
  });
});
