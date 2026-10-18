import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect, type Page } from "@playwright/test";
import { draftSummarySchema } from "@/features/product/drafts/contracts";
import { captureDraftMobile } from "../e2e/studio-drafts.visual";

// Actual DraftWorkspacePage + history/read clients, controlled synthetic HTTP only.
// No DB, native media, credentials, 3100 or production Next server.
const out = path.resolve(".cache/p4-drafts-capture", String(Date.now()));
await mkdir(out, { recursive: true });
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = draftSummarySchema.parse({
  productId: "capture-fixture",
  draftId: id(2),
  revision: 1,
  applicationId: id(3),
  sourceImportId: id(4),
  sourceValidationId: id(5),
  canonicalContentSha256: "a".repeat(64),
  assetSetSha256: "b".repeat(64),
  canonicalManifestSha256: "c".repeat(64),
  candidateSha256: "d".repeat(64),
  containerSchemaVersion: "quizpack.v1",
  contentSchemaVersion: "quizpack-content.v1",
  contentKind: "synthetic",
  packId: "capture-fixture-pack",
  packVersion: "1.0.0",
  versions: {
    contentVersion: "1.0.0",
    visualVersion: "1.0.0",
    reportVersion: "1.0.0",
    resourceVersion: "1.0.0",
    componentVersion: "1.0.0",
    engine: { id: "archetype", version: "1.0.0" },
  },
  resourceCount: 4,
  createdAt: "2026-10-19T00:00:00.000Z",
  createdBy: id(1),
  platformApproval: "unverified",
  publishable: false,
});
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await fromTsx("esbuild").build({
  entryPoints: [path.resolve("tests/browser/studio-drafts-capture.client.tsx")],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  logLevel: "silent",
  // The old limits module imports Node proxy detection for a server-only policy
  // branch. No production module is edited; invoking it in this UI probe fails.
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
const oldSource = execFileSync(
  "git",
  ["show", "7ebfca5:tests/e2e/studio-drafts.spec.ts"],
  { encoding: "utf8" },
);
const oldFunction = oldSource.slice(
  oldSource.indexOf("async function mobile("),
  oldSource.indexOf("test.beforeAll"),
);
await writeFile(
  path.join(out, "old-mobile.ts"),
  'import {expect,type Page,type TestInfo} from "@playwright/test";\nexport ' +
    oldFunction,
);
const old = (await import(
  pathToFileURL(path.join(out, "old-mobile.ts")).href
)) as { mobile: typeof captureDraftMobile };
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
]);
let releaseHistory: (() => void) | undefined,
  notifyHistory: (() => void) | undefined,
  failure = false;
let historyRequested = Promise.resolve();
function hold() {
  historyRequested = new Promise<void>((r) => {
    notifyHistory = r;
  });
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const json = (value: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (url.pathname.endsWith("/draft")) {
    json({ kind: "draft", draft });
    return;
  }
  if (url.pathname.endsWith("/revisions")) {
    notifyHistory?.();
    await new Promise<void>((r) => {
      releaseHistory = r;
    });
    json(
      failure
        ? { code: "STUDIO_UNAVAILABLE", requestId: id(6) }
        : {
            productId: draft.productId,
            draftId: draft.draftId,
            pageSize: 20,
            anchorRevision: 1,
            beforeRevision: 2,
            items: [draft],
            nextBeforeRevision: null,
          },
      failure ? 503 : 200,
    );
    return;
  }
  const file = files.get(url.pathname);
  if (file) {
    res.writeHead(200, { "content-type": file.type });
    res.end(file.bytes);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}h1,h2,h3,p{margin:0}button,select{font:inherit}</style><div id="root"></div><script src="/probe.js"></script></html>',
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const facts: Record<string, unknown> = {
  qualification:
    "actual React workspace/history clients with held synthetic HTTP, no DB/3100/production server",
};
try {
  hold();
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  await page.goto(origin);
  await historyRequested;
  await expect(
    page.getByRole("link", { name: "读取固定修订正文", exact: true }),
  ).toBeVisible();
  const screenshot = page.screenshot.bind(page);
  let before = 0,
    png = 0;
  page.screenshot = async (...args: Parameters<Page["screenshot"]>) => {
    before = await page.evaluate(() =>
      Math.max(innerHeight, document.documentElement.scrollHeight),
    );
    releaseHistory?.();
    await expect(page.locator('[data-history-revision="1"]')).toBeVisible();
    const bytes = await screenshot(...args);
    png = bytes.readUInt32BE(20);
    return bytes;
  };
  let oldRejected = false;
  try {
    await old.mobile(
      page,
      { outputPath: (file) => path.join(out, "negative-" + file) },
      "draft-summary",
    );
  } catch {
    oldRejected = true;
  }
  expect(oldRejected && png > before).toBe(true);
  facts.negative = {
    oldRejected,
    before,
    png,
    historyArrival: "after old height measurement and before actual capture",
  };
  await page.close();
  hold();
  const fixed = await browser.newPage({
    viewport: { width: 320, height: 900 },
  });
  await fixed.goto(origin);
  await historyRequested;
  let captures = 0;
  const fixedShot = fixed.screenshot.bind(fixed);
  fixed.screenshot = async (...args: Parameters<Page["screenshot"]>) => {
    captures++;
    return fixedShot(...args);
  };
  const capture = captureDraftMobile(
    fixed,
    { outputPath: (file) => path.join(out, "fixed-" + file) },
    "draft-summary",
  );
  expect(captures).toBe(0);
  releaseHistory?.();
  await capture;
  expect(captures).toBe(4);
  facts.fixed = {
    captures,
    widths: [320, 375, 390, 430],
    fullHeightAssertions: "before === after === PNG; width === PNG",
  };
  await fixed.close();
  hold();
  failure = true;
  const failed = await browser.newPage({
    viewport: { width: 320, height: 900 },
  });
  await failed.goto(origin);
  await historyRequested;
  releaseHistory?.();
  let failureCaptures = 0;
  const failedShot = failed.screenshot.bind(failed);
  failed.screenshot = async (...args: Parameters<Page["screenshot"]>) => {
    failureCaptures++;
    return failedShot(...args);
  };
  let failureRejected = false;
  try {
    await captureDraftMobile(
      failed,
      { outputPath: (file) => path.join(out, "error-" + file) },
      "draft-summary",
    );
  } catch {
    failureRejected = true;
  }
  expect(failureRejected && failureCaptures === 0).toBe(true);
  facts.historyFailure = {
    rejected: failureRejected,
    captures: failureCaptures,
  };
  await failed.close();
  facts.browser = await browser.version();
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(facts, null, 2),
  );
  console.log(
    JSON.stringify({
      out,
      oldRejected,
      captures,
      failureRejected,
      failureCaptures,
    }),
  );
} finally {
  releaseHistory?.();
  await browser.close();
  await new Promise<void>((r, reject) =>
    server.close((e) => (e ? reject(e) : r())),
  );
}
