import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const origin = process.env.QZTX_SCENES_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
  throw Error("OWNED_REFERENCE_ORIGIN_REQUIRED");
const out = path.resolve(`.cache/qztx-v11-reader-check/${Date.now()}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
});
const errors: string[] = [],
  writes: string[] = [],
  checks: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.method() !== "GET")
    writes.push(r.method() + " " + new URL(r.url()).pathname);
});
let passed = false;
try {
  await page.goto(`${origin}/?screen=result&probe=reader-contract`);
  await expect(page.locator("[data-reference-ready=true]")).toBeVisible();
  const port = page.locator("[data-qianzai-continuous-reader]");
  const toolbar = page.locator("[data-qianzai-report-toolbar]");
  const image = page.locator("[data-qianzai-screen=result] img").last();
  const originalImage = await image.elementHandle();
  const originalReport = await page
    .locator("[data-reader-contract-fixture]")
    .elementHandle();
  const originalBox = await image.boundingBox();
  await expect
    .poll(() => toolbar.evaluate((e) => e instanceof HTMLElement && e.inert))
    .toBe(true);
  await expect(toolbar).toHaveCSS("opacity", "0");
  // Native wheel enters the same scroll port; there is no gesture threshold jump.
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, 260);
  await expect
    .poll(() => port.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(200);
  const amount = await port.evaluate((e) => e.scrollTop);
  expect(amount).toBeLessThan(500);
  expect(await image.boundingBox()).toEqual(originalBox);
  expect(
    await toolbar.evaluate((e) => Number(getComputedStyle(e).opacity)),
  ).toBeGreaterThan(0);
  await page.screenshot({ path: path.join(out, "native-half-paper-390.png") });
  checks.push("native-partial-scroll-fixed-original-art-and-gradual-toolbar");
  await port.evaluate((e) => e.scrollTo({ top: 0, behavior: "instant" }));
  await expect
    .poll(() => toolbar.evaluate((e) => e instanceof HTMLElement && e.inert))
    .toBe(true);
  await page
    .getByRole("button", { name: "上滑查看人物报告", exact: true })
    .click();
  await expect(page.locator("[data-report-opening-title]")).toBeFocused();
  await expect.poll(() => port.evaluate((e) => e.scrollTop)).toBe(732);
  await expect(toolbar).toHaveCSS("opacity", "1");
  checks.push("arrow-focuses-opening-in-same-container");
  await toolbar
    .getByRole("button", { name: "返回人物揭晓", exact: true })
    .click();
  await expect.poll(() => port.evaluate((e) => e.scrollTop)).toBe(0);
  expect(await originalImage!.evaluate((e) => e.isConnected)).toBe(true);
  expect(await originalReport!.evaluate((e) => e.isConnected)).toBe(true);
  await expect(
    page.getByRole("button", { name: "上滑查看人物报告", exact: true }),
  ).toBeFocused();
  checks.push("return-is-reversible-and-preserves-mounted-reveal-and-report");
  await port.evaluate((e) => e.scrollTo({ top: 1600, behavior: "instant" }));
  const heading = page.locator("[data-reader-contract-fixture] h2").nth(1);
  const before = (await heading.boundingBox())!.y;
  await page.setViewportSize({ width: 390, height: 700 });
  await expect
    .poll(async () => Math.abs((await heading.boundingBox())!.y - before))
    .toBeLessThan(1);
  checks.push("height-remeasurement-preserves-current-paragraph");
  await page.goto(`${origin}/?screen=report&probe=reader-contract`);
  await expect(page.locator("[data-reference-ready=true]")).toBeVisible();
  await expect.poll(() => port.evaluate((e) => e.scrollTop)).toBe(588);
  const direct = await port.evaluate((e) => e.scrollTop);
  await port.evaluate((e) => {
    e.scrollTop += 500;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => port.evaluate((e) => e.scrollTop))
    .toBe(direct + 500 + 144);
  checks.push("direct-report-positions-once-and-does-not-reset-on-resize");
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  passed = true;
} finally {
  const result = {
    passed,
    scope:
      "B native reader shell with an explicit report-contract fixture; not A six-volume report, service, lease, or production acceptance",
    checks,
    errors,
    writes,
  };
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, out }));
  await browser.close();
}
