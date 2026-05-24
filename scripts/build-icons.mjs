#!/usr/bin/env node
// Generate the full favicon + PWA icon set from a single source PNG.
//
// Source: public/brand/app-icon-source.png (square, warm-paper trophy + 26)
//
// Outputs:
//   src/app/icon.png                    32x32   browser tab favicon
//   src/app/apple-icon.png              180x180 iOS Add-to-Home-Screen
//   public/icons/icon-192.png           192x192 PWA standard
//   public/icons/icon-512.png           512x512 PWA large
//   public/icons/maskable-icon-512.png  512x512 PWA maskable (safe-zone padded)
//   public/icons/og-image.png           1200x630 social preview
//
// The source has loose cream margins, so for the favicon we crop tighter to
// the trophy + "26" subject. The maskable icon adds padding back so Android's
// adaptive circle/squircle masks don't clip the trophy.
//
// Cream background colour: #FBF6EB (matches the surface-container-lowest
// token used across the app).

import sharp from "sharp";
import { mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "public/brand/app-icon-source.png");

const CREAM = { r: 0xfb, g: 0xf6, b: 0xeb, alpha: 1 };

async function ensureDir(dir) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function getMeta() {
  const meta = await sharp(SOURCE).metadata();
  return meta;
}

// Tight crop: trim the cream margins so the trophy fills the canvas.
// Sharp's .trim() uses corner-pixel colour as the trim target — perfect for
// the cream background here.
async function tightCrop() {
  return sharp(SOURCE)
    .trim({ threshold: 30 })
    .toBuffer();
}

// Resize the tightly-cropped subject onto a cream square so the proportions
// look right at small sizes. `subjectScale` controls how much of the canvas
// the trophy fills (0..1).
async function squareIcon(size, subjectScale) {
  const tight = await tightCrop();
  const inner = Math.round(size * subjectScale);
  const subject = await sharp(tight)
    .resize(inner, inner, { fit: "contain", background: CREAM })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: CREAM,
    },
  })
    .composite([{ input: subject, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`Source not found: ${SOURCE}`);
    process.exit(1);
  }
  const meta = await getMeta();
  console.log(`Source: ${meta.width}x${meta.height} ${meta.format}`);

  await ensureDir(path.join(ROOT, "src/app"));
  await ensureDir(path.join(ROOT, "public/icons"));

  // --- App-served metadata icons (Next 16 file convention) ---
  // /src/app/icon.png  → favicon. 64px renders crisp at 16, 32, and 48.
  const favicon = await squareIcon(64, 0.92);
  await sharp(favicon).toFile(path.join(ROOT, "src/app/icon.png"));
  console.log("✓ src/app/icon.png (64x64)");

  // /src/app/apple-icon.png  → iOS home-screen icon. No transparency, big.
  const appleIcon = await squareIcon(180, 0.88);
  await sharp(appleIcon).toFile(path.join(ROOT, "src/app/apple-icon.png"));
  console.log("✓ src/app/apple-icon.png (180x180)");

  // --- PWA manifest icons ---
  const icon192 = await squareIcon(192, 0.86);
  await sharp(icon192).toFile(path.join(ROOT, "public/icons/icon-192.png"));
  console.log("✓ public/icons/icon-192.png");

  const icon512 = await squareIcon(512, 0.86);
  await sharp(icon512).toFile(path.join(ROOT, "public/icons/icon-512.png"));
  console.log("✓ public/icons/icon-512.png");

  // Maskable: extra padding so Android's circle/squircle mask clips only the
  // cream border, never the trophy. Safe-zone diameter = 80% of icon.
  const maskable512 = await squareIcon(512, 0.62);
  await sharp(maskable512).toFile(
    path.join(ROOT, "public/icons/maskable-icon-512.png"),
  );
  console.log("✓ public/icons/maskable-icon-512.png");

  // --- OG / Twitter share preview ---
  // Centred subject on 1200x630 cream rectangle.
  const ogSubject = await sharp(await tightCrop())
    .resize(540, 540, { fit: "contain", background: CREAM })
    .png()
    .toBuffer();
  await sharp({
    create: { width: 1200, height: 630, channels: 4, background: CREAM },
  })
    .composite([{ input: ogSubject, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(ROOT, "public/icons/og-image.png"));
  console.log("✓ public/icons/og-image.png (1200x630)");

  // Also copy the favicon to /public/favicon.ico-named PNG fallback so older
  // browsers that bypass /app convention can still find one.
  await copyFile(
    path.join(ROOT, "src/app/icon.png"),
    path.join(ROOT, "public/favicon.png"),
  );
  console.log("✓ public/favicon.png (PNG fallback)");

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
