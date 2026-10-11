import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.VISUAL_V2_B_BASE_URL ?? "http://127.0.0.1:3102";
const output = "docs/qa/visual-v2-b";
const browser = await chromium.launch();
const records = [];
await mkdir(output, { recursive: true });

const url = (direction, view, query = "") =>
  `${base}/studies/visual-v2-b/${direction}/${view}${query}`;

async function waitForArt(page) {
  await page.evaluate(() => document.fonts.ready);
  for (const image of await page.locator("img").all()) {
    const visible = await image.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    if (!visible) continue;
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element) => element.decode().catch(() => undefined));
  }
  await page.waitForFunction(() =>
    [...document.images]
      .filter((image) => {
        const box = image.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .every((image) => image.complete && image.naturalWidth > 0),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[data-artwork]")].every(
      (artwork) => artwork.getAttribute("data-artwork-state") !== "loading",
    ),
  );
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function capture(
  page,
  direction,
  state,
  width,
  height,
  kind = "full",
  selector,
) {
  await waitForArt(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow)
    throw new Error(`Overflow: ${direction} ${state} ${width}x${height}`);
  const name = `${direction}-${state}-${width}x${height}-${kind}.png`;
  if (selector) {
    await page.locator(selector).screenshot({
      path: `${output}/${name}`,
      animations: "disabled",
    });
  } else {
    await page.screenshot({
      path: `${output}/${name}`,
      fullPage: kind === "full",
      animations: "disabled",
    });
  }
  records.push({
    name,
    direction,
    state,
    viewport: { width, height },
    kind,
    browser: browser.version(),
    overflow: false,
  });
}

async function captureContinuity(page, direction) {
  await waitForArt(page);
  const transitionTop = await page
    .locator("[data-report-transition]")
    .evaluate((element) => element.offsetTop);
  const scrollY = Math.max(0, transitionTop - 280);
  await page.evaluate((top) => window.scrollTo(0, top), scrollY);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error(`Overflow: ${direction} report continuity`);
  const name = `${direction}-report-continuity-390x844-viewport.png`;
  await page.screenshot({ path: `${output}/${name}`, animations: "disabled" });
  records.push({
    name,
    direction,
    state: "report-continuity",
    viewport: { width: 390, height: 844 },
    kind: "viewport",
    scrollY,
    browser: browser.version(),
    overflow: false,
  });
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const direction of ["landscape", "celestial"]) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  for (const view of ["reveal", "report", "poster"]) {
    await page.goto(url(direction, view));
    await capture(page, direction, view, 390, 844, "first");
    await capture(page, direction, view, 390, 844, "full");
  }
  await page.goto(url(direction, "report"));
  await capture(
    page,
    direction,
    "report-art-atlas",
    390,
    844,
    "component",
    "[data-report-transition]",
  );
  await captureContinuity(page, direction);
  await page.goto(url(direction, "poster"));
  await capture(
    page,
    direction,
    "poster-collectible",
    390,
    844,
    "component",
    "[data-collectible]",
  );

  for (const [width, height] of [
    [320, 740],
    [375, 812],
    [430, 932],
    [1440, 1000],
  ]) {
    await page.setViewportSize({ width, height });
    for (const view of ["reveal", "report", "poster"]) {
      await page.goto(url(direction, view));
      await capture(page, direction, view, width, height, "first");
    }
  }

  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(url(direction, "report", "?sample=long"));
  await capture(page, direction, "report-long", 320, 740, "full");
  await page.goto(url(direction, "poster", "?sample=long"));
  await capture(page, direction, "poster-long", 320, 740, "full");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url(direction, "reveal"));
  await capture(page, direction, "reveal-reduced-motion", 390, 844, "full");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.route(
    `**/assets/themes/historical/visual-v2-b/li-bai-${direction}.webp`,
    (route) => route.abort(),
  );
  await page.goto(url(direction, "reveal"));
  await capture(page, direction, "reveal-art-unavailable", 390, 844, "full");
  await page.unroute(
    `**/assets/themes/historical/visual-v2-b/li-bai-${direction}.webp`,
  );
  await page.close();
}

await browser.close();
await writeFile(
  `${output}/records.json`,
  JSON.stringify({ capturedOn: "2026-10-11 Asia/Shanghai", records }, null, 2) +
    "\n",
);
console.log(
  `Captured ${records.length} production browser screenshots without horizontal overflow.`,
);
