import { createRequire } from "node:module";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const root = "public/assets/themes/historical";
const assets = [];
for (const name of ["room-1", "room-2", "room-3", "room-4", "figure"]) {
  const source =
    name === "figure"
      ? `${root}/visual-v2-b/li-bai-celestial.webp`
      : `${root}/visual-v2-questions/${name}.webp`;
  const sourceBytes = await readFile(source);
  for (const width of name === "figure" ? [160, 480, 960] : [480, 960]) {
    const path = `${root}/visual-v2-c/${name}-${width}.webp`;
    await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 6 })
      .toFile(path);
    const bytes = await readFile(path);
    const metadata = await sharp(bytes).metadata();
    assets.push({
      path: path.replace("public", ""),
      width: metadata.width,
      height: metadata.height,
      bytes: (await stat(path)).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      source: source.replace("public", ""),
      sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      transformation:
        "Proportional downsample and WebP encoding only. No crop, retouch or new art.",
      status: "pending",
      commercialApproval: "not-approved",
    });
  }
}
await writeFile(
  `${root}/visual-v2-c/manifest.json`,
  JSON.stringify(
    {
      createdOn: "2026-10-11",
      provenance:
        "Responsive derivatives of original AI concept art. Source manifests retain generation prompts and provenance; commercial approval remains pending.",
      sourceManifests: [
        "/assets/themes/historical/visual-v2-b/manifest.json",
        "/assets/themes/historical/visual-v2-questions/manifest.json",
      ],
      assets,
    },
    null,
    2,
  ) + "\n",
);
console.log(assets.map((a) => ({ path: a.path, bytes: a.bytes })));
