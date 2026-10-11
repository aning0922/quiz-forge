import { test, expect } from "@playwright/test";

const directions = ["folio", "cabinet"] as const;
const states = ["cover", "portrait"] as const;
const viewports = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 1000 },
] as const;

// Screenshot matrix runs once; existing smoke tests cover both projects.
test.describe("D1-A visual research", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");
  });
  for (const direction of directions)
    for (const state of states) {
      test(`${direction}/${state}: responsive screenshot matrix`, async ({
        page,
        browser,
      }, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          expect(
            (
              await page.goto(`/studies/historical/${direction}/${state}`)
            )?.status(),
          ).toBe(200);
          await page.evaluate(() => document.fonts.ready);
          await expect(page.getByText("D1-A 研究稿 · 待审阅")).toBeVisible();
          await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
          const image = page.getByAltText(/李白艺术化概念立绘/);
          await expect(image).toBeVisible();
          await expect
            .poll(() =>
              image.evaluate((img) => (img as HTMLImageElement).naturalWidth),
            )
            .toBe(800);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          const links = await page.getByRole("link").evaluateAll((elements) =>
            elements
              .filter((e) => e.getBoundingClientRect().width > 0)
              .map((e) => ({
                text: e.textContent,
                height: e.getBoundingClientRect().height,
                width: e.getBoundingClientRect().width,
              })),
          );
          expect(
            links.filter((link) => link.height < 44 || link.width < 44),
          ).toEqual([]);
          const font = await page
            .getByRole("heading", { level: 1 })
            .evaluate((e) => getComputedStyle(e).fontFamily);
          expect(font).toContain("Historical Serif");
          const name = `historical-${direction}-${state}-${viewport.width}x${viewport.height}-chromium-${browser.version().split(".")[0]}`;
          await page.screenshot({
            path: `docs/qa/d1a/${name}-full.png`,
            fullPage: true,
            animations: "disabled",
          });
          if (viewport.width === 390)
            await page.screenshot({
              path: `docs/qa/d1a/${name}-first.png`,
              animations: "disabled",
            });
          await testInfo.attach(name, {
            path: `docs/qa/d1a/${name}-full.png`,
            contentType: "image/png",
          });
        }
        expect(errors).toEqual([]);
      });
    }
  test("comparison and concept navigation", async ({ page, browser }) => {
    for (const viewport of [viewports[1], viewports[3]]) {
      await page.setViewportSize(viewport);
      await page.goto("/studies/historical");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByText("视觉探索 · 待作者审阅")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `docs/qa/d1a/historical-comparison-${viewport.width}x${viewport.height}-chromium-${browser.version().split(".")[0]}-full.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.getByRole("link", { name: "查看东方人物志封面概念" }).click();
    await page.getByRole("link", { name: "翻开人物档案概念" }).click();
    await expect(page).toHaveURL(/folio\/portrait$/);
    await expect(
      page.getByText("人物档案 · 合成示例 / 非测评结果"),
    ).toBeVisible();
    await page.getByRole("link", { name: "查看另一方向" }).click();
    await expect(page).toHaveURL(/cabinet\/portrait$/);
    await expect(
      page.getByText("以上文案完全为布局编写", { exact: false }),
    ).toBeVisible();
  });
  test("320px, enlarged long report, missing assets and reduced motion", async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    for (const direction of directions) {
      for (const state of states) {
        await page.goto(`/studies/historical/${direction}/${state}`);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await page.addStyleTag({ content: "p { font-size: 24px !important; }" });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize(viewports[1]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const direction of directions) {
      await page.goto(`/studies/historical/${direction}/cover`);
      const duration = await page
        .getByRole("link", { name: "翻开人物档案概念" })
        .evaluate((e) => getComputedStyle(e).transitionDuration);
      expect(duration.split(",").every((d) => parseFloat(d) <= 0.001)).toBe(
        true,
      );
      await page.screenshot({
        path: `docs/qa/d1a/historical-${direction}-cover-390x844-chromium-${browser.version().split(".")[0]}-reduced.png`,
        fullPage: true,
      });
    }
    // A slow portrait must not prevent titles and the concept link from rendering.
    await page.route("**/li-bai-concept.webp", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await page.goto("/studies/historical/folio/cover", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "翻开人物档案概念" }),
    ).toBeVisible();
    await page.waitForLoadState("load");
    await page.unroute("**/li-bai-concept.webp");
    await page.route("**/li-bai-concept.webp", (route) => route.abort());
    await page.route("**/jade-landscape.webp", (route) => route.abort());
    for (const direction of directions) {
      await page.goto(`/studies/historical/${direction}/cover`);
      await expect(page.getByRole("status")).toContainText(
        "人物概念图暂不可用",
      );
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `docs/qa/d1a/historical-${direction}-cover-390x844-chromium-${browser.version().split(".")[0]}-missing.png`,
        fullPage: true,
      });
    }
  });
  test("unknown visual recipe returns 404", async ({ page }) => {
    expect(
      (await page.goto("/studies/historical/unknown/cover"))?.status(),
    ).toBe(404);
    expect(
      (await page.goto("/studies/historical/folio/question"))?.status(),
    ).toBe(404);
  });
});
