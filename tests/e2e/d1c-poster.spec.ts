import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { historicalDisplayFixture } from "../../src/features/report/historical-display-fixture";

const poster = "/studies/visual-v2-c/poster";
const font = "**/assets/fonts/visual-v2-c/serif-600.woff2";
const figure = "**/assets/themes/historical/visual-v2-c/figure-960.webp";
const generated = "[data-generated-poster]";

async function assertPng(buffer: Buffer) {
  expect(buffer.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(buffer.toString("ascii", 12, 16)).toBe("IHDR");
  expect(buffer.readUInt32BE(16)).toBe(1080);
  expect(buffer.readUInt32BE(20)).toBe(1920);
  expect(buffer.length).toBeGreaterThan(100_000);
}

test("generates the actual poster PNG, keeps shared values and downloads the same image", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const capture: string[] = [];
    Object.assign(window, { __posterText: capture });
    const draw = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      x,
      y,
      maxWidth,
    ) {
      capture.push(text);
      if (maxWidth === undefined) draw.call(this, text, x, y);
      else draw.call(this, text, x, y, maxWidth);
    };
  });
  await page.goto(poster);
  await page
    .getByRole("button", { name: "生成 PNG 海报", exact: true })
    .click();
  const image = page.locator(generated);
  await expect(image).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "PNG 已生成" }),
  ).toBeVisible();
  expect(
    await image.evaluate(async (node) => {
      const img = node as HTMLImageElement;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }),
  ).toEqual([1080, 1920]);
  const texts = await page.evaluate(
    () => (window as unknown as { __posterText: string[] }).__posterText,
  );
  expect(texts).toContain(historicalDisplayFixture.report.identity.name);
  expect(texts.join("")).toContain(
    historicalDisplayFixture.report.identity.title,
  );
  for (const line of historicalDisplayFixture.inscription!.lines)
    expect(texts.join("")).toContain(line);
  expect(texts.join("")).toContain("探索 88/100");
  expect(texts.join("")).toContain("表达 82/100");
  expect(texts.join("")).toContain(
    "合成演示 · 非答题结论 · 娱乐性格测评 · 非心理诊断",
  );
  expect(texts.join("")).not.toMatch(
    /AccessKey|session|原始答案|下载 PNG|上一题|下一题/i,
  );
  const waiting = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载 PNG 海报", exact: true }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toMatch(/demo-1080x1920\.png$/);
  const destination = testInfo.outputPath("actual-poster.png");
  await download.saveAs(destination);
  await assertPng(await readFile(destination));
  await expect(
    page.getByRole("status").filter({ hasText: "已发起 PNG 下载" }),
  ).toBeVisible();
});

test("image failure is clear and retry generates a new complete work", async ({
  page,
}) => {
  await page.route(figure, (route) => route.abort());
  await page.goto(poster);
  await page
    .getByRole("button", { name: "生成 PNG 海报", exact: true })
    .click();
  await expect(
    page.locator("[data-poster-export]").getByRole("alert"),
  ).toContainText("人物画作加载失败");
  await expect(page.locator(generated)).toHaveCount(0);
  await page.unroute(figure);
  await page.getByRole("button", { name: "重试生成 PNG", exact: true }).click();
  await expect(page.locator(generated)).toBeVisible();
  // Failed regeneration clears the old download instead of claiming new success.
  // WebKit may reuse a decoded image without another network request. Inject a
  // decoder failure here; the first failure above still uses a real failed request.
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      if (this.src.includes("figure-960.webp"))
        return Promise.reject(
          new DOMException("Synthetic decoder failure", "EncodingError"),
        );
      return decode.call(this);
    };
  });
  await page.getByRole("button", { name: "重新生成 PNG", exact: true }).click();
  await expect(
    page.locator("[data-poster-export]").getByRole("alert"),
  ).toContainText("人物画作加载失败");
  await expect(
    page.getByRole("link", { name: "下载 PNG 海报", exact: true }),
  ).toHaveCount(0);
});

test("font failure, unsupported glyph and unknown artwork fail honestly", async ({
  page,
}) => {
  await page.route(font, (route) => route.abort());
  await page.goto(poster);
  await page
    .getByRole("button", { name: "生成 PNG 海报", exact: true })
    .click();
  await expect(
    page.locator("[data-poster-export]").getByRole("alert"),
  ).toContainText("字体加载失败");
  await expect(page.locator(generated)).toHaveCount(0);
  await page.unroute(font);
  await page.getByRole("button", { name: "重试生成 PNG", exact: true }).click();
  await expect(page.locator(generated)).toBeVisible();
  for (const [sample, error] of [
    ["glyph", "字体不包含"],
    ["unknown", "人物画作未登记"],
  ]) {
    await page.goto(`${poster}/checks?sample=${sample}`);
    await page
      .getByRole("button", { name: "生成 PNG 海报", exact: true })
      .click();
    await expect(
      page.locator("[data-poster-export]").getByRole("alert"),
    ).toContainText(error!);
    await expect(page.locator(generated)).toHaveCount(0);
  }
});

test("long identity, title and original verse wrap in a real PNG", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`${poster}/checks?sample=long`);
  await page
    .getByRole("button", { name: "生成 PNG 海报", exact: true })
    .click();
  await expect(page.locator(generated)).toBeVisible();
  expect(
    await page.locator(generated).evaluate(async (node) => {
      const img = node as HTMLImageElement;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }),
  ).toEqual([1080, 1920]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("repeat generate and canceled/unsupported file shares do not race or claim album success", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, { __pngEncodes: 0, __fileShares: 0 });
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      const probe = window as unknown as { __pngEncodes: number };
      probe.__pngEncodes++;
      encode.call(this, callback, type, quality);
    };
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const probe = window as unknown as { __fileShares: number };
        probe.__fileShares++;
        if (!data.files?.length || data.files[0]!.type !== "image/png")
          throw new Error("Expected PNG file");
        throw new DOMException("User canceled", "AbortError");
      },
    });
  });
  await page.route(figure, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });
  await page.goto(poster);
  const button = page.getByRole("button", {
    name: "生成 PNG 海报",
    exact: true,
  });
  await button.evaluate((el) => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.locator(generated)).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __pngEncodes: number }).__pngEncodes,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "分享 PNG", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已取消分享" }),
  ).toBeVisible();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => false,
    }),
  );
  await page.getByRole("button", { name: "分享 PNG", exact: true }).click();
  await expect(
    page.locator("[data-poster-export]").getByRole("alert"),
  ).toContainText("不支持图片文件分享");
  await expect(
    page.getByRole("link", { name: "下载 PNG 海报", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __fileShares: number }).__fileShares,
    ),
  ).toBe(1);
});

test("PNG encoding failures can retry, and object URLs are released on regeneration and leaving", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const probe = { failEncoding: true, created: 0, revoked: 0 };
    Object.assign(window, { __posterLifecycle: probe });
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (probe.failEncoding) {
        callback(null);
        return;
      }
      encode.call(this, callback, type, quality);
    };
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = (value) => {
      probe.created++;
      return create(value);
    };
    URL.revokeObjectURL = (value) => {
      probe.revoked++;
      revoke(value);
    };
  });
  await page.goto(poster);
  await page
    .getByRole("button", { name: "生成 PNG 海报", exact: true })
    .click();
  await expect(
    page.locator("[data-poster-export]").getByRole("alert"),
  ).toContainText("PNG 编码失败");
  await page.evaluate(() => {
    (
      window as unknown as { __posterLifecycle: { failEncoding: boolean } }
    ).__posterLifecycle.failEncoding = false;
  });
  await page.getByRole("button", { name: "重试生成 PNG", exact: true }).click();
  await expect(page.locator(generated)).toBeVisible();
  await page.getByRole("button", { name: "重新生成 PNG", exact: true }).click();
  await expect(page.locator(generated)).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __posterLifecycle: { created: number; revoked: number };
          }
        ).__posterLifecycle,
    ),
  ).toMatchObject({ created: 2, revoked: 1 });
  await page.getByRole("link", { name: "返回完整人物志", exact: true }).click();
  await expect(page).toHaveURL(/\/report$/);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __posterLifecycle: { revoked: number } })
          .__posterLifecycle.revoked,
    ),
  ).toBe(2);
});
