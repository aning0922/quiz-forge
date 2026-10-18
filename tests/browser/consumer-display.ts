import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import { consumerDisplayFixture } from "@/features/theme/consumer-v1/fixtures.test-support";
import { PREVIEW_FONT_ASSET } from "@/features/product/preview/descriptor";

/** Static isolated actual-component harness; no business HTTP/DB/3100, no persistence claims. */
const root = process.cwd(),
  out = path.resolve(".cache/p4-consumer-display", String(Date.now()));
await mkdir(out, { recursive: true });
const f = await consumerDisplayFixture(),
  portrait = await readFile(
    "tests/fixtures/p3e-baseline/assets/portrait-1.png",
  ),
  neutral = await readFile(
    "tests/fixtures/p3e-baseline/assets/neutral-cover.png",
  );
const poster = structuredClone(f.poster);
Object.assign(poster.poster.portrait, {
  mediaType: "image/png",
  bytes: portrait.length,
  sha256: createHash("sha256").update(portrait).digest("hex"),
  width: 48,
  height: 48,
});
const fixture = {
  entry: f.entry,
  display: f.display,
  poster,
  font: PREVIEW_FONT_ASSET,
};
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
const esbuild = fromTsx("esbuild") as {
  build(options: Record<string, unknown>): Promise<unknown>;
};
await esbuild.build({
  entryPoints: [path.join(root, "tests/browser/consumer-display.client.tsx")],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  external: ["/assets/*"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "silent",
});
const files = new Map<string, { body: Uint8Array | string; type: string }>([
  [
    "/probe.js",
    {
      body: await readFile(path.join(out, "probe.js")),
      type: "text/javascript",
    },
  ],
  [
    "/probe.css",
    { body: await readFile(path.join(out, "probe.css")), type: "text/css" },
  ],
  ["/portrait.png", { body: portrait, type: "image/png" }],
  ["/neutral.png", { body: neutral, type: "image/png" }],
]);
for (const file of [PREVIEW_FONT_ASSET.file, PREVIEW_FONT_ASSET.coverage])
  files.set(file, {
    body: await readFile(path.join(root, "public", file)),
    type: file.endsWith("woff2") ? "font/woff2" : "text/plain",
  });
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>body{margin:0;padding:12px;font:16px/1.75 system-ui;background:#e9e6dd}header.probe{max-width:900px;margin:auto auto 16px;overflow-wrap:anywhere}#root{max-width:1080px;margin:auto}button,input{font:inherit}*{box-sizing:border-box}</style><header class="probe">纯组件合成验证 · 无持久化服务<br>已完成/保存状态为合成输入，不是实际报告证据。</header><main id="root"></main><script id="fixture" type="application/json">${JSON.stringify(fixture).replaceAll("<", "\\u003c")}</script><script src="/probe.js"></script></html>`;
files.set("/", { body: html, type: "text/html; charset=utf-8" });
const server = createServer((req, res) => {
  const file = files.get(req.url ?? "");
  if (!file) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": file.type,
    "cache-control": "no-store",
  });
  res.end(file.body);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const observations: unknown[] = [],
  shots: unknown[] = [];
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await expect(page.locator("[data-consumer-state=cover]")).toBeVisible();
  type ProbeWindow = Window & {
    renderConsumerProbe: (
      state: string,
      variant: string,
      reason?: string,
    ) => void;
    consumerEvents: string[];
    exportConsumerProbe: (mode: string) => Promise<number[]>;
  };
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    for (const variant of width === 320
      ? ["normal", "long", "missing", "loading", "saved"]
      : ["normal"])
      for (const state of [
        "cover",
        "question",
        "resume",
        "result",
        "report",
        "poster",
      ]) {
        if (
          variant === "saved" &&
          !["cover", "question", "resume"].includes(state)
        )
          continue;
        await page.evaluate(
          ({ state, variant }) =>
            (window as unknown as ProbeWindow).renderConsumerProbe(
              state,
              variant,
            ),
          { state, variant },
        );
        await expect(
          page.locator(`[data-consumer-state=${state}]`),
        ).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const geometry = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          smallTargets: [...document.querySelectorAll("button")].filter(
            (b) => b.getBoundingClientRect().height < 44,
          ).length,
          smallBody: [
            ...document.querySelectorAll("main p,main label,main li"),
          ].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length,
        }));
        expect(geometry.scroll).toBeLessThanOrEqual(width);
        expect(geometry.smallTargets).toBe(0);
        expect(geometry.smallBody).toBe(0);
        const file = `${state}-${variant}-${width}.png`;
        await page.screenshot({ path: path.join(out, file), fullPage: true });
        shots.push({ file, state, variant, ...geometry });
      }
  }
  for (const reason of [
    "saving",
    "unknown",
    "conflict",
    "authority-lost",
    "unavailable",
  ])
    for (const state of ["cover", "question", "resume"]) {
      await page.evaluate(
        ({ state, reason }) =>
          (window as unknown as ProbeWindow).renderConsumerProbe(
            state,
            "normal",
            reason,
          ),
        { state, reason },
      );
      await expect(
        page.locator(`[data-consumer-save=${reason}]`),
      ).toBeVisible();
      expect(
        await page.locator("main button:enabled,main input:enabled").count(),
      ).toBe(0);
    }
  await page.evaluate(() =>
    (window as unknown as ProbeWindow).renderConsumerProbe(
      "question",
      "normal",
    ),
  );
  await expect(page.locator("[data-consumer-state=question]")).toBeVisible();
  await page.locator("input[type=radio]").last().click();
  expect(
    (
      await page.evaluate(
        () => (window as unknown as ProbeWindow).consumerEvents,
      )
    ).some((e) => e.startsWith("choose:")),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const state of [
    "cover",
    "question",
    "resume",
    "result",
    "report",
    "poster",
  ]) {
    await page.evaluate(
      (state) =>
        (window as unknown as ProbeWindow).renderConsumerProbe(state, "normal"),
      state,
    );
    await expect(page.locator(`[data-consumer-state=${state}]`)).toBeVisible();
    expect(
      await page
        .locator("main")
        .evaluate((e) =>
          [...e.querySelectorAll("*")].some(
            (n) => getComputedStyle(n).animationName !== "none",
          ),
        ),
    ).toBe(false);
  }
  const bytes = await page.evaluate(() =>
    (window as unknown as ProbeWindow).exportConsumerProbe("normal"),
  );
  await writeFile(
    path.join(out, "consumer-export-1080x1920.png"),
    new Uint8Array(bytes),
  );
  const meta = await sharp(new Uint8Array(bytes)).metadata();
  expect([meta.width, meta.height, meta.format]).toEqual([1080, 1920, "png"]);
  for (const mode of ["wrong-hash", "missing-font", "stale"]) {
    const failed = await page.evaluate(async (mode) => {
      try {
        await (window as unknown as ProbeWindow).exportConsumerProbe(mode);
        return false;
      } catch {
        return true;
      }
    }, mode);
    expect(failed).toBe(true);
    observations.push({ mode, failed });
  }
  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        qualification:
          "Actual pure components and real Canvas PNG; synthetic data/pixels/status only; no business HTTP/controller/DB/3100/native/persistence acceptance",
        browser: browser.version(),
        shots,
        blockedCases: 15,
        reducedMotionStates: 6,
        callbackObserved: true,
        png: {
          file: "consumer-export-1080x1920.png",
          width: meta.width,
          height: meta.height,
          bytes: bytes.length,
        },
        negativeExports: observations,
        pageErrors: errors,
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      output: out,
      shots: shots.length,
      blockedCases: 15,
      passed: true,
    }),
  );
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
