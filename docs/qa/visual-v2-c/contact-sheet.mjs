import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const dir = "docs/qa/visual-v2-c";
const flow = ["cover", "question-1", "confirm", "reveal", "report", "poster"];
await sharp({
  create: { width: 1170, height: 1688, channels: 3, background: "#101f2b" },
})
  .composite(
    flow.map((name, index) => ({
      input: `${dir}/${name}-390x844-first.png`,
      left: (index % 3) * 390,
      top: Math.floor(index / 3) * 844,
    })),
  )
  .png()
  .toFile(`${dir}/complete-flow-comparison.png`);
await sharp({
  create: { width: 780, height: 844, channels: 3, background: "#101f2b" },
})
  .composite(
    ["reveal", "report"].map((name, index) => ({
      input: `${dir}/${name}-390x844-first.png`,
      left: index * 390,
      top: 0,
    })),
  )
  .png()
  .toFile(`${dir}/reveal-to-report-comparison.png`);
console.log(
  "Created two contact sheets from the final 390px browser first-screen captures.",
);
