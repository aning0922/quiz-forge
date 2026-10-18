import { expect, type Page, type TestInfo } from "@playwright/test";

export async function captureDraftMobile(
  page: Page,
  info: Pick<TestInfo, "outputPath">,
  state: string,
) {
  if (state === "draft-summary") {
    // The summary mounts a separate asynchronous history reader. Its first row is
    // part of this complete fixture state, not a later optional enhancement.
    const history = page.getByRole("region", {
      name: "草稿修订历史",
      exact: true,
    });
    await expect(history.locator('[data-history-revision="1"]')).toBeVisible();
    await expect(history.getByRole("status")).toHaveCount(0);
    await expect(
      history.getByRole("button", {
        name: "重新读取历史（新上界）",
        exact: true,
      }),
    ).toBeEnabled();
  }
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator("main")
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize) >= 16),
    ).toBe(true);
    for (const button of await page.getByRole("button").all()) {
      const box = await button.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    const height = await page.evaluate(() =>
      Math.max(innerHeight, document.documentElement.scrollHeight),
    );
    const screenshot = await page.screenshot({
      path: info.outputPath(`drafts-${state}-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    const afterHeight = await page.evaluate(() =>
      Math.max(innerHeight, document.documentElement.scrollHeight),
    );
    expect(afterHeight).toBe(height);
    expect(screenshot.readUInt32BE(16)).toBe(width);
    // The PNG must contain the complete state, not just the viewport captured
    // while a confirmed receipt is still refreshing the draft facts.
    expect(screenshot.readUInt32BE(20)).toBe(height);
  }
}
