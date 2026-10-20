import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect, type Page, type TestInfo } from "@playwright/test";
import {
  previewFixture,
  sourceBinding,
  answers,
} from "@/features/theme/preview/fixtures.test-support";
import {
  preparePreviewContent,
  scorePreview,
} from "@/features/theme/preview/projection";
import { previewScoreRequestSchema } from "@/features/product/preview/contracts";
import { PREVIEW_FONT_ASSET } from "@/features/product/preview/descriptor";
import { capturePreviewMobile } from "../e2e/studio-preview.visual";

// Actual React preview + original focus/scroll effect; synthetic HTTP only.
// Hold the existing requested animation-frame callback to prove the causal
// boundary. No production component, focus API, DB, Next or 3100 is changed.
declare global {
  interface Window {
    previewFrameProbe: {
      hold: boolean;
      pending: FrameRequestCallback[];
      events: { phase: string; y: number; focused: boolean }[];
      release(): void;
    };
  }
}
const out = path.resolve(".cache/p4-preview-capture", String(Date.now()));
await mkdir(out, { recursive: true });
const content = await previewFixture();
const pixels = await readFile(
  "tests/fixtures/p3e-baseline/assets/neutral-cover.png",
);
for (const r of content.resources)
  Object.assign(r, {
    path: r.path.replace(/\.[^.]+$/, ".png"),
    mediaType: "image/png",
    bytes: pixels.length,
    sha256: createHash("sha256").update(pixels).digest("hex"),
    width: 48,
    height: 48,
  });
const binding = sourceBinding(content),
  prepared = preparePreviewContent(content, binding);
if (!prepared.ok) throw Error("SYNTHETIC_PREVIEW_PREPARATION_FAILED");
const entry = prepared.value.entry;
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await fromTsx("esbuild").build({
  entryPoints: [
    path.resolve("tests/browser/studio-preview-capture.client.tsx"),
  ],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  logLevel: "silent",
  external: ["/assets/*"],
  // Same bounded probe shim as studio-drafts-capture: the legacy server-only
  // policy import is not invoked by this client. Any accidental call fails.
  plugins: [
    {
      name: "unused-node-policy-branch",
      setup(build: {
        onResolve: (
          options: { filter: RegExp },
          callback: () => unknown,
        ) => void;
        onLoad: (
          options: { filter: RegExp; namespace: string },
          callback: () => unknown,
        ) => void;
      }) {
        build.onResolve({ filter: /^node:util$/ }, () => ({
          path: "node:util",
          namespace: "unused-node-policy-branch",
        }));
        build.onLoad(
          { filter: /.*/, namespace: "unused-node-policy-branch" },
          () => ({
            contents:
              'export const types = new Proxy({}, { get() { throw Error("UNEXPECTED_NODE_POLICY_IN_UI_PROBE"); } });',
            loader: "js",
          }),
        );
      },
    },
  ],
});
const globalCss = (await readFile("src/app/globals.css", "utf8"))
  .replace(/^@import .*;$/gm, "")
  .replace(/@theme inline \{[^}]*\}/, "");
const files = new Map([
  [
    "/probe.js",
    {
      bytes: await readFile(path.join(out, "probe.js")),
      type: "text/javascript",
    },
  ],
  [
    "/probe.css",
    { bytes: await readFile(path.join(out, "probe.css")), type: "text/css" },
  ],
  [
    PREVIEW_FONT_ASSET.file,
    {
      bytes: await readFile(path.join("public", PREVIEW_FONT_ASSET.file)),
      type: "font/woff2",
    },
  ],
]);
let unexpected = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const json = (body: unknown) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname.endsWith("/preview/resource")) {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(pixels);
    return;
  }
  if (url.pathname.endsWith("/preview/score")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = previewScoreRequestSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString()),
    );
    const result = scorePreview(
      prepared.value.prepared,
      request.answers,
      request.requestId,
    );
    if (!result.ok) throw Error("SYNTHETIC_PREVIEW_SCORE_FAILED");
    json(result);
    return;
  }
  if (url.pathname.endsWith("/preview") && url.pathname.startsWith("/api/")) {
    json({ ok: true, value: entry });
    return;
  }
  const file = files.get(url.pathname);
  if (file) {
    res.writeHead(200, { "content-type": file.type });
    res.end(file.bytes);
    return;
  }
  if (url.pathname !== "/" && url.pathname !== "/favicon.ico") unexpected++;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>' +
      globalCss +
      '</style><div id="root"></div><script id="fixture" type="application/json">' +
      JSON.stringify(binding) +
      '</script><script src="/probe.js"></script></html>',
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
const origin = `http://127.0.0.1:${address.port}`;
const oldSource = execFileSync(
  "git",
  ["show", "abf6897:tests/e2e/studio-preview.spec.ts"],
  { encoding: "utf8" },
);
await writeFile(
  path.join(out, "old-mobile.ts"),
  'import {expect,type Page,type TestInfo} from "@playwright/test";\nimport {sampleStudioLayout,assertStudioLayout} from ' +
    JSON.stringify(path.resolve("tests/e2e/studio-layout.ts")) +
    ";\nexport " +
    oldSource.slice(
      oldSource.indexOf("async function mobile("),
      oldSource.indexOf("test.beforeAll"),
    ),
);
const old = (await import(
  pathToFileURL(path.join(out, "old-mobile.ts")).href
)) as { mobile: typeof capturePreviewMobile };
const browser = await chromium.launch({ headless: true });
const facts: Record<string, unknown> = {
  qualification:
    "actual React preview with controlled synthetic HTTP and held original state-transition rAF; no DB/Next/3100",
  browser: await browser.version(),
};
try {
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    window.previewFrameProbe = {
      hold: false,
      pending: [],
      events: [],
      release() {
        this.hold = false;
        for (const callback of this.pending.splice(0)) {
          this.events.push({
            phase: "before-effect",
            y: scrollY,
            focused: !!document.activeElement?.matches(
              "[data-preview-state] [data-preview-heading]",
            ),
          });
          callback(performance.now());
          this.events.push({
            phase: "after-effect",
            y: scrollY,
            focused: !!document.activeElement?.matches(
              "[data-preview-state] [data-preview-heading]",
            ),
          });
        }
      },
    };
    window.requestAnimationFrame = (callback) =>
      original((time) => {
        if (
          window.previewFrameProbe.hold &&
          String(callback).includes("scrollIntoView")
        )
          window.previewFrameProbe.pending.push(callback);
        else callback(time);
      });
  });
  async function freshQuestion() {
    await page.goto(origin);
    await expect(
      page.locator('[data-preview-state="cover"] [data-preview-heading]'),
    ).toBeFocused();
    await expect(
      page.locator('[data-preview-state="cover"] img'),
    ).toBeVisible();
    await page.getByRole("button", { name: "开始预览", exact: true }).click();
    await expect(
      page.locator('[data-preview-state="question"] [data-preview-heading]'),
    ).toBeFocused();
    const first = page.getByRole("radio").first();
    await first.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio").nth(1)).toBeChecked();
  }
  await freshQuestion();
  await page.evaluate(() => {
    window.previewFrameProbe.hold = true;
  });
  await page
    .getByRole("button", { name: "暂歇，查看当前进度", exact: true })
    .click();
  await expect(page.locator('[data-preview-state="resume"]')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.previewFrameProbe.pending.length))
    .toBe(1);
  const originalEvaluate = page.evaluate;
  let released = false,
    oldShots = 0;
  page.evaluate = async function (...args: Parameters<Page["evaluate"]>) {
    const value = await originalEvaluate.apply(page, args);
    if (!released && /scrollTo\(0,\s*0\)/.test(String(args[0]))) {
      released = true;
      await originalEvaluate.call(page, () =>
        window.previewFrameProbe.release(),
      );
    }
    return value;
  } as Page["evaluate"];
  let oldError = "";
  try {
    await old.mobile(
      page,
      {
        outputPath: () => {
          oldShots++;
          return path.join(out, "unexpected-old.png");
        },
      } as TestInfo,
      "resume",
    );
  } catch (error) {
    oldError = String(error);
  } finally {
    page.evaluate = originalEvaluate;
  }
  facts.oldAttempt = { released, oldError, oldShots };
  expect(released).toBe(true);
  expect(oldError).toContain("Received:");
  expect(oldShots).toBe(0);
  const oldEvents = await page.evaluate(() => window.previewFrameProbe.events);
  expect(oldEvents[0]!.y).toBe(0);
  expect(oldEvents[0]!.focused).toBe(false);
  expect(oldEvents[1]!.y).toBeGreaterThan(0);
  expect(oldEvents[1]!.focused).toBe(true);
  facts.old = {
    rejected: true,
    screenshots: oldShots,
    error: oldError,
    events: oldEvents,
  };

  await freshQuestion();
  await page.evaluate(() => {
    window.previewFrameProbe.hold = true;
  });
  await page
    .getByRole("button", { name: "暂歇，查看当前进度", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.previewFrameProbe.pending.length))
    .toBe(1);
  let fixedShots = 0,
    done = false;
  const fixed = capturePreviewMobile(
    page,
    {
      outputPath: (file: string) => {
        fixedShots++;
        return path.join(out, "held-" + file);
      },
    } as TestInfo,
    "resume",
  ).then(() => {
    done = true;
  });
  expect(
    await page
      .locator('[data-preview-state="resume"] [data-preview-heading]')
      .evaluate((e) => e === document.activeElement),
  ).toBe(false);
  expect(done).toBe(false);
  expect(fixedShots).toBe(0);
  await page.evaluate(() => window.previewFrameProbe.release());
  await fixed;
  expect(fixedShots).toBe(4);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  facts.fixedHeldResume = {
    screenshots: fixedShots,
    passed: true,
    events: await page.evaluate(() => window.previewFrameProbe.events),
  };
  const captures: string[] = [];
  const info = {
    outputPath: (file: string) => {
      captures.push(file);
      return path.join(out, file);
    },
  } as TestInfo;
  // Unmodified real rAF for all six captures and real scorer fixture.
  await page.goto(origin);
  await capturePreviewMobile(page, info, "cover");
  await page.getByRole("button", { name: "开始预览", exact: true }).click();
  await capturePreviewMobile(page, info, "question");
  await page
    .getByRole("button", { name: "暂歇，查看当前进度", exact: true })
    .click();
  await capturePreviewMobile(page, info, "resume");
  await page.getByRole("button", { name: "继续答题", exact: true }).click();
  for (const [i, answer] of answers(content).entries()) {
    const q = entry.questions[i]!,
      oi = q.options.findIndex((o) => o.id === answer.optionId);
    await page.getByRole("radio").nth(oi).check();
    if (i < entry.questions.length - 1)
      await page.getByRole("button", { name: "下一题", exact: true }).click();
  }
  await page.getByRole("button", { name: "揭晓结果", exact: true }).click();
  await capturePreviewMobile(page, info, "result");
  await page.getByRole("button", { name: "展开报告", exact: true }).click();
  await capturePreviewMobile(page, info, "report");
  await page.getByRole("button", { name: "查看海报", exact: true }).click();
  await capturePreviewMobile(page, info, "poster");
  expect(captures).toHaveLength(24);
  expect(unexpected).toBe(0);
  facts.sixStateFourWidths = { screenshots: captures, passed: true };
  await page.close();
} finally {
  try {
    await browser.close();
    facts.browserClosed = true;
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    facts.serverClosed = true;
    await writeFile(
      path.join(out, "result.json"),
      JSON.stringify(facts, null, 2),
    );
  }
}
console.log(JSON.stringify({ out, passed: true }));
