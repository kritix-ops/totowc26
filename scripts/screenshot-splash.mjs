// Ad-hoc verification of the SplashOverlay across mobile + tablet widths.
// Disables the fade in the URL hash so we can capture the overlay at peak
// opacity without racing window.load. Run with the dev server up at :3001.

import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "C:/Projects/World cup/_screenshots/splash";
const BASE = "http://localhost:3001";

const viewports = [
  { name: "360x800-android", w: 360, h: 800, device: null },
  { name: "iphone-14-pro", w: null, h: null, device: "iPhone 14 Pro" },
  { name: "iphone-15-pro-max", w: null, h: null, device: "iPhone 14 Pro Max" },
  { name: "768x1024-ipad", w: 768, h: 1024, device: null },
  { name: "1440x900-desktop", w: 1440, h: 900, device: null },
];

const locales = ["he", "en"];

const browser = await chromium.launch();
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

for (const v of viewports) {
  const ctx = v.device
    ? await browser.newContext({ ...devices[v.device], locale: "he-IL" })
    : await browser.newContext({
        viewport: { width: v.w, height: v.h },
        deviceScaleFactor: 2,
        isMobile: v.w <= 600,
        hasTouch: v.w <= 768,
        locale: "he-IL",
      });

  for (const locale of locales) {
    const page = await ctx.newPage();
    // Block window.load briefly so we can catch the overlay at full opacity.
    await page.route("**/*.{png,jpg,jpeg,webp,svg}", async (route) => {
      if (route.request().url().includes("/splash/overlay-")) {
        // Let the overlay image through immediately.
        await route.continue();
      } else {
        // Delay other assets to keep the overlay visible while we screenshot.
        await new Promise((r) => setTimeout(r, 500));
        await route.continue();
      }
    });

    const url = `${BASE}/${locale}`;
    console.log(`→ ${v.name} ${locale}: ${url}`);
    page.goto(url).catch(() => {});

    // Grab the overlay-visible state ASAP. networkidle would wait through
    // the route delay, so we just wait for the overlay DOM and snap.
    await page.waitForSelector('[role="presentation"][aria-hidden="true"]', {
      state: "attached",
      timeout: 5000,
    });
    await page.waitForTimeout(100);
    const visiblePath = path.join(OUT_DIR, `${v.name}-${locale}-overlay.png`);
    await page.screenshot({ path: visiblePath, fullPage: false });
    console.log(`  ✓ ${visiblePath}`);

    // Now let everything finish and grab the post-fade state.
    await page.unroute("**/*.{png,jpg,jpeg,webp,svg}");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1200);
    const restedPath = path.join(OUT_DIR, `${v.name}-${locale}-rested.png`);
    await page.screenshot({ path: restedPath, fullPage: false });
    console.log(`  ✓ ${restedPath}`);

    await page.close();
  }
  await ctx.close();
}

await browser.close();
console.log("Done.");
