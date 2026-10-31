import { chromium, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Connect only to the explicitly supplied, reference-only local fixture. This
// check does not start a production server or contact the consumer transport.
const origin = process.env.QZTX_SCENES_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
  throw Error("OWNED_REFERENCE_ORIGIN_REQUIRED");
const out = path.resolve(`.cache/qztx-v11-scenes-check/${Date.now()}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors: string[] = [];
const requests: string[] = [];
const results: { name: string; detail?: unknown }[] = [];
let passed = false;
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.method() !== "GET")
    requests.push(r.method() + " " + new URL(r.url()).pathname);
});
async function open(query: string) {
  await page.goto(`${origin}/?${query}`);
  await expect(page.locator('[data-reference-ready="true"]')).toBeVisible();
}
async function geometry(p: Page) {
  return p.locator("[data-qianzai-scroll-region]").evaluate((port) => {
    const parent = port.firstElementChild!.getBoundingClientRect();
    return [...port.querySelectorAll("h2,label")].map((node) => {
      const b = node.getBoundingClientRect();
      return [b.x - parent.x, b.y - parent.y, b.width, b.height];
    });
  });
}
async function textFits() {
  return page.locator("[data-qianzai-scroll-region]").evaluate((port) =>
    [...port.querySelectorAll("h2,label>span:nth-of-type(2)")].every((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const text = range.getBoundingClientRect(),
        box = node.getBoundingClientRect();
      return (
        Number.parseFloat(getComputedStyle(node).fontSize) >= 16 &&
        text.height <= box.height + 1 &&
        text.width <= box.width + 1
      );
    }),
  );
}
try {
  await open("screen=preference");
  await expect(page.locator("input[type=radio]:checked")).toHaveCount(0);
  await page.getByRole("button", { name: "进入第一幕", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "请先选择希望匹配的人物性别",
  );
  await expect(page.locator("[data-qianzai-screen=preference]")).toBeVisible();
  await expect(page.locator("[data-qianzai-transition]")).toHaveCount(0);
  await page.screenshot({
    path: path.join(out, "preference-required-390.png"),
  });
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator("label[data-choice=male]").click();
  await expect(page.locator("input[type=radio]:checked")).toHaveValue("male");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.clock.runFor(401);
  await expect(page.locator("[data-qianzai-transition] h2")).toHaveText(
    "初识本心",
  );
  await page.screenshot({ path: path.join(out, "first-chapter-390.png") });
  await page.clock.runFor(861);
  await expect(page.locator("[data-qianzai-screen=question]")).toBeVisible();
  await page.clock.resume();
  results.push({
    name: "fresh-null-validation-selected-feedback-first-chapter",
  });
  let expected: number[][] | undefined;
  for (let i = 0; i < 24; i++) {
    await open(`screen=question&index=${i}`);
    const actual = await geometry(page);
    expected ??= actual;
    expect(actual).toEqual(expected);
    expect(await textFits(), `Q${i + 1} full text`).toBe(true);
  }
  results.push({
    name: "24-question-common-geometry-and-complete-16px-text",
    detail: expected,
  });
  for (const [width, height] of [
    [320, 568],
    [430, 932],
  ] as const) {
    await page.setViewportSize({ width, height });
    await open("screen=question&index=21");
    expect(await textFits()).toBe(true);
    const before = await geometry(page);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.locator("label").first().click();
    expect(await geometry(page)).toEqual(before);
    const port = page.locator("[data-qianzai-scroll-region]");
    await port.evaluate((n) => {
      n.scrollTop = n.scrollHeight;
    });
    await expect(page.locator("label").last()).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(out, `q22-selected-bottom-${width}.png`),
    });
    await page.clock.resume();
  }
  results.push({
    name: "320-low-and-430-tall-lower-scroll-and-selection-no-reflow",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open("screen=preference");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator("label[data-choice=none]").click();
  await page.clock.runFor(401);
  await expect(page.locator("[data-qianzai-transition] h2")).toHaveText(
    "初识本心",
  );
  await page.clock.runFor(451);
  await expect(page.locator("[data-qianzai-screen=question]")).toBeVisible();
  results.push({ name: "reduced-motion-retains-static-first-chapter" });
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
  passed = true;
} finally {
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        passed,
        scope:
          "reference React views and shared scene geometry; no DB or consumer transport acceptance",
        results,
        errors,
        nonGetRequests: requests,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed, out, results, errors, nonGetRequests: requests }),
  );
  await browser.close();
}
