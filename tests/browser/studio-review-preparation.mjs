/** Actual retained React review task + synthetic HTTP; no service, DB or author data. */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  fixture,
  binding,
  renderer,
  engine,
  target,
  uuid,
} from "@/features/studio/internal-versions/fixtures.test-support";
import {
  recordBaselineBindingSchema,
  recordBaselineFingerprint,
} from "@/features/product/internal-versions/contracts";

const out = path.resolve(
  ".cache/studio-review-preparation",
  String(Date.now()),
);
await mkdir(out, { recursive: true, mode: 0o700 });
const f = await fixture();
const session = {
  operator: {
    loginName: "synthetic.account",
    accountRevision: 1,
    id: uuid(40),
    displayName: "Synthetic admin",
    role: "admin",
  },
  csrfToken: "A".repeat(43),
  idleExpiresAt: "2026-10-27T00:00:00.000Z",
  absoluteExpiresAt: "2026-10-27T00:00:00.000Z",
};
const esbuild = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
)("esbuild");
await esbuild.build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';
import {InternalAuthorityProvider} from '@/features/studio/internal-versions/authority';
import {ProductTaskSurfaces} from '@/features/studio/product-workspace/task-surfaces';
import {ReviewWorkbench} from '@/features/studio/product-workspace/review-workbench';
const input=JSON.parse(document.querySelector('#fixture').textContent);
createRoot(document.getElementById('root')).render(<InternalAuthorityProvider productId={input.productId}><ProductTaskSurfaces><ReviewWorkbench productId={input.productId} session={input.session} currentTarget={input.target} visible onChanged={()=>{}}/></ProductTaskSurfaces></InternalAuthorityProvider>);
`,
    resolveDir: process.cwd(),
    loader: "tsx",
    sourcefile: "review-preparation-probe.tsx",
  },
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
      setup(build) {
        build.onResolve({ filter: /^node:util$/ }, () => ({
          path: "node:util",
          namespace: "unused-node-policy-branch",
        }));
        build.onLoad(
          { filter: /.*/, namespace: "unused-node-policy-branch" },
          () => ({
            contents:
              'export const types = new Proxy({}, {get(){throw Error("UNEXPECTED_NODE_POLICY_IN_UI_PROBE")}});',
            loader: "js",
          }),
        );
      },
    },
  ],
});
const js = await readFile(path.join(out, "probe.js"));
const css = await readFile(path.join(out, "probe.css"));
let receipt;
const writes = [],
  errors = [],
  results = [];
let reviewReads = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const send = (value, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  try {
    if (req.method === "POST") {
      const chunks = [];
      for await (const part of req) chunks.push(Buffer.from(part));
      const request = recordBaselineBindingSchema.parse({
        productId: binding.productId,
        ...JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      writes.push({ path: url.pathname, request });
      if (url.pathname.endsWith("/internal-review")) {
        if (receipt) throw Error("UNEXPECTED_SECOND_REVIEW_WRITE");
        receipt = {
          ...f.review,
          binding: request,
          fingerprint: await recordBaselineFingerprint(request),
        };
        send({ ok: true, value: { created: true, review: receipt } }, 201);
      } else if (
        url.pathname.endsWith("/internal-review-applications/resolve")
      ) {
        if (
          !receipt ||
          JSON.stringify(request) !== JSON.stringify(receipt.binding)
        )
          throw Error("RESOLVE_MUST_USE_ORIGINAL_REQUEST");
        send({
          ok: true,
          value: {
            kind: "recorded",
            binding: request,
            fingerprint: receipt.fingerprint,
            review: receipt,
          },
        });
      } else throw Error("UNEXPECTED_POST");
      return;
    }
    if (url.pathname.endsWith("/internal-review")) {
      reviewReads++;
      send({
        ok: true,
        value: {
          productId: binding.productId,
          target,
          observedCurrentRevision: target.revision,
          review: receipt ?? null,
          baseline: binding.baseline,
          rendererChoices: [
            { renderer, capability: "studio-internal-preview" },
          ],
          engine,
        },
      });
      return;
    }
    if (url.pathname.endsWith("/internal-versions")) {
      send({ ok: true, value: { productId: binding.productId, versions: [] } });
      return;
    }
    if (url.pathname === "/probe.js" || url.pathname === "/probe.css") {
      res.writeHead(200, {
        "content-type": url.pathname.endsWith(".js")
          ? "text/javascript"
          : "text/css",
      });
      res.end(url.pathname.endsWith(".js") ? js : css);
      return;
    }
    res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>body{font:16px/1.6 system-ui;margin:16px auto;max-width:1160px}button{font:inherit;min-height:44px}</style><div id="root"></div><script id="fixture" type="application/json">${JSON.stringify({ productId: binding.productId, target, session }).replaceAll("<", "\\u003c")}</script><script src="/probe.js"></script>`,
    );
  } catch (error) {
    errors.push(error.message);
    send({ code: "PROBE_TRANSPORT_INVALID" }, 500);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: "reduce",
});
page.setDefaultTimeout(6000);
page.on("pageerror", (error) => errors.push(error.message));
const button = (name) =>
  page.getByRole("button", { name, exact: true }).filter({ visible: true });
const ownedKey = `quizforge.studio.owned.v1:${session.operator.id}:quizforge.studio.review-record.v1`;
const pending = () =>
  page.evaluate(
    (key) => JSON.parse(JSON.parse(sessionStorage.getItem(key)).payload),
    ownedKey,
  );
let failure;
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await button("核对并记录既有依据").click();
  await button("准备记录已有审核依据").click();
  await button("确认并发送此固定请求").click();
  const writer = page.getByRole("region", {
    name: "记录审核依据与固定内容版本",
  });
  await expect(
    writer.getByRole("heading", { name: "原操作已记录" }),
  ).toBeVisible();
  const retained = await pending();
  expect(retained.entries).toHaveLength(1);
  expect(retained.entries[0].mayHaveBeenSent).toBe(true);
  expect(writes).toHaveLength(1);
  await button("关闭当前浮层").click();
  const readsBefore = reviewReads;
  await button("重新读取条件").click();
  await expect.poll(() => reviewReads).toBeGreaterThan(readsBefore);
  await button("继续原审核与封存任务").click();
  await expect(
    writer.getByRole("heading", { name: "原操作已记录" }),
  ).toBeVisible();
  await expect(
    writer.getByRole("combobox", { name: "内测预览样式", exact: true }),
  ).toBeHidden();
  expect(await pending()).toEqual(retained);
  expect(writes).toHaveLength(1);
  results.push(
    "uncleared pending keeps original result/tuple across nonce, GET refresh and close/reopen; no new request",
  );
  await page.screenshot({ path: path.join(out, "pending-retained-1440.png") });

  await button("查询审核依据记录结果").click();
  await expect(
    page.locator('[data-internal-resolution="recorded"]'),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1].request).toEqual(writes[0].request);
  await button("确认处理结果并结束此操作记录").click();
  await expect.poll(async () => (await pending()).entries.length).toBe(0);
  // The private envelope persists with an empty container after exact explicit clearing.
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key) !== null,
      ownedKey,
    ),
  ).toBe(true);
  await button("关闭当前浮层").click();
  await button("固定内测内容版本").click();
  const select = writer.getByRole("combobox", {
    name: "内测预览样式",
    exact: true,
  });
  await expect(select).toBeVisible();
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("");
  await expect(
    writer.getByRole("heading", { name: "原操作已记录" }),
  ).toHaveCount(0);
  await expect(button("返回本修订准备")).toHaveCount(0);
  await select.selectOption(renderer.entrySha256);
  await expect(button("准备固定内测内容版本")).toBeEnabled();
  expect(writes).toHaveLength(2);
  expect(errors).toEqual([]);
  results.push(
    "resolve original tuple, explicitly clear, close/reopen enters seal preparation directly; no extra POST",
  );
  await page.screenshot({ path: path.join(out, "seal-preparation-1440.png") });
} catch (error) {
  failure = error;
  await page.screenshot({ path: path.join(out, "failure.png") });
} finally {
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify(
      { results, errors, writes, failure: failure?.message },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({ out, results, errors, failure: failure?.message }),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
if (failure) throw failure;
