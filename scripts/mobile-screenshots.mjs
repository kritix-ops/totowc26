import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "C:/Projects/World cup/_screenshots";
const BASE = "http://localhost:3001/he";

const pages = [
  ["landing", ""],
  ["onboarding", "/onboarding"],
  ["dashboard", "/dashboard"],
  ["bets", "/bets"],
  ["match-bet", "/bets/m-bra-ger"],
  ["standings", "/standings"],
  ["bracket", "/bracket"],
  ["leaderboard", "/leaderboard"],
  ["match-detail", "/match/m-eng-ned"],
  ["profile", "/profile"],
  ["admin", "/admin"],
];

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["iPhone 14"],
  locale: "he-IL",
});
const page = await context.newPage();

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [name, p] of pages) {
  const url = `${BASE}${p}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const out = path.join(OUT_DIR, `pw-${name}.png`);
  await page.screenshot({ path: out, fullPage: false });

  // Report any horizontal overflow
  const overflow = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    const offenders = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 1) {
        offenders.push({
          tag: el.tagName,
          cls: (el.className || "").toString().slice(0, 80),
          right: Math.round(r.right),
          w: Math.round(r.width),
        });
      }
    });
    return {
      viewport: window.innerWidth,
      bodyScrollWidth: body.scrollWidth,
      htmlScrollWidth: html.scrollWidth,
      offenders: offenders.slice(0, 5),
    };
  });

  console.log(`${name}: vw=${overflow.viewport} body.sw=${overflow.bodyScrollWidth} html.sw=${overflow.htmlScrollWidth}`);
  if (overflow.offenders.length) {
    overflow.offenders.forEach((o) =>
      console.log(`  OVERFLOW <${o.tag}> right=${o.right} w=${o.w} cls="${o.cls}"`),
    );
  }
}

await browser.close();
console.log("done");
