import { test, expect } from "@playwright/test";

const root = "/studies/historical/selected";
const viewports = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 1000 },
] as const;

test("unrevealed cover has no character identity, portrait request or report payload", async ({
  page,
}) => {
  const portraits: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("li-bai-concept")) portraits.push(request.url());
  });
  const response = await page.goto(`${root}/cover`);
  expect(response?.status()).toBe(200);
  const html = await response!.text();
  expect(html).not.toContain("李白");
  expect(html).not.toContain("li-bai-concept");
  expect(html).not.toContain("浪漫自由的行路者");
  await expect(page.getByText("中性情境视觉 · 人物尚未揭晓")).toBeVisible();
  await expect(page.getByRole("img")).toHaveCount(0);
  expect(portraits).toEqual([]);
  await page.getByRole("link", { name: "开始演示答题" }).click();
  await expect(page).toHaveURL(`${root}/experience`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "遇到一项",
  );
});

test("synthetic result exposes all seven display slots without scoring or export controls", async ({
  page,
}) => {
  await page.goto(`${root}/result`);
  await expect(
    page.getByRole("region", { name: "匹配人物与称号" }),
  ).toBeVisible();
  for (const name of [
    "核心性格维度",
    "匹配依据",
    "主要优势与潜在短板",
    "其他相似人物",
    "文化人物介绍",
    "收藏海报信息",
  ])
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("苏轼", { exact: true })).toBeVisible();
  await expect(
    page.getByText("倾向不是好坏评判，也不决定你的能力或选择。"),
  ).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(/\d+(?:\.\d+)?%/);
  await page.getByRole("link", { name: "展开人物志长卷" }).click();
  await expect(page).toHaveURL(/#report$/);
  await page.getByRole("link", { name: "返回未揭晓封面" }).click();
  await expect(page).toHaveURL(`${root}/cover`);
});

test.describe("directed visual evidence", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");
  });
  for (const state of ["cover", "result"] as const)
    test(`${state}: viewport and screenshot matrix`, async ({
      page,
      browser,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.goto(`${root}/${state}`);
        await page.evaluate(() => document.fonts.ready);
        if (state === "result")
          await expect
            .poll(() =>
              page
                .getByRole("img")
                .evaluate((img) => (img as HTMLImageElement).naturalWidth),
            )
            .toBe(800);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const links = await page.getByRole("link").evaluateAll((elements) =>
          elements
            .map((e) => ({
              text: e.textContent,
              width: e.getBoundingClientRect().width,
              height: e.getBoundingClientRect().height,
            }))
            .filter((e) => e.width > 0),
        );
        expect(links.filter((e) => e.width < 44 || e.height < 44)).toEqual([]);
        const name = `selected-${state}-${viewport.width}x${viewport.height}-chromium-${browser.version().split(".")[0]}`;
        await page.screenshot({
          path: `test-results/d1a1-regression/${name}-full.png`,
          fullPage: true,
          animations: "disabled",
        });
        if (viewport.width === 390)
          await page.screenshot({
            path: `test-results/d1a1-regression/${name}-first.png`,
            animations: "disabled",
          });
        await testInfo.attach(name, {
          path: `test-results/d1a1-regression/${name}-full.png`,
          contentType: "image/png",
        });
      }
      expect(errors).toEqual([]);
    });
  test("320px, long text, reduced motion, missing portrait and background", async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    for (const state of ["cover", "result"]) {
      await page.goto(`${root}/${state}`);
      await page.addStyleTag({
        content: "p, dd, li { font-size: 24px !important; }",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize(viewports[1]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const state of ["cover", "result"]) {
      await page.goto(`${root}/${state}`);
      expect(
        await page
          .locator("main")
          .evaluate((e) => getComputedStyle(e).animationName),
      ).toBe("none");
      await page.screenshot({
        path: `test-results/d1a1-regression/selected-${state}-390x844-chromium-${browser.version().split(".")[0]}-reduced.png`,
        fullPage: true,
      });
    }
    await page.route("**/li-bai-concept.webp", (route) => route.abort());
    await page.route("**/jade-landscape.webp", (route) => route.abort());
    for (const state of ["cover", "result"]) {
      await page.goto(`${root}/${state}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (state === "result")
        await expect(page.getByRole("status")).toContainText(
          "人物概念图暂不可用",
        );
      await page.screenshot({
        path: `test-results/d1a1-regression/selected-${state}-390x844-chromium-${browser.version().split(".")[0]}-missing.png`,
        fullPage: true,
      });
    }
    expect((await page.goto(`${root}/question`))?.status()).toBe(404);
    expect((await page.goto(`${root}/resume`))?.status()).toBe(404);
  });
});
