import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type TestInfo } from "@playwright/test";
import {
  fixture,
  binding,
  renderer,
  engine,
} from "@/features/studio/internal-versions/fixtures.test-support";
import { summary } from "@/features/studio/drafts/fixtures.test-support";
import {
  internalReviewUrl,
  internalVersionsUrl,
  internalVersionUrl,
  internalReviewResolveUrl,
} from "@/features/product/internal-versions/urls";
import {
  INTERNAL_PENDING_KEYS,
  encodeInternalPending,
} from "@/features/studio/internal-versions/storage";
import { captureInternalWidths } from "../e2e/studio-internal-versions.ui";

// Actual three React pages/readers/local recovery timers. Synthetic HTTP only;
// this does not run a database transaction or establish author approval.
const out = path.resolve(".cache/p4-internal-capture", String(Date.now()));
await mkdir(out, { recursive: true });
const f = await fixture(),
  scope = {
    productId: binding.productId,
    draftId: binding.target.draftId,
    revision: binding.target.revision,
  };
const metadata = {
  id: f.version.id,
  slot: 1,
  productId: binding.productId,
  target: binding.target,
  reviewId: f.review.id,
  reviewSha256: f.review.reviewSha256,
  snapshotSha256: f.version.snapshotSha256,
  renderer,
  rendererCapability: "studio-internal-preview",
  engine,
  purpose: "internal-test",
  publicationApproved: false,
  createdAt: f.version.createdAt,
  createdBy: f.version.createdBy,
};
const draft = {
  ...summary,
  productId: binding.productId,
  draftId: binding.target.draftId,
  revision: binding.target.revision,
  canonicalContentSha256: binding.target.canonicalContentSha256,
  assetSetSha256: binding.target.assetSetSha256,
};
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await fromTsx("esbuild").build({
  entryPoints: [
    path.resolve("tests/browser/studio-internal-capture.client.tsx"),
  ],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  logLevel: "silent",
  plugins: [
    {
      name: "unused-node-policy-branch",
      setup(build: {
        onResolve: (o: { filter: RegExp }, cb: () => unknown) => void;
        onLoad: (
          o: { filter: RegExp; namespace: string },
          cb: () => unknown,
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
const files = new Map([
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
]);
let mode = "normal",
  holdPath = "",
  failurePath = "",
  posts = 0,
  release: (() => void) | undefined,
  requested: Promise<void>,
  notify: (() => void) | undefined;
function hold(url: string) {
  holdPath = url;
  requested = new Promise<void>((r) => {
    notify = r;
  });
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1"),
    p = url.pathname;
  const json = (value: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (req.method === "POST") {
    posts++;
    if (p === internalReviewResolveUrl(binding.productId)) {
      json({
        ok: true,
        value: {
          kind: "recorded",
          binding,
          fingerprint: f.review.fingerprint,
          review: f.review,
        },
      });
      return;
    }
    json({ code: "WRITE_OUTCOME_UNKNOWN", requestId: f.review.id }, 503);
    return;
  }
  if (p === holdPath) {
    notify?.();
    await new Promise<void>((r) => {
      release = r;
    });
  }
  if (p === failurePath) {
    json({ code: "STUDIO_UNAVAILABLE", requestId: f.review.id }, 503);
    return;
  }
  if (p === internalReviewUrl(scope)) {
    json({
      ok: true,
      value: {
        productId: binding.productId,
        target: binding.target,
        observedCurrentRevision: binding.target.revision,
        review: mode === "unknown" ? null : f.review,
        baseline: binding.baseline,
        rendererChoices: [{ renderer, capability: "studio-internal-preview" }],
        engine,
      },
    });
    return;
  }
  if (p === internalVersionsUrl(binding.productId)) {
    json({
      ok: true,
      value: { productId: binding.productId, versions: [metadata] },
    });
    return;
  }
  if (p === internalVersionUrl(binding.productId, f.version.id)) {
    json({ ok: true, value: { version: f.version, snapshot: f.snapshot } });
    return;
  }
  if (p.endsWith("/draft")) {
    json({ kind: "draft", draft });
    return;
  }
  const file = files.get(p);
  if (file) {
    res.writeHead(200, { "content-type": file.type });
    res.end(file.body);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}h1,h2,h3,p{margin:0}h1,h2,h3{font-size:inherit;font-weight:inherit}button,select{font:inherit}</style><div id="root"></div><script id="fixture" type="application/json">' +
      JSON.stringify({ scope, versionId: f.version.id }) +
      '</script><script src="/probe.js"></script></html>',
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true }),
  facts: Record<string, unknown> = {
    qualification:
      "actual React review/list/detail with held independent HTTP and local-read timers; synthetic only, no DB/Next/3100",
    browser: await browser.version(),
  };
try {
  const cases = [];
  for (const [name, pagePath, target, state] of [
    ["review-facts", "/review", internalReviewUrl(scope), "review-recorded"],
    [
      "review-capacity",
      "/review",
      internalVersionsUrl(binding.productId),
      "review-recorded",
    ],
    [
      "list-metadata",
      "/list",
      internalVersionsUrl(binding.productId),
      "historical-list",
    ],
    [
      "list-head",
      "/list",
      `/api/studio/products/${binding.productId}/draft`,
      "historical-list",
    ],
    [
      "detail-snapshot",
      "/detail",
      internalVersionUrl(binding.productId, f.version.id),
      "sealed-detail",
    ],
    [
      "detail-head",
      "/detail",
      `/api/studio/products/${binding.productId}/draft`,
      "sealed-detail",
    ],
  ] as const) {
    hold(target);
    const p = await browser.newPage({ viewport: { width: 320, height: 900 } });
    await p.goto(origin + pagePath);
    await requested!;
    let shots = 0;
    const work = captureInternalWidths(
      p,
      {
        outputPath: (file) => {
          shots++;
          return path.join(out, `${name}-${file}`);
        },
      } as TestInfo,
      state,
    );
    await p.evaluate(() => document.readyState);
    expect(shots).toBe(0);
    release?.();
    await work;
    expect(shots).toBe(4);
    cases.push({ name, shots });
    await p.close();
    holdPath = "";
  }
  facts.readers = cases;
  const timers = await browser.newPage({
    viewport: { width: 320, height: 900 },
  });
  await timers.addInitScript(() => {
    const original = window.setTimeout.bind(window),
      held: (() => void)[] = [];
    const probe = {
      releaseLocalReads() {
        for (const callback of held.splice(0)) callback();
      },
      setTimeout(callback: TimerHandler, ms?: number, ...args: unknown[]) {
        return original(() => {
          if (
            typeof callback === "function" &&
            ms === 0 &&
            (callback.name === "readLocal" ||
              String(callback).includes("inspectInternalPreparation"))
          )
            held.push(() => callback(...args));
          else if (typeof callback === "function") callback(...args);
          else throw Error("UNEXPECTED_STRING_TIMER");
        }, ms);
      },
    };
    Object.assign(window, {
      releaseLocalReads: probe.releaseLocalReads,
      heldLocalReads: held,
    });
    window.setTimeout = probe.setTimeout as typeof window.setTimeout;
  });
  await timers.goto(origin + "/review");
  await expect
    .poll(() =>
      timers.evaluate(
        () =>
          (window as unknown as { heldLocalReads: unknown[] }).heldLocalReads
            .length,
      ),
    )
    .toBe(3);
  let timerShots = 0;
  const timerWork = captureInternalWidths(
    timers,
    {
      outputPath: (file) => {
        timerShots++;
        return path.join(out, "local-" + file);
      },
    } as TestInfo,
    "review-recorded",
  );
  await timers.evaluate(() => document.readyState);
  expect(timerShots).toBe(0);
  await timers.evaluate(() =>
    (
      window as unknown as { releaseLocalReads: () => void }
    ).releaseLocalReads(),
  );
  await timerWork;
  expect(timerShots).toBe(4);
  facts.localTimers = { held: 3, shots: timerShots };
  await timers.close();
  const error = await browser.newPage({
    viewport: { width: 320, height: 900 },
  });
  failurePath = internalReviewUrl(scope);
  const anchor = encodeInternalPending("review", [
    { tuple: binding, mayHaveBeenSent: true },
  ]);
  await error.addInitScript(
    ({ key, text }) => sessionStorage.setItem(key, text),
    { key: INTERNAL_PENDING_KEYS.review, text: anchor },
  );
  await error.goto(origin + "/review");
  await error
    .getByRole("button", { name: "核实基线记录原请求", exact: true })
    .click();
  await expect(
    error.locator('[data-internal-resolution="recorded"]'),
  ).toBeVisible();
  await captureInternalWidths(
    error,
    { outputPath: (file) => path.join(out, "expected503-" + file) } as TestInfo,
    "review-resolved-detail-error",
  );
  expect(
    await error.evaluate(
      ({ key, text }) => sessionStorage.getItem(key) === text,
      { key: INTERNAL_PENDING_KEYS.review, text: anchor },
    ),
  ).toBe(true);
  facts.expected503 = { shots: 4, anchorUnchanged: true };
  await error.close();
  failurePath = internalVersionsUrl(binding.productId);
  const failed = await browser.newPage({
    viewport: { width: 320, height: 900 },
  });
  await failed.goto(origin + "/review");
  let unexpectedShots = 0,
    rejected = false;
  try {
    await captureInternalWidths(
      failed,
      {
        outputPath: (file) => {
          unexpectedShots++;
          return path.join(out, "unexpected-" + file);
        },
      } as TestInfo,
      "review-recorded",
    );
  } catch {
    rejected = true;
  }
  expect(rejected && unexpectedShots === 0).toBe(true);
  facts.unexpectedCapacityError = { rejected, shots: unexpectedShots };
  await failed.close();
  failurePath = "";
  mode = "unknown";
  const unknown = await browser.newPage({
    viewport: { width: 320, height: 900 },
  });
  await unknown.goto(origin + "/review");
  await unknown
    .getByRole("button", { name: "准备记录既有基线", exact: true })
    .click();
  await unknown
    .getByRole("button", { name: "确认并发送此固定请求", exact: true })
    .click();
  await expect(
    unknown.getByText(
      "本次提交未收到可确认的成功回执。请保留原 key 和完整目标，以原请求核实区的最新证据为准。",
      { exact: true },
    ),
  ).toBeVisible();
  const before = await unknown.evaluate(
      (key) => sessionStorage.getItem(key),
      INTERNAL_PENDING_KEYS.review,
    ),
    beforePosts = posts;
  await captureInternalWidths(
    unknown,
    { outputPath: (file) => path.join(out, "unknown-" + file) } as TestInfo,
    "review-unknown",
  );
  expect(
    await unknown.evaluate(
      (key) => sessionStorage.getItem(key),
      INTERNAL_PENDING_KEYS.review,
    ),
  ).toBe(before);
  expect(posts).toBe(beforePosts);
  facts.unknown = { shots: 4, anchorUnchanged: true, noAdditionalPost: true };
  await unknown.close();
} finally {
  release?.();
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
