import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.D1C_BASE_URL ?? "http://127.0.0.1:3100";
const output = "docs/qa/d1c";
const routes = ["", "/question", "/reveal", "/report", "/poster"];
await mkdir(output, { recursive: true });

const browser = await chromium.launch();
const results = [];
const runs = [
  { mode: "cold", samples: 3, emulation: null },
  {
    mode: "slow-4g-diagnostic",
    samples: 1,
    emulation: {
      latency: 150,
      downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8),
      uploadThroughput: Math.round((0.75 * 1024 * 1024) / 8),
      cpuRate: 4,
    },
  },
];

for (const run of runs) {
  for (let sample = 1; sample <= run.samples; sample += 1) {
    for (const suffix of routes) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      if (run.emulation) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: run.emulation.latency,
          downloadThroughput: run.emulation.downloadThroughput,
          uploadThroughput: run.emulation.uploadThroughput,
          connectionType: "cellular4g",
        });
        await cdp.send("Emulation.setCPUThrottlingRate", {
          rate: run.emulation.cpuRate,
        });
      }
      await page.addInitScript(() => {
        const vitals = { lcp: null, cls: 0, lcpEntries: [], layoutShifts: [] };
        window.__visualV2CVitals = vitals;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            vitals.lcp = entry.startTime;
            vitals.lcpEntries.push({
              startTime: entry.startTime,
              size: entry.size,
              url: entry.url || null,
            });
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) continue;
            vitals.cls += entry.value;
            vitals.layoutShifts.push({
              value: entry.value,
              startTime: entry.startTime,
              sources: [...entry.sources].map((source) => ({
                node: source.node
                  ? {
                      tag: source.node.tagName,
                      id: source.node.id || null,
                      className: source.node.className || null,
                      dataV2c: source.node.getAttribute?.("data-v2c") ?? null,
                    }
                  : null,
                previousRect: source.previousRect
                  ? {
                      x: source.previousRect.x,
                      y: source.previousRect.y,
                      width: source.previousRect.width,
                      height: source.previousRect.height,
                    }
                  : null,
                currentRect: source.currentRect
                  ? {
                      x: source.currentRect.x,
                      y: source.currentRect.y,
                      width: source.currentRect.width,
                      height: source.currentRect.height,
                    }
                  : null,
              })),
            });
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      const response = await page.goto(`${base}/studies/visual-v2-c${suffix}`, {
        waitUntil: "load",
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1_500);
      const metrics = await page.evaluate(async () => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const resources = performance
          .getEntriesByType("resource")
          .map((entry) => ({
            name: entry.name,
            initiatorType: entry.initiatorType,
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
            decodedBodySize: entry.decodedBodySize,
            duration: entry.duration,
          }))
          .filter((entry) =>
            /\/_next\/|\/assets\/|\.woff|\.ttf|\.otf/.test(entry.name),
          );
        return {
          navigation: navigation
            ? {
                responseStart: navigation.responseStart,
                domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
                loadEventEnd: navigation.loadEventEnd,
                transferSize: navigation.transferSize,
                encodedBodySize: navigation.encodedBodySize,
                decodedBodySize: navigation.decodedBodySize,
              }
            : null,
          vitals: window.__visualV2CVitals,
          fonts: {
            status: document.fonts.status,
            count: [...document.fonts].length,
          },
          scroll: await new Promise((resolve) => {
            const max = Math.max(
              0,
              document.documentElement.scrollHeight - innerHeight,
            );
            const stamps = [];
            let frame = 0;
            const step = () => {
              stamps.push(performance.now());
              if (frame >= 24 || max === 0) {
                const gaps = stamps
                  .slice(1)
                  .map((stamp, index) => stamp - stamps[index]);
                resolve({
                  scrollHeight: document.documentElement.scrollHeight,
                  scrollRange: max,
                  frameCount: stamps.length,
                  maxFrameGap: gaps.length ? Math.max(...gaps) : 0,
                  p95FrameGap: gaps.length
                    ? [...gaps].sort((a, b) => a - b)[
                        Math.floor((gaps.length - 1) * 0.95)
                      ]
                    : 0,
                });
                return;
              }
              window.scrollTo(0, (max * frame) / 24);
              frame += 1;
              requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          }),
          resources,
        };
      });
      results.push({
        route: `/studies/visual-v2-c${suffix || "/"}`,
        mode: run.mode,
        sample,
        emulation: run.emulation,
        status: response?.status() ?? null,
        browser: browser.version(),
        cacheMode: "fresh browser context per route",
        metrics,
      });
      await context.close();
    }
  }
}

await browser.close();
const budget = {
  imageTransferBytes: 200 * 1024,
  fontTransferBytes: 220 * 1024,
  fontRequests: 1,
  initialTransferBytes: 650 * 1024,
  lcpMs: 2_500,
  cls: 0.1,
  scrollP95FrameGapMs: 35,
};
const violations = [];
for (const result of results.filter((result) => result.mode === "cold")) {
  const resources = result.metrics.resources;
  const images = resources.filter(
    (resource) => resource.initiatorType === "img",
  );
  const fonts = resources.filter((resource) =>
    /\.woff|\.ttf|\.otf/.test(resource.name),
  );
  for (const image of images)
    if (image.transferSize > budget.imageTransferBytes)
      violations.push(
        `${result.route}: image over ${budget.imageTransferBytes} bytes: ${image.name}`,
      );
  if (fonts.length > budget.fontRequests)
    violations.push(
      `${result.route}: requested ${fonts.length} font resources`,
    );
  const fontBytes = fonts.reduce(
    (total, resource) => total + resource.transferSize,
    0,
  );
  if (fontBytes > budget.fontTransferBytes)
    violations.push(`${result.route}: fonts total ${fontBytes} bytes`);
  const totalTransfer =
    (result.metrics.navigation?.transferSize ?? 0) +
    resources.reduce((total, resource) => total + resource.transferSize, 0);
  if (totalTransfer > budget.initialTransferBytes)
    violations.push(`${result.route}: initial transfer ${totalTransfer} bytes`);
  if (typeof result.metrics.vitals.lcp !== "number")
    violations.push(`${result.route}: LCP unavailable in this browser sample`);
  else if (result.metrics.vitals.lcp > budget.lcpMs)
    violations.push(`${result.route}: LCP ${result.metrics.vitals.lcp}ms`);
  if (result.metrics.vitals.cls > budget.cls)
    violations.push(`${result.route}: CLS ${result.metrics.vitals.cls}`);
  if (result.metrics.scroll.p95FrameGap > budget.scrollP95FrameGapMs)
    violations.push(
      `${result.route}: scroll p95 ${result.metrics.scroll.p95FrameGap}ms`,
    );
}
const percentile = (values, ratio) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * ratio)] ?? null;
};
const summaries = routes.map((suffix) => {
  const route = `/studies/visual-v2-c${suffix || "/"}`;
  const cold = results.filter(
    (result) => result.mode === "cold" && result.route === route,
  );
  const value = (selector) => cold.map(selector).filter(Number.isFinite);
  return {
    route,
    coldSamples: cold.length,
    median: {
      lcpMs: percentile(
        value((result) => result.metrics.vitals.lcp),
        0.5,
      ),
      cls: percentile(
        value((result) => result.metrics.vitals.cls),
        0.5,
      ),
      scrollP95FrameGapMs: percentile(
        value((result) => result.metrics.scroll.p95FrameGap),
        0.5,
      ),
    },
    max: {
      lcpMs: Math.max(...value((result) => result.metrics.vitals.lcp)),
      cls: Math.max(...value((result) => result.metrics.vitals.cls)),
      scrollP95FrameGapMs: Math.max(
        ...value((result) => result.metrics.scroll.p95FrameGap),
      ),
    },
  };
});
await writeFile(
  `${output}/performance.json`,
  JSON.stringify(
    {
      measuredOn: "2026-10-11 Asia/Shanghai",
      base,
      caveat:
        "Local production-server sampling. Transfer and timing values are reproducible here but are not mobile-network or real-user measurements.",
      budget,
      violations,
      summaries,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Measured ${results.length} Visual V2-C route samples (${runs[0].samples} cold samples per route plus one slow-4G diagnostic).`,
);
if (violations.length) {
  console.error(`Budget violations:\n${violations.join("\n")}`);
  process.exitCode = 1;
}
