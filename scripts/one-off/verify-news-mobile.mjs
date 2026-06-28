// One-off verifier: load /he as qa-bot at 360px, take a fullPage shot,
// and grep the page for the "חדשות אחרונות" placeholder string to confirm
// whether the QA agent's MEDIUM finding is real or a snapshot-bounds false
// positive. Not invoked by any cron / app code.

import { chromium } from "playwright";

const TARGET = "https://toto-mundial-sandbox.vercel.app";
const EMAIL = "qa-bot@kritix.io";
const PASSWORD = "QaBot-Mundial-2026-x9k2!";
const PLACEHOLDER = "כותרות יופיעו כאן ברגע שהמונדיאל יתחיל";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
const page = await ctx.newPage();

await page.goto(`${TARGET}/he/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15000 });
await page.waitForLoadState("networkidle");

await page.goto(`${TARGET}/he`, { waitUntil: "load" });
// Scroll to the bottom so every Suspense boundary mounts.
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
// Wait for streamed content to settle.
await page.waitForTimeout(8000);
// Scroll once more in case lazy content arrived.
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(2000);

await page.screenshot({ path: "_screenshots/verify-news-mobile-360.png", fullPage: true });

const bodyText = await page.evaluate(() => document.body.innerText);
const hasHeading = bodyText.includes("חדשות אחרונות");
const hasPlaceholder = bodyText.includes(PLACEHOLDER);
const hasViewAll = bodyText.includes("הצג הכל");

console.log(JSON.stringify({
  width: 360,
  hasHeading,
  hasPlaceholder,
  hasViewAll,
  placeholderSearched: PLACEHOLDER,
}, null, 2));

await browser.close();
