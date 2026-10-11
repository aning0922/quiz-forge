import { createRequire } from "node:module";

// Only derives QA overview images from this study's captured browser pixels.
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const root = "docs/qa/visual-v2";
const directions = ["journey", "collection"];
const views = ["cover", "question", "reveal", "report", "poster"];
const tiles = [];
for (const [row, direction] of directions.entries()) {
  for (const [column, view] of views.entries()) {
    const input = await sharp(`${root}/${direction}-${view}-390x844-first.png`)
      .resize(234)
      .png()
      .toBuffer();
    tiles.push({ input, left: column * 246 + 6, top: row * 550 + 30 });
  }
}
const label = Buffer.from(
  `<svg width="1230" height="1100" xmlns="http://www.w3.org/2000/svg"><rect width="1230" height="1100" fill="#dedfd6"/>${directions.map((_, row) => views.map((view, column) => `<text x="${column * 246 + 12}" y="${row * 550 + 21}" font-family="Arial" font-size="14" fill="#233c32">${row ? "B" : "A"} / ${view.toUpperCase()}</text>`).join("")).join("")}</svg>`,
);
await sharp(label).composite(tiles).png().toFile(`${root}/overview-390.png`);
await sharp({
  create: { width: 780, height: 844, channels: 3, background: "#f6f1e7" },
})
  .composite([
    { input: `${root}/journey-cover-390x844-first.png`, left: 0, top: 0 },
    { input: `${root}/collection-cover-390x844-first.png`, left: 390, top: 0 },
  ])
  .png()
  .toFile(`${root}/covers-390.png`);
console.log(
  "Created two overview images from original 390px browser screenshots.",
);
