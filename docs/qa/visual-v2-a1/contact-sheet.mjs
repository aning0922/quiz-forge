import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const output = "docs/qa/visual-v2-a1";
for (const state of ["report", "poster"]) {
  await sharp({
    create: { width: 780, height: 844, channels: 3, background: "#f6f1e7" },
  })
    .composite([
      {
        input: `${output}/journey-${state}-390x844-first.png`,
        left: 0,
        top: 0,
      },
      {
        input: `${output}/collection-${state}-390x844-first.png`,
        left: 390,
        top: 0,
      },
    ])
    .png()
    .toFile(`${output}/${state}-comparison.png`);
}
const paths = ["journey", "collection"].map(
  (d) => `${output}/${d}-atlas-five-390x844-component.png`,
);
const sizes = await Promise.all(paths.map((path) => sharp(path).metadata()));
const height = Math.max(...sizes.map((size) => size.height)) + 64;
const background = Buffer.from(
  `<svg width="780" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="390" height="${height}" fill="#f6f1e7"/><rect x="390" width="390" height="${height}" fill="#102e2c"/><text x="24" y="27" font-family="Arial" font-size="14" fill="#263c35">A / JOURNEY</text><text x="414" y="27" font-family="Arial" font-size="14" fill="#f1e8d4">B / COLLECTION</text></svg>`,
);
await sharp(background)
  .composite(paths.map((input, i) => ({ input, left: i * 390 + 24, top: 42 })))
  .png()
  .toFile(`${output}/atlas-comparison.png`);
console.log("Three comparison images derived from actual browser captures.");
