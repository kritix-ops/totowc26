// Playwright wrapped as Claude tools.
//
// The tool surface is intentionally a near-clone of Microsoft's
// @playwright/mcp so that a future migration to the real MCP server
// requires only an adapter. Tool names, the `ref` convention, and
// the YAML snapshot shape all match.
//
// Snapshot strategy: every action returns an accessibility-tree
// snapshot of the page so Claude has a fresh view without needing
// to call `browser_snapshot` between steps. Each visible interactive
// element gets a numeric `ref` that subsequent click/type calls use
// to address it. Refs are scoped to one snapshot and rotate every
// new snapshot - Claude is told this in the system prompt.

import type { Browser, BrowserContext, ElementHandle, Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type Finding = {
  severity: "critical" | "high" | "medium" | "low";
  area: string;
  expected: string;
  actual: string;
  screenshotRef?: string;
  recordedAt: string; // ISO timestamp (local clock - run-relative is fine)
};

export type ClaudeTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolRunner = {
  schemas: ClaudeTool[];
  run: (name: string, input: unknown) => Promise<string>;
  findings: Finding[];
  page: Page;
  context: BrowserContext;
};

type RefMap = Map<number, ElementHandle<HTMLElement | SVGElement>>;

type SnapshotNode = {
  ref: number;
  role: string;
  name?: string;
  level?: number;
  states?: string[];
  children: SnapshotNode[];
};

const SCREENSHOT_SUBDIR = "screenshots";

export async function makeBrowserTools(opts: {
  browser: Browser;
  reportDir: string;
  baseUrl: string;
  startViewport: { width: number; height: number };
  locale: string;
  log: (line: string) => void;
}): Promise<ToolRunner> {
  const context = await opts.browser.newContext({
    viewport: opts.startViewport,
    locale: opts.locale,
    // Sandbox is HTTPS with a real certificate, no need to ignore.
    ignoreHTTPSErrors: false,
  });
  const page = await context.newPage();
  const findings: Finding[] = [];
  let refs: RefMap = new Map();
  let refCounter = 0;
  let screenshotCounter = 0;

  // Rolling buffer of recent browser-side console events. Each
  // post-action snapshot tails this list and appends any new entries
  // since the previous snapshot so the agent sees client-side errors
  // (e.g. the [match-bet save http] log QuickPickRow emits when a
  // save fails) in the same turn as the failing action. Kept short
  // so a chatty page does not blow snapshot size out of proportion.
  type ConsoleEntry = { ts: number; type: string; text: string };
  const consoleLog: ConsoleEntry[] = [];
  let consoleCursor = 0;
  const MAX_CONSOLE_ENTRIES = 200;
  page.on("console", (msg) => {
    const text = msg.text().slice(0, 600);
    consoleLog.push({ ts: Date.now(), type: msg.type(), text });
    if (consoleLog.length > MAX_CONSOLE_ENTRIES) {
      const drop = consoleLog.length - MAX_CONSOLE_ENTRIES;
      consoleLog.splice(0, drop);
      consoleCursor = Math.max(0, consoleCursor - drop);
    }
  });
  page.on("pageerror", (err) => {
    consoleLog.push({
      ts: Date.now(),
      type: "pageerror",
      text: `${err.name}: ${err.message}`.slice(0, 600),
    });
  });

  await mkdir(path.join(opts.reportDir, SCREENSHOT_SUBDIR), { recursive: true });

  async function nextRef(handle: ElementHandle<HTMLElement | SVGElement>): Promise<number> {
    refCounter += 1;
    refs.set(refCounter, handle);
    return refCounter;
  }

  function resolveRef(ref: number): ElementHandle<HTMLElement | SVGElement> {
    const h = refs.get(ref);
    if (!h) {
      throw new Error(
        `ref ${ref} is stale - take a fresh snapshot and use a ref from it`,
      );
    }
    return h;
  }

  async function snapshot(): Promise<string> {
    // Drop old refs - every snapshot mints fresh ones.
    refs = new Map();
    refCounter = 0;

    const handles = await page.$$(
      [
        "a[href]",
        "button",
        "input:not([type=hidden])",
        "select",
        "textarea",
        "[role=button]",
        "[role=link]",
        "[role=tab]",
        "[role=menuitem]",
        "[role=checkbox]",
        "[role=radio]",
        "[role=combobox]",
        "[role=switch]",
        "h1",
        "h2",
        "h3",
        "[aria-label]",
        "[data-testid]",
      ].join(", "),
    );

    const tree: SnapshotNode[] = [];
    for (const h of handles) {
      const isVisible = await h.isVisible().catch(() => false);
      if (!isVisible) continue;
      const node = await h.evaluate((el) => {
        const e = el as HTMLElement;
        // Map common input types to their implicit ARIA roles so the
        // snapshot reads like a real a11y tree. The mapping is inlined
        // as an anonymous IIFE rather than a named const arrow because
        // tsx/esbuild's keepNames wraps every NAMED callable (function
        // OR arrow) with __name() for stack traces, and __name does
        // not exist inside the browser context page.evaluate ships
        // into - which throws "ReferenceError: __name is not defined"
        // on every snapshot. The 2026-06-05 fix-commit covered the
        // overflow + tap-target evaluates; this one regressed in a
        // later commit and is now inlined to match.
        const role =
          e.getAttribute("role") ??
          (e.tagName === "A"
            ? "link"
            : e.tagName === "BUTTON"
              ? "button"
              : e.tagName === "INPUT"
                ? ((t: string): string => {
                    switch (t) {
                      case "text":
                      case "search":
                      case "tel":
                      case "url":
                      case "email":
                      case "password":
                        return "textbox";
                      case "number":
                        return "spinbutton";
                      case "checkbox":
                        return "checkbox";
                      case "radio":
                        return "radio";
                      case "range":
                        return "slider";
                      case "submit":
                      case "button":
                      case "reset":
                        return "button";
                      default:
                        return t || "input";
                    }
                  })((e as HTMLInputElement).type ?? "")
                : e.tagName === "SELECT"
                  ? "combobox"
                  : e.tagName === "TEXTAREA"
                    ? "textbox"
                    : e.tagName.toLowerCase());
        // Normalise empties to null so the `??` precedence chain below
        // works correctly. The 2026-06-05 QA run kept flagging duels/new
        // inputs as "(no label)" even though the resolver fired - root
        // cause was placeholder defaulting to "" (string, not null),
        // which short-circuits ?? before implicitLabel ever wins.
        const ariaLabel = e.getAttribute("aria-label") || null;
        const title = e.getAttribute("title") || null;
        const placeholderRaw = (e as HTMLInputElement).placeholder;
        const placeholder = placeholderRaw && placeholderRaw.length > 0 ? placeholderRaw : null;
        const innerRaw = (e.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
        const inner = innerRaw.length > 0 ? innerRaw : null;
        // Implicit label resolution. An input wrapped in a <label> tag
        // (or referenced by `for=`/`htmlFor=`) IS labelled for screen
        // readers, even though the input itself has no aria-label or
        // title or inner text. The QA agent used to file false-positive
        // "input missing label" findings because the snapshot only
        // looked at the input's own attributes. We now walk the parent
        // chain looking for a wrapping <label>, and check for an
        // associated label-by-id if the input has an id.
        let implicitLabel: string | null = null;
        if (
          (e.tagName === "INPUT" ||
            e.tagName === "TEXTAREA" ||
            e.tagName === "SELECT") &&
          !ariaLabel &&
          !title &&
          !placeholder
        ) {
          // Walk up looking for a wrapping <label> element.
          let cur: HTMLElement | null = e.parentElement;
          while (cur && cur.tagName !== "BODY") {
            if (cur.tagName === "LABEL") {
              implicitLabel = (cur.innerText ?? "")
                .trim()
                .replace(/\s+/g, " ")
                .slice(0, 120);
              break;
            }
            cur = cur.parentElement;
          }
          // <label for="id"> style if no wrapping <label> found.
          if (!implicitLabel && e.id) {
            const lbl = document.querySelector(`label[for="${CSS.escape(e.id)}"]`);
            if (lbl) {
              implicitLabel = ((lbl as HTMLElement).innerText ?? "")
                .trim()
                .replace(/\s+/g, " ")
                .slice(0, 120);
            }
          }
        }
        // Headline label preference: aria-label > title > placeholder >
        // implicit <label> > inner text. When aria-label is set but
        // inner text differs, we append the inner text as a secondary
        // signal so the agent can see state changes inside an aria-
        // labelled button (e.g. a Save button whose visible label
        // flips Save → Saving... → Saved while its aria-label stays
        // constant).
        let name = ariaLabel ?? title ?? placeholder ?? implicitLabel ?? inner ?? "";
        if (ariaLabel && inner && inner !== ariaLabel) {
          name = `${ariaLabel} (text: "${inner}")`;
        }
        // Selected/pressed state markers. Without these the agent
        // cannot tell a highlighted 1X2 pill apart from an inactive
        // one in the accessibility tree - the visual highlight lives
        // in CSS but aria-pressed/selected/current/checked carry the
        // semantic state. Append a compact suffix the agent can grep.
        const pressed = e.getAttribute("aria-pressed");
        const selected = e.getAttribute("aria-selected");
        const current = e.getAttribute("aria-current");
        const checked = e.getAttribute("aria-checked");
        const states: string[] = [];
        if (pressed === "true") states.push("pressed");
        if (selected === "true") states.push("selected");
        if (current && current !== "false") states.push(`current=${current}`);
        if (checked === "true") states.push("checked");
        if (e.hasAttribute("disabled") || e.getAttribute("aria-disabled") === "true") {
          states.push("disabled");
        }
        const level = e.tagName.startsWith("H")
          ? Number(e.tagName.slice(1))
          : undefined;
        const testid = e.getAttribute("data-testid") ?? undefined;
        return { role, name, level, testid, states };
      });
      const ref = await nextRef(h as ElementHandle<HTMLElement | SVGElement>);
      tree.push({
        ref,
        role: node.role,
        name: node.name || (node.testid ? `[testid=${node.testid}]` : undefined),
        level: node.level,
        states: node.states.length > 0 ? node.states : undefined,
        children: [],
      });
    }

    // Visible non-interactive text. Catches kickoff times, prices,
    // counters, status chips - anything the page shows but does not
    // wrap in a button or labelled element. We limit by length and
    // count so a paragraph-heavy article does not dominate the
    // snapshot. Excludes elements that already contain an interactive
    // descendant we listed above.
    //
    // Bounds: window.innerHeight + 8000 captures the full landing
    // dashboard on a 360x800 viewport. The 2000px window we shipped
    // in the original implementation cut off the news section, the
    // prize strip, and the install hint - the agent then filed
    // false-MEDIUM findings about "missing placeholder on mobile" for
    // sections that DID render, just below its snapshot horizon
    // (verified end-to-end by scripts/one-off/verify-news-mobile.mjs
    // on 2026-06-06: hasPlaceholder=true at 360px). Cap raised from
    // 80 to 120 in the same pass so the longer scan does not get
    // truncated mid-page.
    const textBlocks = await page.evaluate(() => {
      const out: string[] = [];
      const seen = new Set<string>();
      const candidates = document.querySelectorAll(
        "p, span, time, dd, dt, li, td, div",
      );
      for (const el of candidates) {
        if (el.querySelector("a, button, input, select, textarea")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.bottom < 0 || r.top > window.innerHeight + 8000) continue;
        const text = (el as HTMLElement).innerText
          ?.trim()
          .replace(/\s+/g, " ")
          .slice(0, 160);
        if (!text || text.length < 2 || text.length > 160) continue;
        if (seen.has(text)) continue;
        seen.add(text);
        out.push(text);
        if (out.length >= 120) break;
      }
      return out;
    });

    // Last-resort raw text dump of the <main> region. When the
    // structural scan above finds very few elements, the agent has
    // been writing "page is blank" findings on pages that actually
    // contain text the user can clearly read in a screenshot. This
    // section is the safety net: a plain text projection of the
    // page's main content so the agent can see what the user sees.
    const mainText = await page.evaluate(() => {
      const main =
        document.querySelector("main") ??
        document.querySelector("[role=main]") ??
        document.querySelector("section");
      if (!main) return "";
      const raw = (main as HTMLElement).innerText ?? "";
      // 8000 chars covers the full signed-in dashboard plus the news
      // archive page. The original 3500 cap truncated long pages
      // before the bottom sections appeared in the raw text safety
      // net, contributing to the same down-page-blindness that the
      // textBlocks bounds bump above addresses.
      return raw.trim().replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").slice(0, 8000);
    });

    const url = page.url();
    const title = await page.title().catch(() => "");
    const lines: string[] = [];
    lines.push(`url: ${url}`);
    lines.push(`title: ${title || "(none)"}`);
    lines.push(`viewport: ${page.viewportSize()?.width}x${page.viewportSize()?.height}`);
    lines.push(
      `elements: ${tree.length} interactive/structural, ${textBlocks.length} text blocks, main_text_len=${mainText.length}`,
    );
    lines.push("--- interactive ---");
    for (const node of tree) {
      const heading = node.level ? `h${node.level}` : node.role;
      const label = node.name ? `"${node.name.replace(/"/g, "'").slice(0, 140)}"` : "(no label)";
      const statesSuffix = node.states && node.states.length > 0 ? ` [${node.states.join(",")}]` : "";
      lines.push(`[ref=${node.ref}] ${heading} ${label}${statesSuffix}`);
    }
    if (textBlocks.length > 0) {
      lines.push("--- text content ---");
      for (const t of textBlocks) lines.push(`• ${t.replace(/"/g, "'")}`);
    }
    // Always surface the raw main text. It is short and disambiguates
    // "page is blank" claims faster than another navigate-and-snapshot
    // round. Skipped only if the structural+text sections already
    // covered the same text (heuristic: structural rich + text blocks
    // present means the page rendered fine, raw dump is redundant).
    const richEnough = tree.length >= 5 && textBlocks.length >= 3;
    if (mainText && !richEnough) {
      lines.push("--- main raw text (truncated to 3500 chars) ---");
      lines.push(mainText);
    }
    // Tail of new console entries since the previous snapshot. We
    // surface only error/warning/pageerror because every page logs
    // chatty debug info during normal navigation and including all
    // of it would drown out the signal.
    const newEntries = consoleLog.slice(consoleCursor);
    consoleCursor = consoleLog.length;
    const interesting = newEntries.filter(
      (e) => e.type === "error" || e.type === "warning" || e.type === "pageerror",
    );
    if (interesting.length > 0) {
      lines.push("--- console (since last snapshot) ---");
      for (const e of interesting) {
        lines.push(`[${e.type}] ${e.text}`);
      }
    }
    return lines.join("\n");
  }

  async function snapshotOrError<T>(thunk: () => Promise<T>): Promise<string> {
    try {
      await thunk();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `ERROR: ${msg}\n---\n` + (await snapshot());
    }
    // Wait for the page to actually finish rendering, not just for the
    // initial DOM. Next.js streams data behind <Suspense fallback={null}>
    // boundaries; if we snapshotted on domcontentloaded the agent saw
    // the empty shell and reported "blank page" while a real user (who
    // waits a beat longer) saw the streamed content. Sequence:
    //
    //   1. window.load - all initial resources loaded
    //   2. networkidle - no requests for 500ms (= streaming done)
    //   3. 400ms cushion for React hydration to settle aria-busy etc.
    //
    // All three have generous timeouts because some pages legitimately
    // keep low-traffic activity going (push notification heartbeat,
    // analytics). networkidle is the most important - it is what
    // distinguishes "shell loaded" from "content rendered".
    await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    return snapshot();
  }

  const schemas: ClaudeTool[] = [
    {
      name: "browser_navigate",
      description:
        "Navigate the page to a URL. Returns a fresh accessibility snapshot. " +
        "URL must be on the sandbox host.",
      input_schema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
    {
      name: "browser_snapshot",
      description:
        "Take a fresh accessibility snapshot of the current page. Use this " +
        "if you suspect refs from your last snapshot are stale.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "browser_click",
      description: "Click an interactive element by its ref from the most recent snapshot.",
      input_schema: {
        type: "object",
        properties: { ref: { type: "number" } },
        required: ["ref"],
      },
    },
    {
      name: "browser_type",
      description:
        "Type text into a form field by ref. Set submit=true to press Enter after typing.",
      input_schema: {
        type: "object",
        properties: {
          ref: { type: "number" },
          text: { type: "string" },
          submit: { type: "boolean" },
        },
        required: ["ref", "text"],
      },
    },
    {
      name: "browser_select",
      description: "Select one or more options in a <select> by ref. Values are the option values.",
      input_schema: {
        type: "object",
        properties: {
          ref: { type: "number" },
          values: { type: "array", items: { type: "string" } },
        },
        required: ["ref", "values"],
      },
    },
    {
      name: "browser_wait",
      description:
        "Wait for something. for='ms' waits N milliseconds (max 5000). for='network' waits for network idle (max 10s).",
      input_schema: {
        type: "object",
        properties: {
          for: { type: "string", enum: ["ms", "network"] },
          value: { type: "number" },
        },
        required: ["for"],
      },
    },
    {
      name: "browser_resize",
      description:
        "Resize the viewport. Use for responsive checks at 360/414/768/1024/1440.",
      input_schema: {
        type: "object",
        properties: {
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["width", "height"],
      },
    },
    {
      name: "browser_screenshot",
      description:
        "Save a screenshot of the current viewport. Returns the relative path " +
        "you should reference in qa_record_finding.screenshotRef.",
      input_schema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
    {
      name: "browser_check_horizontal_overflow",
      description:
        "Inspect the page DOM for elements whose right edge exceeds the viewport - " +
        "the classic mobile horizontal-scroll bug. Returns a JSON list of offenders.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "browser_check_tap_targets",
      description:
        "Check all buttons/links/[role=button] for >= 44x44px bounding box at the " +
        "current viewport. Returns a JSON list of elements that fail.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "qa_record_finding",
      description:
        "Record a QA finding. Use severity='critical' for login/payment/data-loss, " +
        "'high' for flow-blocking bugs, 'medium' for UX papercuts, 'low' for cosmetic.",
      input_schema: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
          area: { type: "string" },
          expected: { type: "string" },
          actual: { type: "string" },
          screenshotRef: { type: "string" },
        },
        required: ["severity", "area", "expected", "actual"],
      },
    },
  ];

  async function run(name: string, rawInput: unknown): Promise<string> {
    const input = (rawInput ?? {}) as Record<string, unknown>;
    const start = Date.now();
    opts.log(`[qa.tool] ${name} input=${shortJson(input)}`);
    try {
      const result = await dispatch(name, input);
      opts.log(`[qa.tool] ${name} ok ${Date.now() - start}ms`);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      opts.log(`[qa.tool] ${name} fail ${Date.now() - start}ms err=${msg}`);
      return `ERROR: ${msg}`;
    }
  }

  async function dispatch(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "browser_navigate": {
        const url = String(input.url ?? "");
        if (!url.startsWith(opts.baseUrl) && !url.startsWith("/")) {
          throw new Error(
            `navigate to ${url} refused - URL must start with ${opts.baseUrl} or be a path beginning with /`,
          );
        }
        const fullUrl = url.startsWith("/") ? `${opts.baseUrl}${url}` : url;
        return snapshotOrError(() => page.goto(fullUrl, { waitUntil: "domcontentloaded" }));
      }
      case "browser_snapshot":
        return snapshot();
      case "browser_click": {
        const ref = Number(input.ref);
        return snapshotOrError(() => resolveRef(ref).click({ timeout: 5000 }));
      }
      case "browser_type": {
        const ref = Number(input.ref);
        const text = String(input.text ?? "");
        const submit = Boolean(input.submit);
        return snapshotOrError(async () => {
          const h = resolveRef(ref);
          await h.fill(text, { timeout: 5000 });
          if (submit) await h.press("Enter");
        });
      }
      case "browser_select": {
        const ref = Number(input.ref);
        const values = Array.isArray(input.values) ? (input.values as string[]) : [];
        return snapshotOrError(() =>
          (resolveRef(ref) as ElementHandle<HTMLSelectElement>).selectOption(values),
        );
      }
      case "browser_wait": {
        const mode = String(input.for ?? "ms");
        const value = Number(input.value ?? 1000);
        return snapshotOrError(async () => {
          if (mode === "network") {
            await page.waitForLoadState("networkidle", { timeout: Math.min(value || 5000, 10_000) });
          } else {
            await page.waitForTimeout(Math.min(value, 5000));
          }
        });
      }
      case "browser_resize": {
        const width = Number(input.width);
        const height = Number(input.height);
        if (!width || !height) throw new Error("width and height required");
        return snapshotOrError(() => page.setViewportSize({ width, height }));
      }
      case "browser_screenshot": {
        screenshotCounter += 1;
        const safeName = String(input.name ?? `shot-${screenshotCounter}`).replace(
          /[^a-z0-9._-]/gi,
          "_",
        );
        const filename = `${String(screenshotCounter).padStart(3, "0")}-${safeName}.png`;
        const fullPath = path.join(opts.reportDir, SCREENSHOT_SUBDIR, filename);
        await page.screenshot({ path: fullPath, fullPage: false });
        const relPath = `${SCREENSHOT_SUBDIR}/${filename}`;
        opts.log(`[qa.tool] screenshot saved ${relPath}`);
        return `saved: ${relPath}`;
      }
      case "browser_check_horizontal_overflow": {
        const result = await page.evaluate(() => {
          // Direction-agnostic: in RTL an overflowing element extends
          // PAST THE LEFT edge (negative left), not past the right.
          // We check both edges so the same probe works on /he (RTL)
          // and a future LTR locale.
          //
          // We skip elements whose nearest scrollable ancestor is NOT
          // the page itself. A tab strip with `overflow-x-auto` is
          // intentionally scrollable; its off-screen children are a
          // legit pattern.
          //
          // The scrollable-ancestor walk is inlined inside the loop
          // rather than extracted as a helper because tsx/esbuild
          // wraps any named function or named arrow with __name() at
          // transpile time for stack traces, and the browser context
          // page.evaluate ships into does not have __name in scope -
          // which kept failing every previous attempt at a helper.
          const offenders: Array<{
            tag: string;
            cls: string;
            left: number;
            right: number;
            width: number;
            side: "left" | "right";
          }> = [];
          document.querySelectorAll("*").forEach((el) => {
            const r = el.getBoundingClientRect();
            const overflowsRight = r.right > window.innerWidth + 1;
            const overflowsLeft = r.left < -1;
            if (!overflowsRight && !overflowsLeft) return;
            // Inlined: walk up until we hit body/html, skip if any
            // intermediate ancestor is a real horizontal scroll container.
            let cur: Element | null = el.parentElement;
            let insideScrollable = false;
            while (
              cur &&
              cur !== document.documentElement &&
              cur !== document.body
            ) {
              const overflowX = getComputedStyle(cur).overflowX;
              if (
                (overflowX === "auto" || overflowX === "scroll") &&
                cur.scrollWidth > cur.clientWidth + 1
              ) {
                insideScrollable = true;
                break;
              }
              cur = cur.parentElement;
            }
            if (insideScrollable) return;
            offenders.push({
              tag: el.tagName,
              cls: (el.className || "").toString().slice(0, 80),
              left: Math.round(r.left),
              right: Math.round(r.right),
              width: Math.round(r.width),
              side: overflowsRight ? "right" : "left",
            });
          });
          return {
            viewportWidth: window.innerWidth,
            bodyScrollWidth: document.body.scrollWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            dir: document.documentElement.getAttribute("dir") ?? "ltr",
            offenders: offenders.slice(0, 10),
          };
        });
        return JSON.stringify(result, null, 2);
      }
      case "browser_check_tap_targets": {
        const result = await page.evaluate(() => {
          // WCAG 2.5.5 / 2.5.8 carve out an exception for inline text
          // links: a link sitting inside a sentence is not held to the
          // 44x44 minimum because shrinking it would break the text
          // flow. The exception walk is inlined inside the loop (no
          // helper function) because tsx/esbuild's __name decoration
          // breaks page.evaluate as documented in the overflow check
          // above.
          const tooSmall: Array<{ tag: string; cls: string; w: number; h: number; text: string }> = [];
          document
            .querySelectorAll("a, button, [role=button], input[type=button], input[type=submit]")
            .forEach((el) => {
              const r = el.getBoundingClientRect();
              const visible = r.width > 0 && r.height > 0;
              if (!visible) return;
              // Inlined inline-link exception: <a> nested under <p>/<li>
              // and shorter than 44px - the standard WCAG threshold - is
              // intentionally an inline text link, exempt from the tap-
              // target rule. Threshold was 32px, raised to 44px because
              // hint paragraphs in this app use ~38px line height (still
              // textual, not button-y) and were getting flagged.
              if (el.tagName === "A" && r.height < 44) {
                let cur: Element | null = el.parentElement;
                let isInline = false;
                while (cur) {
                  if (cur.tagName === "P" || cur.tagName === "LI") {
                    isInline = true;
                    break;
                  }
                  if (cur.tagName === "BODY") break;
                  cur = cur.parentElement;
                }
                if (isInline) return;
              }
              if (r.width < 44 || r.height < 44) {
                tooSmall.push({
                  tag: el.tagName,
                  cls: (el.className || "").toString().slice(0, 60),
                  w: Math.round(r.width),
                  h: Math.round(r.height),
                  text: (el.textContent || "").trim().slice(0, 40),
                });
              }
            });
          return {
            viewportWidth: window.innerWidth,
            tooSmallCount: tooSmall.length,
            offenders: tooSmall.slice(0, 15),
          };
        });
        return JSON.stringify(result, null, 2);
      }
      case "qa_record_finding": {
        const finding: Finding = {
          severity: input.severity as Finding["severity"],
          area: String(input.area ?? ""),
          expected: String(input.expected ?? ""),
          actual: String(input.actual ?? ""),
          screenshotRef: input.screenshotRef ? String(input.screenshotRef) : undefined,
          recordedAt: new Date().toISOString(),
        };
        findings.push(finding);
        opts.log(
          `[qa.finding] sev=${finding.severity} area="${finding.area}" expected="${finding.expected.slice(0, 80)}" actual="${finding.actual.slice(0, 80)}"`,
        );
        return `recorded finding #${findings.length} (${finding.severity})`;
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  }

  return { schemas, run, findings, page, context };
}

function shortJson(o: unknown): string {
  try {
    const s = JSON.stringify(o);
    return s.length > 200 ? s.slice(0, 197) + "..." : s;
  } catch {
    return "[unserializable]";
  }
}

// Re-export for the reporter so trace.log writing has a typed sink.
export async function appendTrace(reportDir: string, line: string): Promise<void> {
  const file = path.join(reportDir, "trace.log");
  await writeFile(file, line + "\n", { flag: "a" });
}
