import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.D1C_BASE_URL ?? "http://127.0.0.1:3100";
const output = "docs/qa/d1c";
const root = `${base}/studies/visual-v2-c`;
const browser = await chromium.launch();
const records = [];
await mkdir(output, { recursive: true });

async function waitForArt(page) {
  await page.evaluate(() => document.fonts.ready);
  for (const image of await page.locator("img").all()) {
    const visible = await image.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    if (!visible) continue;
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element) => element.decode().catch(() => undefined));
  }
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[data-candidate-image]")].every(
      (image) => image.getAttribute("data-image-state") !== "loading",
    ),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[data-scene]")].every((scene) => {
      const state = scene.getAttribute("data-scene-state");
      return state === "ready" || state === "missing";
    }),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[data-cabinet-questions]")].every(
      (question) => question.getAttribute("data-phase") !== "loading",
    ),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function capture(page, state, width, height, kind = "full", selector) {
  await waitForArt(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error(`Overflow: ${state} ${width}x${height}`);
  const name = `${state}-${width}x${height}-${kind}-chromium-${browser.version().split(".")[0]}.png`;
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
    state,
    viewport: { width, height },
    kind,
    browser: browser.version(),
    overflow: false,
  });
}

async function freshQuestion(page, index = 0) {
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${root}/question`);
  for (let step = 0; step < index; step += 1) {
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: "下一题" }).click();
  }
}

const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
await page.goto(root);
await capture(page, "cover", 390, 844, "first");
await capture(page, "cover", 390, 844, "full");

for (const index of [0, 3, 6, 9]) {
  await freshQuestion(page, index);
  if (index === 0) await capture(page, "question-1", 390, 844, "first");
  await capture(page, `question-${index + 1}`, 390, 844, "full");
}
await freshQuestion(page);
await page.getByRole("radio").nth(1).click();
await capture(page, "question-1-selected", 390, 844, "full");
await freshQuestion(page, 11);
await capture(page, "question-12", 390, 844, "full");
await page.getByRole("radio").first().click();
await page.getByRole("button", { name: "核对答卷" }).click();
await capture(page, "confirm", 390, 844, "first");
await capture(page, "confirm", 390, 844, "full");
await page.goto(`${root}/question`);
await capture(page, "resume", 390, 844, "full");

for (const view of ["reveal", "report", "poster"]) {
  await page.goto(`${root}/${view}`);
  await capture(page, view, 390, 844, "first");
  await capture(page, view, 390, 844, "full");
}
await page.goto(`${root}/report`);
await capture(
  page,
  "report-atlas",
  390,
  844,
  "component",
  "[data-result-atlas]",
);
await page
  .locator('[data-v2c="report"] details')
  .first()
  .locator("summary")
  .click();
await capture(page, "report-inscription-expanded", 390, 844, "full");
await page.goto(`${root}/report`);
await page
  .locator('[data-v2c="report"] details')
  .last()
  .locator("summary")
  .click();
await capture(page, "report-culture-expanded", 390, 844, "full");
await page.goto(`${root}/poster`);
await capture(page, "poster-art", 390, 844, "component", "[data-collectible]");

for (const [width, height] of [
  [320, 740],
  [375, 812],
  [430, 932],
  [1440, 1000],
]) {
  await page.setViewportSize({ width, height });
  for (const view of ["", "/question", "/reveal", "/report", "/poster"]) {
    if (view === "/question") await freshQuestion(page);
    else await page.goto(`${root}${view}`);
    await capture(
      page,
      view ? view.slice(1) : "cover",
      width,
      height,
      view === "/report" ? "full" : "first",
    );
  }
}

await page.setViewportSize({ width: 320, height: 740 });
await freshQuestion(page, 11);
await page.addStyleTag({
  content:
    '#v2-question, #v2-question + p, [role="radio"] > span:last-child { font-size: 24px !important; }',
});
await capture(page, "question-12-long-24px", 320, 740, "full");

for (const view of ["report", "poster"]) {
  await page.goto(`${root}/${view}`);
  await page.addStyleTag({
    content: "main :is(h1,h2,h3,p,summary,a) { font-size: 24px !important; }",
  });
  await capture(page, `${view}-long-24px`, 320, 740, "full");
}

await page.setViewportSize({ width: 390, height: 844 });
await page.emulateMedia({ reducedMotion: "reduce" });
await page.goto(`${root}/reveal`);
await capture(page, "reveal-reduced-motion", 390, 844, "full");
await page.emulateMedia({ reducedMotion: "no-preference" });

await page.route(
  "**/assets/themes/historical/visual-v2-c/room-1-*.webp",
  (route) => route.abort(),
);
await page.goto(root);
await capture(page, "cover-image-missing", 390, 844, "full");
await page.unroute("**/assets/themes/historical/visual-v2-c/room-1-*.webp");

await page.evaluate(() => localStorage.clear());
await page.goto(`${base}/studies/visual-v2-questions`);
await capture(page, "legacy-questions-q1", 390, 844, "first");

await page.goto(`${root}/poster`);
await page.getByRole("button", { name: "生成 PNG 海报", exact: true }).click();
await page.getByRole("link", { name: "下载 PNG 海报", exact: true }).waitFor();
await capture(page, "poster-generated", 390, 844, "full");
const downloadPromise = page.waitForEvent("download");
await page.getByRole("link", { name: "下载 PNG 海报", exact: true }).click();
const download = await downloadPromise;
await download.saveAs(`${output}/historical-default-1080x1920-chromium.png`);
for (const [width, height] of [
  [320, 740],
  [375, 812],
  [430, 932],
  [1440, 1000],
]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${root}/poster`);
  await page
    .getByRole("button", { name: "生成 PNG 海报", exact: true })
    .click();
  await page.locator("[data-generated-poster]").waitFor();
  await capture(page, "poster-generated", width, height, "full");
}
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${root}/poster/checks?sample=long`);
await page.getByRole("button", { name: "生成 PNG 海报", exact: true }).click();
await page.locator("[data-generated-poster]").waitFor();
await capture(page, "poster-long-generated", 390, 844, "full");
const longWaiting = page.waitForEvent("download");
await page.getByRole("link", { name: "下载 PNG 海报", exact: true }).click();
await (
  await longWaiting
).saveAs(`${output}/historical-long-1080x1920-chromium.png`);
for (const [state, pattern] of [
  [
    "poster-art-failed",
    "**/assets/themes/historical/visual-v2-c/figure-960.webp",
  ],
  ["poster-font-failed", "**/assets/fonts/visual-v2-c/serif-600.woff2"],
]) {
  const failurePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  await failurePage.route(pattern, (route) => route.abort());
  await failurePage.goto(`${root}/poster`);
  await failurePage
    .getByRole("button", { name: "生成 PNG 海报", exact: true })
    .click();
  await failurePage.locator("[data-poster-export] [role=alert]").waitFor();
  await capture(failurePage, state, 390, 844, "full");
  await failurePage.close();
}
const savePage = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
await savePage.addInitScript(() => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === "quizforge.visual-v2.cabinet-converged.v1")
      throw new DOMException("Synthetic quota", "QuotaExceededError");
    original.call(this, key, value);
  };
});
await savePage.goto(`${root}/question`);
await savePage.getByRole("radio").first().click();
await savePage.getByText("这次进度没有保存", { exact: true }).waitFor();
await capture(savePage, "question-save-failed", 390, 844, "full");
await savePage.close();
const conflictContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const conflictPage = await conflictContext.newPage();
const otherPage = await conflictContext.newPage();
await conflictPage.goto(`${root}/question`);
await conflictPage.getByRole("radio").first().click();
await otherPage.goto(`${root}/question`);
await otherPage.evaluate(() =>
  localStorage.setItem(
    "quizforge.visual-v2.cabinet-converged.v1",
    JSON.stringify({
      version: 1,
      answers: { pace: 2 },
      updatedAt: new Date().toISOString(),
    }),
  ),
);
await conflictPage.getByText("另一页更新了进度", { exact: true }).waitFor();
await capture(conflictPage, "question-conflict", 390, 844, "full");
await conflictContext.close();
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
