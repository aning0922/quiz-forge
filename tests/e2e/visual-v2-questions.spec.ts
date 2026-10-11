import { expect, test, type Page } from "@playwright/test";
import { historicalDemoQuestions } from "../../src/features/quiz/historical-demo";

const route = "/studies/visual-v2-questions";
const storageKey = "quizforge.visual-v2.cabinet-exploration.v1";
const originalJourneyKey = "quizforge.visual-v2.journey.v1";
const answers = Object.fromEntries(
  historicalDemoQuestions.map((question) => [question.id, 0]),
);

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function advance(page: Page, count: number) {
  for (let index = 0; index < count; index += 1) {
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: "下一题" }).click();
  }
}

test("cabinet exploration: four rooms, 12 fixed question markers and scene assets form the consumer flow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route);
  const root = page.locator("[data-cabinet-questions]");
  await expect(root).toBeVisible();
  await expect(root).toHaveAttribute("data-room", "0");
  await expect(page.getByRole("radio")).toHaveCount(4);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await expect(page.locator("[data-question-mark]")).toHaveCount(12);
  await expect(
    page.locator('[data-question-mark][data-answered="false"]'),
  ).toHaveCount(12);

  let currentIndex = 0;
  for (const [index, room] of [
    [0, "0"],
    [3, "1"],
    [6, "2"],
    [9, "3"],
  ] as const) {
    await advance(page, index - currentIndex);
    currentIndex = index;
    await expect(root).toHaveAttribute("data-room", room);
    await expect(page.locator("[data-scene]")).toHaveAttribute(
      "data-scene-state",
      "ready",
    );
    const scene = page.locator("[data-scene] img");
    await expect(scene).toHaveAttribute(
      "src",
      new RegExp(`room-${Number(room) + 1}\\.webp`),
    );
    expect(
      await scene.evaluate(
        (image) =>
          image instanceof HTMLImageElement &&
          image.complete &&
          image.naturalWidth > 0,
      ),
    ).toBe(true);
  }
  await expectNoOverflow(page);
});

test("cabinet exploration: toggling and keyboard selection update exactly the affected non-contiguous marker", async ({
  page,
}) => {
  await page.goto(route);
  const first = page.getByRole("radio").first();
  await first.click();
  await expect(first).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await page.getByRole("button", { name: "下一题" }).click();
  await page.getByRole("radio").nth(1).press("ArrowDown");
  await expect(page.getByRole("radio").nth(2)).toBeFocused();
  await expect(page.getByRole("radio").nth(2)).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "上一题" }).click();
  await first.click();
  await expect(first).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await expect(
    page.locator('[data-question-mark][data-answered="true"]'),
  ).toHaveCount(1);
  await expect(page.locator("[data-question-mark]").nth(0)).toHaveAttribute(
    "data-answered",
    "false",
  );
  await expect(page.locator("[data-question-mark]").nth(1)).toHaveAttribute(
    "data-answered",
    "true",
  );
});

test("cabinet exploration: draft resume, corrupt data, save failure and another-tab conflict use the isolated study key", async ({
  page,
  context,
}) => {
  await page.goto(route);
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
    { key: storageKey, answers: { pace: 0, letters: 2 } },
  );
  await page.evaluate(
    ({ key, answers }) => localStorage.setItem(key, JSON.stringify(answers)),
    { key: originalJourneyKey, answers: { pace: 3 } },
  );
  await page.goto(route);
  await page.getByRole("button", { name: "继续探馆" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), originalJourneyKey),
  ).toContain('"pace":3');

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
    { key: storageKey, answers },
  );
  await page.goto(route);
  await page.getByRole("button", { name: "继续探馆" }).click();
  await page.getByRole("button", { name: "核对答卷" }).click();
  const other = await context.newPage();
  await other.goto(route);
  await other.evaluate(() => localStorage.clear());
  await expect(page.getByText("另一页更新了进度")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看合成揭晓" }),
  ).toBeDisabled();
  await other.close();

  const failing = await context.newPage();
  await failing.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await failing.goto(route);
  await failing.getByRole("radio").first().click();
  await expect(failing.getByText("这次进度没有保存")).toBeVisible();
  await expect(failing.getByText("本机已暂存", { exact: false })).toHaveCount(
    0,
  );
  await failing.close();

  const corrupt = await context.newPage();
  await corrupt.goto(route);
  await corrupt.evaluate(
    (key) => localStorage.setItem(key, "bad-json"),
    storageKey,
  );
  await corrupt.goto(route);
  await corrupt.getByRole("button", { name: "丢弃损坏书签，重新开始" }).click();
  expect(
    await corrupt.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
  await corrupt.close();
});

test("cabinet exploration: pre-reveal remains identity-isolated and confirmation only navigates after all 12 answers", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(route);
  expect(await page.content()).not.toMatch(
    /李白|li-bai|肖像|openai|\/api\/ai/i,
  );
  for (const src of await page
    .locator("script[src]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")!))) {
    const script = await page.request.get(new URL(src, page.url()).href);
    expect(await script.text()).not.toMatch(/李白|li-bai|浪漫自由的行路者/);
  }
  for (let index = 0; index < historicalDemoQuestions.length; index += 1) {
    await page.getByRole("radio").first().click();
    await page
      .getByRole("button", {
        name:
          index === historicalDemoQuestions.length - 1 ? "核对答卷" : "下一题",
      })
      .click();
  }
  await expect(
    page.getByRole("button", { name: "查看合成揭晓" }),
  ).toBeEnabled();
  expect(requests.some((url) => /li-bai|openai|\/api\/ai/i.test(url))).toBe(
    false,
  );
  await page.getByRole("button", { name: "查看合成揭晓" }).click();
  await expect(page).toHaveURL(/\/studies\/visual-v2-b\/celestial\/reveal/);
});

test("cabinet exploration: mobile, desktop, long text, reduced motion, unavailable art and SSR loading remain usable", async ({
  page,
  browser,
}) => {
  for (const width of [320, 375, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto(route);
    await page.addStyleTag({
      content:
        '#v2-question, #v2-question + p, [role="radio"] > span:last-child, [data-cabinet-questions] button { font-size: 24px !important; }',
    });
    await expectNoOverflow(page);
    for (const control of await page.locator("button, [role=radio]").all()) {
      if (await control.isVisible())
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
          44,
        );
    }
  }

  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(route);
  await advance(page, 11);
  await page.addStyleTag({
    content:
      '#v2-question, #v2-question + p, [role="radio"] > span:last-child, [data-cabinet-questions] button { font-size: 24px !important; }',
  });
  await expect(page.locator("#v2-question")).toHaveCSS("font-size", "24px");
  await expect(page.locator("#v2-question + p")).toHaveCSS("font-size", "24px");
  await expect(
    page.locator("[role=radio] > span:last-child").first(),
  ).toHaveCSS("font-size", "24px");
  await expectNoOverflow(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => localStorage.clear());
  await page.goto(route);
  await expect(page.locator("[data-scene]")).toBeVisible();
  expect(
    await page
      .locator("[data-scene]")
      .evaluate((element) =>
        [...element.querySelectorAll<HTMLElement>("*")].every(
          (child) => getComputedStyle(child).animationName === "none",
        ),
      ),
  ).toBe(true);

  await page.route(
    "**/assets/themes/historical/visual-v2-questions/room-1.webp",
    (route) => route.abort(),
  );
  await page.evaluate(() => localStorage.clear());
  await page.goto(route);
  await expect(page.locator('[data-scene-state="missing"]')).toBeVisible();
  await expectNoOverflow(page);

  const ssr = await browser.newContext({ javaScriptEnabled: false });
  const loading = await ssr.newPage();
  await loading.goto(new URL(route, page.url()).href);
  await expect(loading.locator("[data-cabinet-questions]")).toHaveAttribute(
    "data-phase",
    "loading",
  );
  await expect(
    loading.getByRole("heading", { name: "正在开启藏馆" }),
  ).toBeVisible();
  await expect(loading.locator('[data-scene-state="loading"]')).toBeVisible();
  await ssr.close();
});
