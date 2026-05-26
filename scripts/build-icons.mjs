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
//
// Background flattening: the source is a stamp on textured paper, so the
// cream backdrop is grainy, not flat. When we composite the cropped subject
// onto a solid cream canvas the grain stops at the artwork's old rectangle
// boundary, which the OS' circular icon mask reveals as a visible square
// inside the circle. To kill that boundary we walk the source pixels once
// and snap anything cream-ish (corner-sampled + tolerance) to the exact
// solid cream, leaving the ochre trophy and red "26" untouched.

import sharp from "sharp";
import { mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "public/brand/app-icon-source.png");

const CREAM = { r: 0xfb, g: 0xf6, b: 0xeb, alpha: 1 };

// RGB distance below which a source pixel counts as "cream background" and
// gets snapped to the exact CREAM color. Tuned to swallow the paper grain
// while leaving the ochre trophy (~#C68A2D) and red "26" (~#A13217) intact -
// both sit well past this distance from cream.
const CREAM_TOLERANCE = 55;

async function ensureDir(dir) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function getMeta() {
  const meta = await sharp(SOURCE).metadata();
  return meta;
}

// Read the source once, flatten every cream-ish pixel to the exact CREAM
// color, and return a PNG buffer. Downstream steps (tightCrop, squareIcon)
// composite from this flattened buffer so the cream stays uniform all the
// way to the icon's edge.
async function flattenedSource() {
  const { data, info } = await sharp(SOURCE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Average the four corners to lock onto the actual paper cream (the source
  // can be slightly warmer or cooler than CREAM after scanning).
  const px = (x, y) => {
    const i = (y * width + x) * channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const samples = [
    px(0, 0),
    px(width - 1, 0),
    px(0, height - 1),
    px(width - 1, height - 1),
  ];
  const bg = samples
    .reduce(
      (acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b],
      [0, 0, 0],
    )
    .map((v) => Math.round(v / samples.length));

  const t2 = CREAM_TOLERANCE * CREAM_TOLERANCE;
  for (let i = 0; i < data.length; i += channels) {
    const dr = data[i] - bg[0];
    const dg = data[i + 1] - bg[1];
    const db = data[i + 2] - bg[2];
    if (dr * dr + dg * dg + db * db <= t2) {
      data[i] = CREAM.r;
      data[i + 1] = CREAM.g;
      data[i + 2] = CREAM.b;
      data[i + 3] = 255;
    }
  }

  return sharp(data, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// Tight crop: trim the cream margins so the trophy fills the canvas.
// Sharp's .trim() uses corner-pixel colour as the trim target - perfect for
// the cream background here. Operates on the flattened buffer so the trimmed
// subject already has a uniform-cream halo around the trophy.
async function tightCrop(flat) {
  return sharp(flat).trim({ threshold: 30 }).toBuffer();
}

// Resize the tightly-cropped subject onto a cream square so the proportions
// look right at small sizes. `subjectScale` controls how much of the canvas
// the trophy fills (0..1).
async function squareIcon(flat, size, subjectScale) {
  const tight = await tightCrop(flat);
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

  const flat = await flattenedSource();
  console.log("✓ flattened source cream background");

  // --- App-served metadata icons (Next 16 file convention) ---
  // /src/app/icon.png  → favicon. 64px renders crisp at 16, 32, and 48.
  const favicon = await squareIcon(flat, 64, 0.92);
  await sharp(favicon).toFile(path.join(ROOT, "src/app/icon.png"));
  console.log("✓ src/app/icon.png (64x64)");

  // /src/app/apple-icon.png  → iOS home-screen icon. No transparency, big.
  const appleIcon = await squareIcon(flat, 180, 0.88);
  await sharp(appleIcon).toFile(path.join(ROOT, "src/app/apple-icon.png"));
  console.log("✓ src/app/apple-icon.png (180x180)");

  // --- PWA manifest icons ---
  const icon192 = await squareIcon(flat, 192, 0.86);
  await sharp(icon192).toFile(path.join(ROOT, "public/icons/icon-192.png"));
  console.log("✓ public/icons/icon-192.png");

  const icon512 = await squareIcon(flat, 512, 0.86);
  await sharp(icon512).toFile(path.join(ROOT, "public/icons/icon-512.png"));
  console.log("✓ public/icons/icon-512.png");

  // Maskable: extra padding so Android's circle/squircle mask clips only the
  // cream border, never the trophy. Safe-zone diameter = 80% of icon.
  const maskable512 = await squareIcon(flat, 512, 0.62);
  await sharp(maskable512).toFile(
    path.join(ROOT, "public/icons/maskable-icon-512.png"),
  );
  console.log("✓ public/icons/maskable-icon-512.png");

  // --- OG / Twitter share preview ---
  // Centred subject on 1200x630 cream rectangle.
  const ogSubject = await sharp(await tightCrop(flat))
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
