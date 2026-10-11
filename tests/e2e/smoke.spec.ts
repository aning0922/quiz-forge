import { test, expect } from "@playwright/test";

const routes = [
  ["/", "每一种性格，"],
  ["/themes", "主题研究室"],
  ["/themes/historical", "历史人物匹配"],
  ["/themes/sins", "七宗罪趣味人格"],
  ["/themes/animals", "动物人格匹配"],
] as const;

for (const [route, title] of routes) {
  test(`production route ${route} renders without overflow or runtime errors`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
    await expect(
      page.getByText("D0 工程预览 · 临时演示数据 · 非已发布商品"),
    ).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (route === "/themes/sins") {
      await expect(
        page.getByText("仅供娱乐与自我探索，不作为心理诊断。"),
      ).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath("page.png"),
      fullPage: true,
    });
    await testInfo.attach("D0 browser screenshot", {
      path: testInfo.outputPath("page.png"),
      contentType: "image/png",
    });
    expect(errors).toEqual([]);
  });
}

test("entry links lead to a theme and back to the lab", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "走进主题研究室" }).click();
  await expect(page).toHaveURL(/\/themes$/);
  await page.getByRole("link", { name: "查看历史人物匹配设计方向" }).click();
  await expect(page).toHaveURL(/\/themes\/historical$/);
  await page.getByRole("link", { name: "所有主题" }).click();
  await expect(page).toHaveURL(/\/themes$/);
});

test("unknown theme returns 404 instead of silently picking a product", async ({
  page,
}) => {
  const response = await page.goto("/themes/unknown");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "这个世界还未开启" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回主题研究室" }).click();
  await expect(page).toHaveURL(/\/themes$/);
});

test("keyboard skip link reaches the main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "跳转到主要内容" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("reduced motion keeps the whole page visible with minimal transitions", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const duration = await page
    .getByRole("link", { name: "走进主题研究室" })
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(duration.split(",").every((value) => parseFloat(value) <= 0.001)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("reduced-motion.png"),
    fullPage: true,
  });
});

test("320px layout has no horizontal overflow across every D0 route", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const [route] of routes) {
    await page.goto(route);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      route,
    ).toBe(true);
  }
});
