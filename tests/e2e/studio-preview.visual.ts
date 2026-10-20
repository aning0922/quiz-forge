import { expect, type Page, type TestInfo } from "@playwright/test";
import { sampleStudioLayout, assertStudioLayout } from "./studio-layout";

export async function waitForPreviewCaptureReady(page: Page, state: string) {
  const surface = page.locator(`[data-preview-state="${state}"]`);
  await expect(surface).toHaveCount(1);
  await expect(surface).toBeVisible();
  // The actual state-transition rAF scrolls the surface, then focuses this
  // heading. DOM visibility alone precedes that callback; await its observable
  // completion before applying the screenshot's deliberate page-top framing.
  const heading = surface.locator("[data-preview-heading]");
  await expect(heading).toHaveCount(1);
  await expect(heading).toBeFocused();
  if (state !== "resume") {
    const image = surface.locator("img");
    await expect(image).toHaveCount(1);
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (img) =>
            img instanceof HTMLImageElement &&
            img.complete &&
            img.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

export async function capturePreviewMobile(
  page: Page,
  info: TestInfo,
  state: string,
) {
  await waitForPreviewCaptureReady(page, state);
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    assertStudioLayout(
      await sampleStudioLayout(page, {
        fontSelector: "[data-preview-state] p",
        buttonRoleWithin: "html",
        appliedReceipts: false,
        above:
          state === "question"
            ? [["[data-preview-approval]", "[data-preview-scene-caption]"]]
            : [],
      }),
    );
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    const png = await page.screenshot({
      path: info.outputPath(`preview-${state}-${width}.png`),
      fullPage: true,
    });
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(
      await page.evaluate(() =>
        Math.max(innerHeight, document.documentElement.scrollHeight),
      ),
    );
  }
}
