import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { binding } from "@/features/studio/internal-versions/fixtures.test-support";
import {
  INTERNAL_PENDING_KEYS,
  encodeInternalPending,
} from "@/features/studio/internal-versions/storage";
import { internalReviewResolveUrl } from "@/features/product/internal-versions/urls";
import { recordBaselineFingerprint } from "@/features/product/internal-versions/contracts";

// A finite actual-component check. Synthetic HTTP only; no DB, Next build,
// author data, 3100 or 3110. Run only in the primary chat's browser window.
const out = path.resolve(".cache/studio-business-recovery", String(Date.now()));
await mkdir(out, { recursive: true, mode: 0o700 });
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await fromTsx("esbuild").build({
  entryPoints: [
    path.resolve("tests/browser/studio-business-recovery.client.tsx"),
  ],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  keepNames: true,
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
              'export const types = new Proxy({}, { get() { throw Error("UNEXPECTED_NODE_POLICY_IN_BUSINESS_PROBE"); } });',
            loader: "js",
          }),
        );
      },
    },
  ],
});
const js = await readFile(path.join(out, "probe.js")),
  css = await readFile(path.join(out, "probe.css"));
const unresolved = {
  kind: "unresolved",
  binding,
  fingerprint: await recordBaselineFingerprint(binding),
  observedCurrentRevision: binding.target.revision,
};
let denied = false,
  resolves = 0,
  unexpectedApi = 0;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/probe.js" || pathname === "/probe.css") {
    res.writeHead(200, {
      "content-type": pathname.endsWith(".js") ? "text/javascript" : "text/css",
    });
    res.end(pathname.endsWith(".js") ? js : css);
  } else if (
    pathname === internalReviewResolveUrl(binding.productId) &&
    req.method === "POST"
  ) {
    resolves++;
    res.writeHead(denied ? 401 : 200, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        denied
          ? { code: "UNAUTHENTICATED", requestId: binding.idempotencyKey }
          : unresolved,
      ),
    );
  } else if (pathname.startsWith("/api/")) {
    unexpectedApi++;
    res.writeHead(503, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        code: "STUDIO_UNAVAILABLE",
        requestId: binding.idempotencyKey,
      }),
    );
  } else {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>*{box-sizing:border-box}body{margin:0;font:16px Arial,"PingFang SC",sans-serif}h1,h2,h3,p{margin:0}button,select{font:inherit}</style><div id="root"></div><script id="fixture" type="application/json">' +
        JSON.stringify({ productId: binding.productId }) +
        '</script><script src="/probe.js"></script></html>',
    );
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (
  !address ||
  typeof address === "string" ||
  [3100, 3110].includes(address.port)
)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("pageerror"));
  // Explicit JavaScript content must not capture tsx/esbuild's module-local
  // __name helper when Playwright installs this in a fresh browser realm.
  await page.addInitScript({
    content: String.raw`(() => {
      if (!new URLSearchParams(location.search).has("hold")) return;
      const original = window.setTimeout.bind(window);
      const held = [];
      Object.assign(window, {
        releaseRecoveryReads: () => {
          for (const callback of held.splice(0)) callback();
        },
        heldRecoveryReads: held,
      });
      window.setTimeout = (callback, ms, ...args) =>
        original(() => {
          if (typeof callback !== "function")
            throw Error("FUNCTION_TIMER_REQUIRED");
          if (ms === 0 && callback.name === "readLocal")
            held.push(() => callback(...args));
          else callback(...args);
        }, ms);
    })();`,
  });
  await page.goto(`http://127.0.0.1:${address.port}/probe?hold=1`);
  const panels = page.locator('section[aria-label$="操作查询"]');
  await expect(panels).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { heldRecoveryReads: unknown[] })
            .heldRecoveryReads.length,
      ),
    )
    .toBe(2);
  await expect(panels.locator("details[open]")).toHaveCount(2);
  await expect(
    page.getByText("正在检查上次操作，请稍候；检查完成前不能继续提交。", {
      exact: true,
    }),
  ).toHaveCount(2);
  await expect(
    panels.locator(":scope > details > summary:visible"),
  ).toHaveCount(0);
  await page.screenshot({
    path: path.join(out, "recovery-loading-390.png"),
    fullPage: true,
  });
  await page.evaluate(() =>
    (
      window as unknown as { releaseRecoveryReads: () => void }
    ).releaseRecoveryReads(),
  );
  await expect(panels.locator("details[open]")).toHaveCount(0);
  await expect(
    panels.locator(":scope > details > summary:visible"),
  ).toHaveCount(2);
  expect(resolves).toBe(0);
  await page.screenshot({
    path: path.join(out, "recovery-empty-390.png"),
    fullPage: true,
  });
  const anchor = encodeInternalPending("review", [
    { tuple: binding, mayHaveBeenSent: true },
  ]);
  await page.evaluate(({ key, text }) => sessionStorage.setItem(key, text), {
    key: INTERNAL_PENDING_KEYS.review,
    text: anchor,
  });
  await page.goto(`http://127.0.0.1:${address.port}/probe`);
  const review = page.getByRole("region", {
    name: "审核依据记录操作查询",
    exact: true,
  });
  await expect(review.locator("details[open]")).toHaveCount(1);
  await expect(
    review.getByRole("button", { name: "查询审核依据记录结果", exact: true }),
  ).toBeEnabled();
  expect(resolves).toBe(0);
  await review
    .getByRole("button", { name: "查询审核依据记录结果", exact: true })
    .click();
  await expect(
    review.getByRole("heading", { name: "原操作仍未确认", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      ({ key, text }) => sessionStorage.getItem(key) === text,
      { key: INTERNAL_PENDING_KEYS.review, text: anchor },
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(out, "recovery-unknown-390.png"),
    fullPage: true,
  });
  denied = true;
  await review
    .getByRole("button", { name: "查询审核依据记录结果", exact: true })
    .click();
  await expect(
    review.getByText("本页授权已失效。", { exact: false }),
  ).toBeVisible();
  await expect(
    review.getByRole("button", { name: "查询审核依据记录结果", exact: true }),
  ).toBeDisabled();
  await expect(panels.locator("details[open]")).toHaveCount(2);
  expect(
    await page.evaluate(
      ({ key, text }) => sessionStorage.getItem(key) === text,
      { key: INTERNAL_PENDING_KEYS.review, text: anchor },
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(out, "recovery-denied-390.png"),
    fullPage: true,
  });
  expect(resolves).toBe(2);
  expect(unexpectedApi).toBe(0);
  expect(errors).toEqual([]);
  const result = {
    scope:
      "actual StableInternalWorkspace with synthetic HTTP; no DB or real approval",
    browser: await browser.version(),
    states: ["loading", "empty", "unknown", "denied"],
    viewport: { width: 390, height: 900 },
    anchorPreserved: true,
    resolvePosts: resolves,
    unexpectedApi,
    pageErrors: errors.length,
  };
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ out, ...result }));
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
