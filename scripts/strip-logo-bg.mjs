#!/usr/bin/env node
// Strips the cream/beige background from the logo PNGs so they sit cleanly
// on any backdrop (page bg, hero photo, dark overlays). Replaces pixels close
// to the corner color with full transparency.
// Usage: pnpm logo:strip

import { readFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const logos = [
  "public/logo/toto_mundial_2026_hebrew.png",
  "public/logo/toto_mundial_2026_english.png",
];

// Distance in RGB space below which a pixel is considered background.
const TOLERANCE = 38;
// Edge softness: pixels between TOLERANCE and TOLERANCE+FEATHER are
// proportionally faded to transparent, preserving anti-aliased edges.
const FEATHER = 12;

async function strip(input) {
  const abs = path.join(root, input);
  // Backup the original once.
  const backup = abs.replace(/\.png$/i, ".original.png");
  try {
    await readFile(backup);
  } catch {
    await copyFile(abs, backup);
  }

  const src = sharp(backup).ensureAlpha();
  const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Sample the four corners and average them to get the "background" color.
  // Logos have a uniform cream backdrop so this is reliable.
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
  const bg = samples.reduce(
    (acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b],
    [0, 0, 0],
  ).map((v) => Math.round(v / samples.length));

  let cleared = 0;
  let feathered = 0;
  for (let i = 0; i < data.length; i += channels) {
    const dr = data[i] - bg[0];
    const dg = data[i + 1] - bg[1];
    const db = data[i + 2] - bg[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= TOLERANCE) {
      data[i + 3] = 0;
      cleared += 1;
    } else if (dist <= TOLERANCE + FEATHER) {
      // Soft falloff for anti-aliased edges.
      const t = (dist - TOLERANCE) / FEATHER;
      data[i + 3] = Math.round(data[i + 3] * t);
      feathered += 1;
    }
  }

  await sharp(data, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toFile(abs);

  console.log(
    `${path.basename(input)}: bg=rgb(${bg.join(",")})  cleared=${cleared}  feathered=${feathered}`,
  );
}

try {
  for (const file of logos) await strip(file);
  console.log("Done. Originals backed up as *.original.png");
} catch (e) {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
}
