import { expect, test, type Page } from "@playwright/test";
import { historicalDemoQuestions } from "../../src/features/quiz/historical-demo";

const root = "/studies/visual-v2-c";
const questionRoute = `${root}/question`;
const storageKey = "quizforge.visual-v2.cabinet-converged.v1";
const legacyCabinetKey = "quizforge.visual-v2.cabinet-exploration.v1";

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

async function expectReadyImage(page: Page) {
  const frame = page.locator("[data-candidate-image]").first();
  await expect(frame).toHaveAttribute("data-image-state", "ready");
  const image = frame.locator("img");
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      (element) =>
        element instanceof HTMLImageElement &&
        element.complete &&
        element.naturalWidth > 0,
    ),
  ).toBe(true);
}

test("V2-C cover enters the converged cabinet without identity or result preload", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(root);
  await expect(page.locator('[data-v2c="cover"]')).toBeVisible();
  await expectReadyImage(page);
  expect(await page.content()).not.toMatch(
    /李白|li-bai|肖像|浪漫自由的行路者/i,
  );
  for (const src of await page
    .locator("script[src]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")!))) {
    const script = await page.request.get(new URL(src, page.url()).href);
    expect(await script.text()).not.toMatch(/李白|li-bai|浪漫自由的行路者/);
  }
  expect(
    requests.some((url) =>
      /li-bai|figure-|\/reveal|\/report|\/poster/i.test(url),
    ),
  ).toBe(false);
  await page.getByRole("link", { name: "推门入馆" }).click();
  await expect(page).toHaveURL(/\/studies\/visual-v2-c\/question$/);
  await expect(page.locator("[data-cabinet-questions]")).toHaveAttribute(
    "data-converged",
    "true",
  );
});

test("V2-C question keeps all twelve interactions, independent storage and room-to-room progress", async ({
  page,
}) => {
  await page.goto(questionRoute);
  const cabinet = page.locator("[data-cabinet-questions]");
  await expect(cabinet).toHaveAttribute("data-converged", "true");
  await expect(page.getByRole("radio")).toHaveCount(4);
  await expect(page.locator("[data-question-mark]")).toHaveCount(12);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );

  const first = page.getByRole("radio").first();
  await first.click();
  await first.click();
  await expect(first).toHaveAttribute("aria-checked", "false");
  await first.press("ArrowDown");
  await expect(page.getByRole("radio").nth(1)).toBeFocused();
  await expect(page.getByRole("radio").nth(1)).toHaveAttribute(
    "aria-checked",
    "true",
  );

  let current = 0;
  for (const [index, room] of [
    [0, "0"],
    [3, "1"],
    [6, "2"],
    [9, "3"],
  ] as const) {
    await advance(page, index - current);
    current = index;
    await expect(cabinet).toHaveAttribute("data-room", room);
  }
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).not.toBeNull();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), legacyCabinetKey),
  ).toBeNull();
});

test("V2-C DPR 3 questions select the 960px room source within the 200KiB asset budget", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  await page.goto(questionRoute);
  const image = page.locator("[data-scene] img");
  await expect(image).toBeVisible();
  await page.waitForFunction((selector) => {
    const image = document.querySelector(selector);
    return (
      image instanceof HTMLImageElement &&
      image.complete &&
      image.naturalWidth > 0
    );
  }, "[data-scene] img");
  const currentSrc = await image.evaluate((element) => {
    if (!(element instanceof HTMLImageElement))
      throw new Error("Expected a scene image");
    return element.currentSrc;
  });
  expect(currentSrc).toMatch(/room-1-960\.webp$/);
  const asset = await page.request.get(currentSrc);
  expect(asset.ok()).toBe(true);
  expect((await asset.body()).byteLength).toBeLessThanOrEqual(200 * 1024);
  await context.close();
});

test("V2-C restores only its own cabinet record and keeps failure states honest", async ({
  page,
  context,
}) => {
  await page.goto(questionRoute);
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
    { key: storageKey, answers: { pace: 0, letters: 1 } },
  );
  await page.goto(questionRoute);
  await page.getByRole("button", { name: "继续探馆" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "2",
  );

  const other = await context.newPage();
  await other.goto(questionRoute);
  await other.evaluate(
    ({ key, answers }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          answers,
          updatedAt: new Date().toISOString(),
        }),
      ),
    { key: storageKey, answers: { pace: 3 } },
  );
  await expect(page.getByText("另一页更新了进度")).toBeVisible();
  await expect(page.getByRole("radio").first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "下一题" })).toBeDisabled();
  await page.getByRole("button", { name: "使用此页草稿" }).click();
  await expect(page.getByRole("radio").first()).toBeEnabled();
  await other.close();

  const failing = await context.newPage();
  await failing.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await failing.goto(questionRoute);
  await failing.evaluate(() => localStorage.clear());
  await failing.goto(questionRoute);
  await failing.getByRole("radio").first().click();
  await expect(failing.getByText("这次进度没有保存")).toBeVisible();
  await expect(failing.getByText("本机已暂存", { exact: false })).toHaveCount(
    0,
  );
  await failing.close();

  const corrupt = await context.newPage();
  await corrupt.goto(questionRoute);
  await corrupt.evaluate(
    (key) => localStorage.setItem(key, "bad-json"),
    storageKey,
  );
  await corrupt.goto(questionRoute);
  await corrupt.getByRole("button", { name: "丢弃损坏书签，重新开始" }).click();
  expect(
    await corrupt.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
  await corrupt.close();
});

test("V2-C completes manually into reveal, report and poster while retaining fixed synthetic scores", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(root);
  await page.getByRole("link", { name: "推门入馆" }).click();
  for (const src of await page
    .locator("script[src]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")!))) {
    const script = await page.request.get(new URL(src, page.url()).href);
    expect(await script.text()).not.toMatch(/李白|li-bai/);
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
    page.getByText("它不由你的答案计算", { exact: false }),
  ).toBeVisible();
  expect(
    requests.some((url) => /figure-|\/reveal|\/report|\/poster/i.test(url)),
  ).toBe(false);
  await page.getByRole("button", { name: "查看合成揭晓" }).click();
  await expect(page).toHaveURL(/\/studies\/visual-v2-c\/reveal$/);
  await expect(page.locator('[data-v2c="reveal"]')).toBeVisible();
  await expectReadyImage(page);
  await page.getByRole("link", { name: "翻阅完整人物志" }).click();
  await expect(page).toHaveURL(/\/studies\/visual-v2-c\/report$/);
  const reportFigure = page.locator(
    '[data-v2c="report"] [data-candidate-image]',
  );
  expect((await reportFigure.boundingBox())!.height).toBeLessThanOrEqual(120);
  const meters = page.getByRole("meter");
  await expect(meters).toHaveCount(5);
  expect(
    await meters.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-valuenow")),
    ),
  ).toEqual(["88", "82", "64", "46", "38"]);
  expect(
    ((await meters.first().boundingBox())?.y ?? Infinity) +
      ((await meters.first().boundingBox())?.height ?? 0),
  ).toBeLessThanOrEqual(844);
  for (const href of await page
    .locator("a[href]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")!)))
    expect(href).not.toContain("/studies/visual-v2/");
  await expectNoOverflow(page);
  await page.getByRole("link", { name: "查看收藏海报" }).click();
  await expect(page).toHaveURL(/\/studies\/visual-v2-c\/poster$/);
  await expect(page.locator('[data-v2c="poster"]')).toBeVisible();
  await expectReadyImage(page);
  await expectNoOverflow(page);
});

test("V2-C enlarged report and poster text remain inside their reading and collectible bounds", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const view of ["report", "poster"]) {
    await page.goto(`${root}/${view}`);
    await page.addStyleTag({
      content: "main :is(h1,h2,h3,p,summary,a) { font-size: 24px !important; }",
    });
    await expectNoOverflow(page);
    if (view === "poster") {
      const bounds = await page
        .locator("[data-collectible]")
        .evaluate((element) => ({
          box: element.getBoundingClientRect().toJSON(),
          text: [
            ...element.querySelectorAll("h1,h2,p,blockquote,[class*=tags]"),
          ].map((node) => node.getBoundingClientRect().toJSON()),
        }));
      for (const box of bounds.text) {
        expect(box.right).toBeLessThanOrEqual(bounds.box.right + 1);
        expect(box.bottom).toBeLessThanOrEqual(bounds.box.bottom + 1);
      }
    }
  }
});

test("V2-C cover, reveal and report thumbnail disclose missing local art while preserving reading paths", async ({
  page,
}) => {
  for (const [view, pattern, action] of [
    ["", "room-1-*.webp", "推门入馆"],
    ["/reveal", "figure-*.webp", "翻阅完整人物志"],
    ["/report", "figure-*.webp", "查看收藏海报"],
  ] as const) {
    const glob = `**/assets/themes/historical/visual-v2-c/${pattern}`;
    await page.route(glob, (route) => route.abort());
    await page.goto(`${root}${view}`);
    await expect(page.locator('[data-image-state="missing"]')).toBeVisible();
    await expect(page.getByRole("link", { name: action })).toBeVisible();
    await expectNoOverflow(page);
    await page.unroute(glob);
  }
});

test("V2-C supports responsive long reading, reduced motion, image fallback and SSR loading", async ({
  page,
  browser,
}) => {
  for (const width of [320, 375, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const route of [
      root,
      questionRoute,
      `${root}/reveal`,
      `${root}/report`,
      `${root}/poster`,
    ]) {
      await page.goto(route);
      await expectNoOverflow(page);
    }
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(questionRoute);
  await advance(page, 11);
  await page.addStyleTag({
    content:
      '#v2-question, #v2-question + p, [role="radio"] > span:last-child { font-size: 24px !important; }',
  });
  await expect(page.locator("#v2-question")).toHaveCSS("font-size", "24px");
  await expect(page.locator("#v2-question + p")).toHaveCSS("font-size", "24px");
  await expect(
    page.locator("[role=radio] > span:last-child").first(),
  ).toHaveCSS("font-size", "24px");
  await expectNoOverflow(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => localStorage.clear());
  await page.goto(root);
  expect(
    await page
      .locator("[data-v2c]")
      .evaluate((root) =>
        [...root.querySelectorAll<HTMLElement>("*")].every(
          (element) => getComputedStyle(element).animationName === "none",
        ),
      ),
  ).toBe(true);

  await page.route(
    "**/assets/themes/historical/visual-v2-c/room-1-*.webp",
    (route) => route.abort(),
  );
  await page.goto(root);
  await expect(page.locator('[data-image-state="missing"]')).toBeVisible();
  await expectNoOverflow(page);

  const ssr = await browser.newContext({ javaScriptEnabled: false });
  const loading = await ssr.newPage();
  await loading.goto(new URL(questionRoute, page.url()).href);
  await expect(loading.locator("[data-cabinet-questions]")).toHaveAttribute(
    "data-phase",
    "loading",
  );
  await ssr.close();
});
