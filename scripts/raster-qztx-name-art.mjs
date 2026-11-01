import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

const requested = process.argv[2];
if (!requested) throw Error("EXPLICIT_OUTPUT_REQUIRED");
const out = path.resolve(requested);
const privateRoot = path.resolve(import.meta.dirname, "../.cache") + path.sep;
if (!out.startsWith(privateRoot)) throw Error("PRIVATE_OUTPUT_REQUIRED");
const file = path.join(out, "manifest.json");
const manifest = JSON.parse(await readFile(file, "utf8"));
const rows = [...manifest.roles, ...manifest.syntheticSamples];
const { width, height } = manifest.canvas;
for (const row of rows) {
  const occupied = new Uint8Array(width * height);
  let overlapPixels = 0;
  for (const glyph of row.glyphs) {
    const { data, info } = await sharp(
      await readFile(path.join(out, glyph.source)),
      { density: 144 },
    )
      .resize(width, height)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < occupied.length; i++) {
      if (data[i * info.channels + 3]) {
        if (occupied[i]) overlapPixels++;
        occupied[i] = 1;
      }
    }
  }
  if (overlapPixels) throw Error(`OVERLAPPING_GLYPHS:${row.id}`);
  const png = await sharp(await readFile(path.join(out, row.sourceSvg)), {
    density: 144,
  })
    .resize(width, height)
    .png({ compressionLevel: 9 })
    .toBuffer();
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = width,
    top = height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * info.channels + 3]) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  if (left < 8 || top < 8 || right >= width - 8 || bottom >= height - 8)
    throw Error(`CLIPPED_GLYPH:${row.id}`);
  const alphaCenter = [(left + right + 1) / 2, (top + bottom + 1) / 2];
  const centerOffset = [
    alphaCenter[0] - width / 2,
    alphaCenter[1] - height / 2,
  ];
  if (centerOffset.some((v) => Math.abs(v) > 1))
    throw Error(`OFF_CENTER_INK:${row.id}`);
  await writeFile(path.join(out, row.png), png);
  Object.assign(row, {
    bytes: png.length,
    sha256: createHash("sha256").update(png).digest("hex"),
    mediaType: "image/png",
    overlapPixels,
    alphaCenter,
    centerOffset,
    alphaBounds: {
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
    },
  });
}
manifest.tools = {
  ...manifest.tools,
  sharp: sharp.versions.sharp,
  libvips: sharp.versions.vips,
};
await writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
const tiles = await Promise.all(
  rows.map(async (r, i) => ({
    input: await sharp(path.join(out, r.png))
      .resize(manifest.webDisplay.width, manifest.webDisplay.height)
      .toBuffer(),
    left: 12 + i * (manifest.webDisplay.width + 12),
    top: 12,
  })),
);
await sharp({
  create: {
    width: rows.length * (manifest.webDisplay.width + 12) + 12,
    height: manifest.webDisplay.height + 24,
    channels: 4,
    background: "#132b40",
  },
})
  .composite(tiles)
  .png()
  .toFile(path.join(out, "contact-sheet.png"));
console.log(
  JSON.stringify(
    rows.map(
      ({ id, bytes, sha256, overlapPixels, alphaCenter, centerOffset }) => ({
        id,
        bytes,
        sha256,
        overlapPixels,
        alphaCenter,
        centerOffset,
      }),
    ),
  ),
);
