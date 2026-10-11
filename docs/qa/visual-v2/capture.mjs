import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.VISUAL_V2_BASE_URL ?? "http://127.0.0.1:3102";
const output = "docs/qa/visual-v2";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const version = browser.version();
const records = [];
const questions = [
  "pace",
  "letters",
  "crossroads",
  "craft",
  "disagreement",
  "morning",
  "responsibility",
  "gift",
  "rain",
  "learning",
  "promise",
];
const key = (direction) => `quizforge.visual-v2.${direction}.v1`;
const url = (direction, view) =>
  `${base}/studies/visual-v2/${direction}/${view}`;
async function capture(page, direction, state, width, height, first = false) {
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
    throw new Error(`Overflow ${direction} ${state} ${width}`);
  const name = `${direction}-${state}-${width}x${height}-${first ? "first" : "full"}.png`;
  await page.screenshot({
    path: `${output}/${name}`,
    fullPage: !first,
    animations: "disabled",
  });
  records.push({
    name,
    direction,
    state,
    viewport: { width, height },
    browser: `Chromium ${version}`,
    mode: first ? "first" : "full",
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
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    for (const view of ["cover", "question", "reveal", "report", "poster"]) {
      await page.goto(url(direction, view));
      if (view === "question") await page.getByRole("radio").nth(1).click();
      await capture(page, direction, view, width, height);
      if (width === 390)
        await capture(page, direction, view, width, height, true);
    }
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(url(direction, "question"));
  await page.getByRole("radio").nth(1).click();
  await page.reload();
  await page.getByRole("button", { name: "继续上次的旅程" }).waitFor();
  await capture(page, direction, "resume", 390, 844);
  await page.evaluate(
    ({ key, questions }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          answers: Object.fromEntries(questions.map((id) => [id, 0])),
          updatedAt: new Date().toISOString(),
        }),
      ),
    { key: key(direction), questions },
  );
  await page.reload();
  await page.getByRole("button", { name: "继续上次的旅程" }).click();
  await capture(page, direction, "long-question", 390, 844);
  await page.getByRole("radio").nth(2).click();
  await page.getByRole("button", { name: "核对答卷" }).click();
  await capture(page, direction, "confirm", 390, 844);
  const other = await context.newPage();
  await other.goto(url(direction, "cover"));
  await other.evaluate(() => localStorage.clear());
  await page.getByText("另一页更新了进度").waitFor();
  await capture(page, direction, "conflict", 390, 844);
  await other.close();
  await page.goto(url(direction, "question"));
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await page.getByRole("radio").first().click();
  await capture(page, direction, "save-failed", 390, 844);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url(direction, "reveal"));
  await capture(page, direction, "reduced-motion", 390, 844);
  await page.route("**/li-bai-concept.webp", (route) => route.abort());
  await page.reload();
  await page.getByText("人物画作暂未呈现").waitFor();
  await capture(page, direction, "missing-portrait", 390, 844);
  await context.close();
  const ssr = await browser.newContext({
    viewport: { width: 390, height: 844 },
    javaScriptEnabled: false,
  });
  const loading = await ssr.newPage();
  await loading.goto(url(direction, "question"));
  await capture(loading, direction, "loading-ssr", 390, 844);
  await ssr.close();
}
const research = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
});
await research.goto(`${base}/studies/visual-v2`);
await capture(research, "comparison", "index", 1440, 1000);
await browser.close();
await writeFile(
  `${output}/records.json`,
  JSON.stringify(
    { capturedOn: "2026-10-11 Asia/Shanghai", browser: version, records },
    null,
    2,
  ) + "\n",
);
console.log(
  `Captured ${records.length} screenshots, Chromium ${version}, no horizontal overflow.`,
);
