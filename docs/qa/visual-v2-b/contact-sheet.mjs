import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const output = "docs/qa/visual-v2-b";
const directions = ["landscape", "celestial"];

for (const state of ["reveal", "report", "poster"]) {
  const paths = directions.map(
    (direction) => `${output}/${direction}-${state}-390x844-first.png`,
  );
  await sharp({
    create: { width: 780, height: 844, channels: 3, background: "#101c24" },
  })
    .composite(
      paths.map((input, index) => ({ input, left: index * 390, top: 0 })),
    )
    .png()
    .toFile(`${output}/${state}-comparison.png`);
}
for (const [legacyDirection, direction] of [
  ["journey", "landscape"],
  ["collection", "celestial"],
]) {
  await sharp({
    create: { width: 780, height: 844, channels: 3, background: "#101c24" },
  })
    .composite([
      {
        input: `docs/qa/visual-v2/${legacyDirection}-reveal-390x844-first.png`,
        left: 0,
        top: 0,
      },
      {
        input: `${output}/${direction}-reveal-390x844-first.png`,
        left: 390,
        top: 0,
      },
    ])
    .png()
    .toFile(`${output}/${direction}-legacy-comparison.png`);
}
console.log("Five comparison images derived from actual browser captures.");
