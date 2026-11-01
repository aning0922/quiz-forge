import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const origin = process.env.QZTX_SCENES_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
  throw Error("OWNED_REFERENCE_ORIGIN_REQUIRED");
const out = path.resolve(`.cache/qztx-question-layout/${Date.now()}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors: string[] = [],
  writes: string[] = [];
const checks: { name: string; detail?: unknown }[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.method() !== "GET")
    writes.push(r.method() + " " + new URL(r.url()).pathname);
});
let passed = false;
async function open(index: number) {
  await page.goto(`${origin}/?screen=question&index=${index}`);
  await expect(page.locator('[data-reference-ready="true"]')).toBeVisible();
}
async function inspect() {
  return page.locator("[data-qianzai-scroll-region]").evaluate((port) => {
    const stack = port.firstElementChild!,
      parent = stack.getBoundingClientRect();
    const geometry = [...stack.querySelectorAll("h2,label")].map((n) => {
      const b = n.getBoundingClientRect();
      return [b.x - parent.x, b.y - parent.y, b.width, b.height];
    });
    const text = [
      ...stack.querySelectorAll("h2,label>span:nth-of-type(2)"),
    ].map((n) => {
      const range = document.createRange();
      range.selectNodeContents(n);
      const b = n.getBoundingClientRect(),
        r = range.getBoundingClientRect();
      const lines = new Set(
        [...range.getClientRects()].map((v) => Math.round(v.top)),
      ).size;
      return {
        length: n.textContent!.length,
        font: parseFloat(getComputedStyle(n).fontSize),
        lines,
        fits: r.width <= b.width + 1 && r.height <= b.height + 1,
      };
    });
    const d = stack
        .querySelector("label:last-of-type")!
        .getBoundingClientRect(),
      clip = port.getBoundingClientRect();
    return {
      geometry,
      text,
      stackHeight: parent.height,
      portHeight: port.clientHeight,
      scrollHeight: port.scrollHeight,
      dVisible: d.top >= clip.top - 0.5 && d.bottom <= clip.bottom + 0.5,
      patterned: !!port
        .closest("[data-qianzai-screen]")!
        .querySelector("pattern"),
      touch: geometry.slice(1).every((b) => b[3]! >= 44),
      horizontal: document.documentElement.scrollWidth <= innerWidth,
    };
  });
}
function readable(view: Awaited<ReturnType<typeof inspect>>) {
  expect(view.text.every((t) => t.font >= 16 && t.fits)).toBe(true);
  expect(view.text.slice(1).every((t) => t.lines <= 2)).toBe(true);
  expect(view.touch).toBe(true);
  expect(view.horizontal).toBe(true);
  expect(view.patterned).toBe(false);
}
try {
  if (!process.argv.includes("--fade-only")) {
    if (!process.argv.includes("--representative-only")) {
      let geometry: number[][] | undefined;
      for (let i = 0; i < 24; i++) {
        await open(i);
        const view = await inspect();
        readable(view);
        geometry ??= view.geometry;
        expect(view.geometry).toEqual(geometry);
        expect(view.dVisible).toBe(true);
        expect(view.scrollHeight).toBe(view.portHeight);
      }
      checks.push({
        name: "390-all-24-common-geometry-full-text-two-line-options-and-D-visible",
        detail: geometry,
      });
    }
    await page.clock.install();
    for (const [width, height] of [
      [320, 568],
      [375, 812],
      [390, 844],
      [430, 932],
    ] as const) {
      await page.setViewportSize({ width, height });
      let expected: number[][] | undefined;
      for (const i of [0, 8, 16, 20, 21]) {
        await open(i);
        const view = await inspect();
        readable(view);
        expected ??= view.geometry;
        expect(view.geometry).toEqual(expected);
        if (width === 390 || width === 430) expect(view.dVisible).toBe(true);
        if (i === 0 || i === 8 || i === 16 || i === 21)
          await page.screenshot({
            path: path.join(out, `q${i + 1}-${width}.png`),
          });
      }
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      const first = page.locator("[data-qianzai-scroll-region] label").first();
      await first.scrollIntoViewIfNeeded();
      const before = await inspect();
      const scroll = await page
        .locator("[data-qianzai-scroll-region]")
        .evaluate((n) => n.scrollTop);
      await first.click();
      await expect(first.locator("input")).toBeChecked();
      expect((await inspect()).geometry).toEqual(before.geometry);
      expect(
        await page
          .locator("[data-qianzai-scroll-region]")
          .evaluate((n) => n.scrollTop),
      ).toBe(scroll);
      const port = page.locator("[data-qianzai-scroll-region]");
      await port.evaluate((n) => {
        n.scrollTop = n.scrollHeight;
      });
      expect((await inspect()).dVisible).toBe(true);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await page.screenshot({
        path: path.join(out, `selected-bottom-${width}.png`),
      });
      checks.push({
        name: `width-${width}-longest-and-three-acts-lower-scroll-and-no-selection-reflow`,
        detail: {
          geometry: expected,
          portHeight: before.portHeight,
          stackHeight: before.stackHeight,
        },
      });
      await page.clock.resume();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/?screen=result`);
  await expect(page.locator('[data-reference-ready="true"]')).toBeVisible();
  const full = page.locator("[data-qianzai-screen=result] img").last(),
    beforeImage = page.locator("[data-qianzai-screen=result] img").first();
  const beforeSrc = await beforeImage.getAttribute("src");
  await page
    .locator("[data-qianzai-continuous-reader]")
    .evaluate((n) =>
      (n as HTMLElement).style.setProperty(
        "--qianzai-reveal-copy-opacity",
        ".25",
      ),
    );
  await expect(full.locator("..")).toHaveCSS("opacity", "0.25");
  await page.evaluate(() =>
    (
      window as unknown as { qianzaiReference: { playReveal(): void } }
    ).qianzaiReference.playReveal(),
  );
  await expect(page.locator("[data-reveal-phase=playing]")).toBeAttached();
  expect(
    await full.evaluate((n) => getComputedStyle(n).animationName),
  ).toContain("reveal-identify");
  await expect(full.locator("..")).toHaveCSS("opacity", "0.25");
  expect(await beforeImage.getAttribute("src")).toBe(beforeSrc);
  await expect(beforeImage).toHaveCSS("opacity", "1");
  checks.push({
    name: "composite-full-wrapper-fades-without-replacing-inner-playing-animation-or-before-image",
  });
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  passed = true;
} finally {
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        passed,
        scope:
          "isolated React scene geometry with static 24-question definitions and exact prototype resources; no real controller, database, or author visual acceptance",
        checks,
        errors,
        writes,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed, out, checks, errors, writes }));
  await browser.close();
}
