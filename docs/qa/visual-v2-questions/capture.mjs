import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base =
  process.env.VISUAL_V2_QUESTIONS_BASE_URL ?? "http://127.0.0.1:3102";
const output = "docs/qa/visual-v2-questions";
const browser = await chromium.launch();
const records = [];
await mkdir(output, { recursive: true });

async function waitForScene(page) {
  await page.evaluate(() => document.fonts.ready);
  for (const image of await page.locator("[data-scene] img").all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element) => element.decode().catch(() => undefined));
  }
  await page.waitForFunction(() => {
    const scene = document.querySelector("[data-scene]");
    const state = scene?.getAttribute("data-scene-state");
    return state === "ready" || state === "missing";
  });
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function capture(page, state, width, height, kind = "full") {
  await waitForScene(page);
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error(`Overflow: ${state} ${width}x${height}`);
  const name = `${state}-${width}x${height}-${kind}.png`;
  await page.screenshot({
    path: `${output}/${name}`,
    fullPage: kind === "full",
    animations: "disabled",
  });
  records.push({
    name,
    state,
    viewport: { width, height },
    kind,
    room: await page
      .locator("[data-cabinet-questions]")
      .getAttribute("data-room"),
    scene: await page.locator("[data-scene]").getAttribute("data-scene-state"),
    browser: browser.version(),
    overflow: false,
  });
}

async function advance(page, count) {
  for (let index = 0; index < count; index += 1) {
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: "下一题" }).click();
  }
}

const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
await page.goto(`${base}/studies/visual-v2-questions`);
await capture(page, "q1", 390, 844, "first");
await capture(page, "q1", 390, 844, "full");
await page.getByRole("radio").nth(1).click();
await capture(page, "q1-selected", 390, 844, "full");

let currentIndex = 0;
for (const index of [2, 3, 5, 6, 8, 9, 11]) {
  await advance(page, index - currentIndex);
  currentIndex = index;
  if ([3, 6, 9].includes(index))
    await capture(page, `q${index + 1}`, 390, 844, "first");
  await capture(page, `q${index + 1}`, 390, 844, "full");
}

for (const [index, width, height] of [
  [0, 375, 812],
  [3, 375, 812],
  [6, 375, 812],
  [9, 375, 812],
  [5, 430, 932],
  [11, 430, 932],
  [6, 1440, 1000],
]) {
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/studies/visual-v2-questions`);
  await page.setViewportSize({ width, height });
  await advance(page, index);
  await capture(page, `q${index + 1}`, width, height, "first");
}

await page.setViewportSize({ width: 320, height: 740 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${base}/studies/visual-v2-questions`);
await advance(page, 11);
await page.addStyleTag({
  content:
    '#v2-question, #v2-question + p, [role="radio"] > span:last-child, [data-cabinet-questions] button { font-size: 24px !important; }',
});
await capture(page, "q12-long-24px", 320, 740, "full");

await page.setViewportSize({ width: 390, height: 844 });
await page.emulateMedia({ reducedMotion: "reduce" });
await page.evaluate(() => localStorage.clear());
await page.goto(`${base}/studies/visual-v2-questions`);
await capture(page, "q1-reduced-motion", 390, 844, "full");
await page.emulateMedia({ reducedMotion: "no-preference" });

await page.route(
  "**/assets/themes/historical/visual-v2-questions/room-1.webp",
  (route) => route.abort(),
);
await page.evaluate(() => localStorage.clear());
await page.goto(`${base}/studies/visual-v2-questions`);
await capture(page, "q1-scene-missing", 390, 844, "full");
await page.unroute(
  "**/assets/themes/historical/visual-v2-questions/room-1.webp",
);

await page.close();
await browser.close();
await writeFile(
  `${output}/records.json`,
  JSON.stringify({ capturedOn: "2026-10-11 Asia/Shanghai", records }, null, 2) +
    "\n",
);
console.log(
  `Captured ${records.length} production browser screenshots without horizontal overflow.`,
);
