import { chromium, webkit } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const base = process.env.D1C_BASE_URL ?? "http://127.0.0.1:3100";
const directory = "docs/qa/d1c";
const results = [];
for (const [engine, implementation] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await implementation.launch();
  for (const sample of ["default", "long", "original"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.addInitScript(() => {
      const drawn = [];
      window.__d1cDrawn = drawn;
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (
        text,
        x,
        y,
        maxWidth,
      ) {
        const metrics = this.measureText(text);
        drawn.push({
          text,
          font: this.font,
          x,
          y,
          width: metrics.width,
          actualTop: y - metrics.actualBoundingBoxAscent,
          actualBottom: y + metrics.actualBoundingBoxDescent,
        });
        if (maxWidth === undefined) original.call(this, text, x, y);
        else original.call(this, text, x, y, maxWidth);
      };
    });
    const route =
      sample === "default"
        ? "/studies/visual-v2-c/poster"
        : `/studies/visual-v2-c/poster/checks?sample=${sample}`;
    await page.goto(base + route);
    const started = Date.now();
    await page
      .getByRole("button", { name: "生成 PNG 海报", exact: true })
      .click();
    await page.locator("[data-generated-poster]").waitFor();
    const ms = Date.now() - started;
    const bitmap = await page
      .locator("[data-generated-poster]")
      .evaluate(async (image) => {
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          sampleAlpha: [
            [0, 0],
            [540, 450],
            [90, 1800],
            [540, 1900],
          ].map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]),
        };
      });
    const text = await page.evaluate(() => window.__d1cDrawn);
    const waiting = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "下载 PNG 海报", exact: true })
      .click();
    const download = await waiting;
    const name = `historical-${sample}-1080x1920-${engine}.png`;
    await download.saveAs(`${directory}/${name}`);
    const bytes = await readFile(`${directory}/${name}`);
    if (
      bytes.readUInt32BE(16) !== 1080 ||
      bytes.readUInt32BE(20) !== 1920 ||
      bitmap.width !== 1080 ||
      bitmap.height !== 1920 ||
      bitmap.sampleAlpha.some((alpha) => alpha !== 255) ||
      text.some((line) => line.width > 900 || line.actualBottom > 1868) ||
      failures.length
    )
      throw new Error(`Export check failed: ${engine} ${sample}`);
    results.push({
      engine,
      browser: browser.version(),
      sample,
      route,
      name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      generationMs: ms,
      bitmap,
      draw: text,
      pageErrors: failures,
      caveat:
        "Local production build, DPR1; engine tests are not actual phone save/share confirmation.",
    });
    if (sample === "default") {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: `${directory}/poster-${engine}-390x844-generated-full.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
    await context.close();
  }
  await browser.close();
}
await writeFile(
  `${directory}/export-results.json`,
  JSON.stringify({ measuredOn: "2026-10-11 Asia/Shanghai", results }, null, 2) +
    "\n",
);
console.log(
  JSON.stringify(
    results.map(({ engine, sample, bytes, generationMs, bitmap }) => ({
      engine,
      sample,
      bytes,
      generationMs,
      bitmap,
    })),
  ),
);
