#!/usr/bin/env node
// Generate iOS apple-touch-startup-image splash screens, one per device
// resolution, per locale.
//
// Sources (portrait 9:16 posters with the brand strip baked in):
//   public/brand/splash-source-he.png
//   public/brand/splash-source-en.png   (optional — skipped if missing)
//
// Outputs:
//   public/splash/{locale}/{w}x{h}.png  — exact device pixel resolution
//   public/splash/overlay-{locale}.png  — small (720x1280) portrait used by
//                                          the in-app Android overlay
//   src/lib/apple-splash-screens.ts     — typed array consumed by the
//                                          root layout's appleWebApp.startupImage
//
// The iOS splash spec requires images that EXACTLY match a device's pixel
// resolution, paired with a media query that matches the device's CSS
// dimensions + devicePixelRatio + orientation. Anything off-pixel is ignored
// and iOS falls back to a plain white screen (worse than no startup image).
//
// Source posters are 1080x1920 (9:16). iPhones are taller (~9:19.5), iPads
// are more square (~3:4). We fit the source into each device frame with
// `contain` + cream background so the full poster — including the brand
// strip at the bottom — stays visible. The cream padding matches the
// poster's own paper background, so the letterbox reads as part of the
// artwork, not as a layout bug.

import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CREAM = { r: 0xfb, g: 0xf6, b: 0xeb, alpha: 1 };

// Locales the app supports. A locale is generated only if its source file
// exists; otherwise we warn and continue, so this script is safe to run
// while one of the source posters is still pending from design.
const LOCALES = ["he", "en"];

// Device list ordered roughly from newest (most likely to match) to oldest.
// `w`/`h` are the *physical* pixel dimensions of the output PNG. `cssW`/
// `cssH` are the CSS-pixel dimensions used in the media query. `dpr` is
// the devicePixelRatio. Each entry produces one PNG per locale + one
// link tag entry in the generated TS module.
const DEVICES = [
  // ── iPhone (portrait) ─────────────────────────────────────────────────
  { w: 1290, h: 2796, cssW: 430, cssH: 932, dpr: 3, name: "iPhone 15 Pro Max, 14 Pro Max" },
  { w: 1179, h: 2556, cssW: 393, cssH: 852, dpr: 3, name: "iPhone 15 Pro, 15, 14 Pro, 14" },
  { w: 1284, h: 2778, cssW: 428, cssH: 926, dpr: 3, name: "iPhone 14 Plus, 13 Pro Max, 12 Pro Max" },
  { w: 1170, h: 2532, cssW: 390, cssH: 844, dpr: 3, name: "iPhone 14, 13 Pro, 13, 12 Pro, 12" },
  { w: 1125, h: 2436, cssW: 375, cssH: 812, dpr: 3, name: "iPhone 13 mini, 12 mini, 11 Pro, X, XS" },
  { w: 1242, h: 2688, cssW: 414, cssH: 896, dpr: 3, name: "iPhone 11 Pro Max, XS Max" },
  { w: 828, h: 1792, cssW: 414, cssH: 896, dpr: 2, name: "iPhone 11, XR" },
  { w: 1242, h: 2208, cssW: 414, cssH: 736, dpr: 3, name: "iPhone 8 Plus, 7 Plus, 6s Plus" },
  { w: 750, h: 1334, cssW: 375, cssH: 667, dpr: 2, name: "iPhone SE (2nd/3rd gen), 8, 7, 6s" },
  // ── iPad (portrait) ───────────────────────────────────────────────────
  { w: 2048, h: 2732, cssW: 1024, cssH: 1366, dpr: 2, name: "iPad Pro 12.9\"" },
  { w: 1668, h: 2388, cssW: 834, cssH: 1194, dpr: 2, name: "iPad Pro 11\"" },
  { w: 1640, h: 2360, cssW: 820, cssH: 1180, dpr: 2, name: "iPad Air 10.9\"" },
  { w: 1620, h: 2160, cssW: 810, cssH: 1080, dpr: 2, name: "iPad 10.2\"" },
  { w: 1488, h: 2266, cssW: 744, cssH: 1133, dpr: 2, name: "iPad Mini (6th gen)" },
  { w: 1536, h: 2048, cssW: 768, cssH: 1024, dpr: 2, name: "iPad 9.7\", Mini (5th gen)" },
];

function mediaQuery({ cssW, cssH, dpr }) {
  return (
    `(device-width: ${cssW}px) and (device-height: ${cssH}px)` +
    ` and (-webkit-device-pixel-ratio: ${dpr})` +
    ` and (orientation: portrait)`
  );
}

async function ensureDir(dir) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

// Fit the source poster into a device-sized cream canvas. `contain` keeps
// the full poster (including the brand strip) visible; the cream background
// fills whatever the source can't cover.
//
// The source is a print-textured stamp (lots of warm-tone noise), which
// PNG compresses terribly — a full-RGB PNG at iPad Pro resolution lands
// around 8 MB. `palette: true` quantises to an 8-bit indexed PNG; together
// with Sharp's near-lossless quality flag this keeps the warm-paper look
// intact while shrinking each splash to ~10-15% of its full-RGB size, so
// the per-device PNGs stay under a megabyte each.
async function buildSplash(source, device, outPath) {
  await sharp(source)
    .resize(device.w, device.h, { fit: "contain", background: CREAM })
    .png({
      compressionLevel: 9,
      palette: true,
      quality: 90,
      effort: 10,
    })
    .toFile(outPath);
}

// Emit the TS module the root layout imports. Keeping this co-located with
// the script keeps the device list as a single source of truth — adding a
// new iPhone here regenerates both the PNGs and the link-tag metadata in
// one pass.
function renderTsModule() {
  const entries = DEVICES.flatMap((d) =>
    LOCALES.map((locale) => ({
      url: `/splash/${locale}/${d.w}x${d.h}.png`,
      media: mediaQuery(d),
      locale,
    })),
  );

  const byLocale = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      entries
        .filter((e) => e.locale === locale)
        .map((e) => ({ url: e.url, media: e.media })),
    ]),
  );

  return `// AUTO-GENERATED by scripts/build-splashes.mjs — do not edit by hand.
// Re-run \`pnpm splashes:build\` (or \`node scripts/build-splashes.mjs\`)
// after changing the source posters in public/brand/ or the device list in
// the script. Imported by src/app/[lang]/layout.tsx to populate
// metadata.appleWebApp.startupImage and to pick the in-app overlay image.

export type AppleSplashEntry = { url: string; media: string };
export type SplashLocale = "he" | "en";

export const APPLE_SPLASH_SCREENS: Record<SplashLocale, AppleSplashEntry[]> = ${JSON.stringify(byLocale, null, 2)};

// Locales whose source poster was present at build time. Consumers should
// fall back to Hebrew when a user's locale isn't in this list, since the
// app is Hebrew-first and a Hebrew poster is better UX than a blank cream
// rectangle.
export const SPLASH_LOCALES_AVAILABLE: SplashLocale[] = ${JSON.stringify(
    LOCALES.filter((l) => existsSync(path.join(ROOT, `public/brand/splash-source-${l}.png`))),
  )};
`;
}

async function main() {
  const builtLocales = [];

  for (const locale of LOCALES) {
    const source = path.join(ROOT, `public/brand/splash-source-${locale}.png`);
    if (!existsSync(source)) {
      console.warn(`⚠ skipping ${locale}: source not found at ${path.relative(ROOT, source)}`);
      continue;
    }
    const outDir = path.join(ROOT, `public/splash/${locale}`);
    await ensureDir(outDir);

    for (const device of DEVICES) {
      const outPath = path.join(outDir, `${device.w}x${device.h}.png`);
      await buildSplash(source, device, outPath);
      console.log(`✓ ${path.relative(ROOT, outPath)} (${device.name})`);
    }

    // Optimised portrait splash for the in-app Android overlay. Sized to
    // cover modern phone resolutions (1080w devices @ DPR 2 land here) but
    // small enough on disk that the overlay paints alongside the first HTML
    // chunk without holding up the route. Re-resized from the full source
    // rather than copied so the compression stays consistent.
    const overlayOut = path.join(ROOT, `public/splash/overlay-${locale}.png`);
    await ensureDir(path.dirname(overlayOut));
    await sharp(source)
      .resize(720, 1280, { fit: "contain", background: CREAM })
      .png({ compressionLevel: 9, palette: true })
      .toFile(overlayOut);
    console.log(`✓ ${path.relative(ROOT, overlayOut)} (Android overlay, 720x1280)`);

    builtLocales.push(locale);
  }

  const tsOut = path.join(ROOT, "src/lib/apple-splash-screens.ts");
  await ensureDir(path.dirname(tsOut));
  await writeFile(tsOut, renderTsModule(), "utf8");
  console.log(`✓ ${path.relative(ROOT, tsOut)}`);

  if (builtLocales.length === 0) {
    console.error("✗ no source posters found — nothing generated");
    process.exit(1);
  }
  console.log(`\nDone. Generated splashes for: ${builtLocales.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
