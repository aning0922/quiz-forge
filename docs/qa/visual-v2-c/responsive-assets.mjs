import { chromium } from "@playwright/test";
import { mkdir, stat, writeFile } from "node:fs/promises";

const base = process.env.VISUAL_V2_C_BASE_URL ?? "http://127.0.0.1:3102";
const output = "docs/qa/visual-v2-c";
const routes = ["/question", "/reveal", "/report"];
const browser = await chromium.launch();
const records = [];
await mkdir(output, { recursive: true });

for (const deviceScaleFactor of [2, 3]) {
  for (const route of routes) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor,
    });
    const page = await context.newPage();
    await page.goto(`${base}/studies/visual-v2-c${route}`);
    await page.waitForFunction(() =>
      [...document.images].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    for (const image of await page.locator("img").all()) {
      const currentSrc = await image.evaluate((element) => element.currentSrc);
      const path = new URL(currentSrc).pathname;
      let bytes = null;
      if (path.startsWith("/assets/")) {
        try {
          bytes = (await stat(`public${path}`)).size;
        } catch {
          bytes = null;
        }
      }
      records.push({ route, deviceScaleFactor, currentSrc, path, bytes });
    }
    await context.close();
  }
}

await browser.close();
await writeFile(
  `${output}/responsive-assets.json`,
  JSON.stringify(
    {
      measuredOn: "2026-10-11 Asia/Shanghai",
      base,
      caveat:
        "390 CSS px diagnostics at DPR 2 and 3. These records describe selected local source files, not the DPR 1 initial-transfer budget.",
      records,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Recorded ${records.length} high-DPR selected image sources.`);
