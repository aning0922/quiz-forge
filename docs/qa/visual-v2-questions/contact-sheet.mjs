import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const output = "docs/qa/visual-v2-questions";
const rooms = ["q1", "q4", "q7", "q10"];

await sharp({
  create: { width: 780, height: 1688, channels: 3, background: "#0d2426" },
})
  .composite(
    rooms.map((room, index) => ({
      input: `${output}/${room}-390x844-first.png`,
      left: (index % 2) * 390,
      top: Math.floor(index / 2) * 844,
    })),
  )
  .png()
  .toFile(`${output}/rooms-comparison.png`);

console.log(
  "One four-room comparison image derived from actual browser captures.",
);
