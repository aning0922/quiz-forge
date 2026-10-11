import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.VISUAL_V2_BASE_URL ?? "http://127.0.0.1:3102";
const output = "docs/qa/visual-v2-a1";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const records = [];
const url = (direction, view, variant = "classical") =>
  `${base}/studies/visual-v2/${direction}/${view}?inscription=${variant}`;
async function capture(
  page,
  direction,
  state,
  width,
  height,
  kind = "full",
  selector,
) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images].map((img) => img.decode().catch(() => {})),
    );
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error(`Overflow: ${direction} ${state} ${width}`);
  const name = `${direction}-${state}-${width}x${height}-${kind}.png`;
  if (selector)
    await page
      .locator(selector)
      .screenshot({ path: `${output}/${name}`, animations: "disabled" });
  else
    await page.screenshot({
      path: `${output}/${name}`,
      fullPage: kind === "full",
      animations: "disabled",
    });
  records.push({
    name,
    direction,
    state,
    viewport: { width, height },
    kind,
    browser: browser.version(),
    overflow: false,
  });
}
for (const direction of ["journey", "collection"]) {
  for (const [width, height] of [
    [320, 740],
    [375, 812],
    [390, 844],
    [430, 932],
    [1440, 1000],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    for (const view of ["report", "poster"]) {
      await page.goto(url(direction, view));
      await capture(page, direction, view, width, height);
      if (width === 390)
        await capture(page, direction, view, width, height, "first");
    }
    await page.goto(
      `${base}/studies/visual-v2/atlas?direction=${direction}&sample=five`,
    );
    await capture(
      page,
      direction,
      "atlas-five",
      width,
      height,
      "component",
      "[data-result-atlas]",
    );
    await page.close();
  }
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  for (const sample of ["four", "seven", "long"]) {
    await page.goto(
      `${base}/studies/visual-v2/atlas?direction=${direction}&sample=${sample}`,
    );
    await capture(
      page,
      direction,
      `atlas-${sample}`,
      390,
      844,
      "component",
      "[data-result-atlas]",
    );
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addStyleTag({
    content:
      "[data-result-atlas] :is(h2,h3,p,summary,dt,dd) {font-size:24px !important;}",
  });
  await capture(page, direction, "long-24px", 320, 740);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url(direction, "report"));
  await page.locator("[data-inscription] summary").click();
  await capture(
    page,
    direction,
    "verse-source",
    390,
    844,
    "component",
    "[data-inscription]",
  );
  await page.goto(url(direction, "report", "original"));
  await capture(page, direction, "original-report", 390, 844);
  await capture(page, direction, "original-report", 390, 844, "first");
  await page.getByRole("link", { name: "查看收藏海报" }).click();
  await capture(page, direction, "original-poster", 390, 844);
  await page.goto(url(direction, "report", "none"));
  await capture(page, direction, "no-verse", 390, 844, "first");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url(direction, "report"));
  await capture(page, direction, "reduced-motion", 390, 844);
  await page.close();
}
await browser.close();
await writeFile(
  `${output}/records.json`,
  JSON.stringify({ capturedOn: "2026-10-11 Asia/Shanghai", records }, null, 2) +
    "\n",
);
console.log(
  `Captured ${records.length} production browser screenshots without horizontal overflow.`,
);
