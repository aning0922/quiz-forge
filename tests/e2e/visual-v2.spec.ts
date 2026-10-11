import { expect, test, type Page } from "@playwright/test";
import { historicalDemoQuestions } from "../../src/features/quiz/historical-demo";

const route = (direction: string, view = "question") =>
  `/studies/visual-v2/${direction}/${view}`;
const storageKey = (direction: string) => `quizforge.visual-v2.${direction}.v1`;
const answers = Object.fromEntries(
  historicalDemoQuestions.map((q) => [q.id, 0]),
);
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const direction of ["journey", "collection"]) {
  test(`${direction}: unrevealed scripts and failed cover art stay neutral`, async ({
    page,
  }) => {
    await page.route("**/river-journey.webp", (request) => request.abort());
    await page.goto(route(direction, "cover"));
    if (direction === "journey")
      await expect(page.getByText("山水画作暂未呈现")).toBeVisible();
    for (const src of await page
      .locator("script[src]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")!))) {
      const script = await page.request.get(new URL(src, page.url()).href);
      expect(await script.text()).not.toMatch(
        /李白|li-bai-concept|浪漫自由的行路者/,
      );
    }
    await page
      .getByRole("link", {
        name: direction === "journey" ? "开启寻己之旅" : "翻开你的风骨藏卡",
      })
      .click();
    await expect(page.getByRole("radio")).toHaveCount(4);
  });
  test(`${direction}: 12 questions, edits, recovery, explicit synthetic reveal`, async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (req) => requests.push(req.url()));
    await page.goto(route(direction, "cover"));
    expect(await page.content()).not.toMatch(
      /李白|li-bai-concept|浪漫自由的行路者/,
    );
    await page
      .getByRole("link", {
        name: direction === "journey" ? "开启寻己之旅" : "翻开你的风骨藏卡",
      })
      .click();
    await expect(page.getByRole("button", { name: "下一题" })).toBeDisabled();
    const option = page.getByRole("radio").first();
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true");
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "false");
    await option.press("ArrowDown");
    await expect(page.getByRole("radio").nth(1)).toBeFocused();
    await expect(page.getByRole("radio").nth(1)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.reload();
    await expect(
      page.getByText("已答 1 / 12 题", { exact: false }),
    ).toBeVisible();
    expect(await page.content()).not.toMatch(/李白|li-bai-concept/);
    await page.getByRole("button", { name: "继续上次的旅程" }).click();
    await page.getByRole("button", { name: "上一题" }).click();
    await expect(page.getByRole("radio").nth(1)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.getByRole("radio").nth(2).click();
    for (let i = 0; i < 12; i++) {
      if (i !== 0) await page.getByRole("radio").nth(1).click();
      await page
        .getByRole("button", { name: i === 11 ? "核对答卷" : "下一题" })
        .click();
    }
    await expect(
      page.getByText("它不由你的答案计算", { exact: false }),
    ).toBeVisible();
    expect(await page.content()).not.toMatch(/李白|li-bai-concept/);
    expect(requests.some((url) => url.includes("li-bai-concept"))).toBe(false);
    await page.getByRole("button", { name: "返回修改回答" }).click();
    await page.getByRole("radio").nth(1).click();
    await expect(page.getByRole("button", { name: "核对答卷" })).toBeDisabled();
    await page.getByRole("radio").nth(2).click();
    await page.getByRole("button", { name: "核对答卷" }).click();
    await page.getByRole("button", { name: "查看合成揭晓" }).click();
    await expect(
      page.getByRole("heading", { name: "李白", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("固定合成示例 · 非答题结论")).toBeVisible();
    await page.getByRole("link", { name: "读这份人物志" }).click();
    await page.getByRole("link", { name: "匹配依据", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "为什么用这个人物意象？",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("这份合成示例", { exact: false }),
    ).toBeVisible();
    await page.getByRole("link", { name: "查看收藏海报" }).click();
    await expect(
      page.getByText("尚未提供图片保存", { exact: false }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("quizforge.d1b.historical-demo.v1"),
      ),
    ).toBeNull();
  });

  test(`${direction}: failed storage and corrupt bookmark remain honest`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Full", "QuotaExceededError");
      };
    });
    await page.goto(route(direction));
    await page.getByRole("radio").first().click();
    await expect(page.getByText("这次进度没有保存")).toBeVisible();
    await expect(page.getByText("已暂存，下次可以接着答")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "下一题" })).toBeEnabled();
  });

  test(`${direction}: corrupt draft is preserved until explicit discard`, async ({
    page,
  }) => {
    await page.goto(route(direction, "cover"));
    await page.evaluate(
      (key) => localStorage.setItem(key, "bad-json"),
      storageKey(direction),
    );
    await page.goto(route(direction));
    await page.getByRole("radio").first().click();
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        storageKey(direction),
      ),
    ).toBe("bad-json");
    await page.getByRole("button", { name: "丢弃损坏书签，重新开始" }).click();
    await expect(page.getByRole("radio").first()).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        storageKey(direction),
      ),
    ).toBeNull();
  });

  test(`${direction}: another tab locks edits and confirmation`, async ({
    page,
    context,
  }) => {
    await page.goto(route(direction, "cover"));
    await page.evaluate(
      ({ key, answers }) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            answers,
            updatedAt: new Date().toISOString(),
          }),
        ),
      { key: storageKey(direction), answers },
    );
    await page.goto(route(direction));
    await page.getByRole("button", { name: "继续上次的旅程" }).click();
    await page.getByRole("button", { name: "核对答卷" }).click();
    const other = await context.newPage();
    await other.goto(route(direction, "cover"));
    await other.evaluate(() => localStorage.clear());
    await expect(page.getByText("另一页更新了进度")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "查看合成揭晓" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "返回修改回答" }).click();
    await expect(page.getByRole("radio").first()).toBeDisabled();
    await page.getByRole("button", { name: "使用此页草稿" }).click();
    await expect(page.getByRole("radio").first()).toBeEnabled();
    await expect(page.getByText("已暂存，下次可以接着答")).toHaveCount(0);
  });

  test(`${direction}: long question, 24px options and controls fit four widths`, async ({
    page,
  }) => {
    await page.goto(route(direction, "cover"));
    const firstEleven = { ...answers };
    delete firstEleven.farewell;
    await page.evaluate(
      ({ key, answers }) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            answers,
            updatedAt: new Date().toISOString(),
          }),
        ),
      { key: storageKey(direction), answers: firstEleven },
    );
    await page.goto(route(direction));
    await page.getByRole("button", { name: "继续上次的旅程" }).click();
    await page.addStyleTag({
      content:
        '[role="radio"], [data-view="question"] button { font-size:24px !important; }',
    });
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page);
      for (const button of await page.locator("button").all()) {
        const fits = await button.evaluate((el) => ({
          fits: el.scrollWidth <= el.clientWidth + 1,
          height: el.getBoundingClientRect().height,
        }));
        expect(fits.fits).toBe(true);
        expect(fits.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test(`${direction}: reduced motion, missing portrait and SSR loading`, async ({
    page,
    browser,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/li-bai-concept.webp", (route) => route.abort());
    await page.goto(route(direction, "reveal"));
    await expect(page.getByText("人物画作暂未呈现")).toBeVisible();
    expect(
      await page
        .locator("[data-character-plate]")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
    await expect(
      page.getByRole("link", { name: "读这份人物志" }),
    ).toBeEnabled();
    const ssr = await browser.newContext({ javaScriptEnabled: false });
    const loading = await ssr.newPage();
    await loading.goto(new URL(route(direction), page.url()).href);
    await expect(
      loading.getByRole("heading", { name: "正在打开你的书卷" }),
    ).toBeVisible();
    await ssr.close();
  });

  test(`${direction}: five screens at four mobile widths and desktop`, async ({
    page,
  }) => {
    for (const width of [320, 375, 390, 430, 1440]) {
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 844,
      });
      for (const view of ["cover", "question", "reveal", "report", "poster"]) {
        await page.goto(route(direction, view));
        await page.evaluate(() => document.fonts.ready);
        await noOverflow(page);
        const controls = await page
          .locator("main a, main button, main summary")
          .all();
        for (const control of controls) {
          if (await control.isVisible())
            expect(
              (await control.boundingBox())!.height,
            ).toBeGreaterThanOrEqual(44);
        }
      }
    }
  });
}
