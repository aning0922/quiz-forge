/** Actual retained settings components and synthetic HTTP; no database or author data. */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.resolve("package.json"));
const { chromium, expect } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
const out = path.resolve(".cache/studio-settings-tasks", String(Date.now()));
const taxonomyOnly = process.argv.includes("--taxonomy-authority-only");
await mkdir(out, { recursive: true, mode: 0o700 });
await esbuild.build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';
import {InternalAuthorityProvider} from '@/features/studio/internal-versions/authority';
import {StudioNavigationBoundary} from '@/features/studio/navigation-boundary';
import {ProductTaskSurfaces,RetainedTaskSurface,useWorkspaceSurfaces} from '@/features/studio/product-workspace/task-surfaces';
import {ProductDetail} from '@/features/studio/workspace/product-detail';
const session={operator:{id:'00000000-0000-0000-0000-000000000007',label:'Synthetic',role:'operator'},csrfToken:'A'.repeat(43),idleExpiresAt:'2030-01-01T00:00:00.000Z',absoluteExpiresAt:'2030-01-01T00:00:00.000Z'};
function Body(){const s=useWorkspaceSurfaces();return <><button onClick={()=>s.open('settings')}>打开设置</button><output id='retained-state'>{s.states.settings?.pending?'pending':s.states.settings?.retained?'dirty':'clean'}</output><RetainedTaskSurface id='settings'><ProductDetail productId='parity-settings' session={session} embedded/></RetainedTaskSurface></>}
createRoot(document.getElementById('root')).render(<StudioNavigationBoundary><InternalAuthorityProvider productId='parity-settings'><ProductTaskSurfaces><Body/></ProductTaskSurfaces></InternalAuthorityProvider></StudioNavigationBoundary>);
`,
    resolveDir: process.cwd(),
    loader: "tsx",
    sourcefile: "settings-probe.tsx",
  },
  outfile: path.join(out, "settings-probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  logLevel: "silent",
  plugins: [
    {
      name: "unexecuted-node-policy",
      setup(b) {
        b.onResolve({ filter: /^node:util$/ }, () => ({
          path: "node:util",
          namespace: "policy",
        }));
        b.onLoad({ filter: /.*/, namespace: "policy" }, () => ({
          contents:
            'export const types=new Proxy({}, {get(){throw Error("UNEXPECTED_NODE_POLICY")}})',
          loader: "js",
        }));
      },
    },
  ],
});
const initial = () => ({
  id: "parity-settings",
  slug: "parity-settings",
  title: "设置合成样例",
  metadataRevision: 1,
  createdAt: "2026-10-24T00:00:00.000Z",
  updatedAt: "2026-10-24T00:00:00.000Z",
  archivedAt: null,
  primaryCategory: null,
  tags: [],
});
let product = initial(),
  mode = "ok",
  writes = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/probe.js" || url.pathname === "/probe.css") {
      res.setHeader(
        "content-type",
        url.pathname.endsWith("js") ? "text/javascript" : "text/css",
      );
      res.end(
        await readFile(
          path.join(
            out,
            "settings-probe" + (url.pathname.endsWith("js") ? ".js" : ".css"),
          ),
        ),
      );
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      res.setHeader("content-type", "application/json");
      if (req.method === "GET") {
        if (
          url.pathname === "/api/studio/categories" &&
          mode.startsWith("taxonomy-")
        ) {
          res.statusCode = mode === "taxonomy-deny" ? 401 : 503;
          res.end(
            JSON.stringify({
              code:
                mode === "taxonomy-deny"
                  ? "UNAUTHENTICATED"
                  : "STUDIO_UNAVAILABLE",
              requestId: "synthetic-taxonomy-read",
            }),
          );
          return;
        }
        if (
          mode === "deny" &&
          url.pathname === "/api/studio/products/parity-settings"
        ) {
          res.statusCode = 401;
          res.end(
            JSON.stringify({
              code: "UNAUTHENTICATED",
              requestId: "synthetic-settings-denied",
            }),
          );
          return;
        }
        res.end(
          JSON.stringify(
            url.pathname === "/api/studio/products/parity-settings"
              ? product
              : { items: [], page: 1, pageSize: 10, total: 0, hasNext: false },
          ),
        );
        return;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      writes.push({ method: req.method, path: url.pathname, input });
      if (mode === "conflict") {
        res.statusCode = 409;
        res.end(
          JSON.stringify({
            code: "METADATA_REVISION_CONFLICT",
            currentRevision: product.metadataRevision,
            requestId: "synthetic-settings-conflict",
          }),
        );
        return;
      }
      if (req.method === "PATCH")
        product = {
          ...product,
          title: input.title,
          slug: input.slug,
          metadataRevision: product.metadataRevision + 1,
        };
      else if (url.pathname.endsWith("/archive"))
        product = {
          ...product,
          archivedAt: "2026-10-24T01:00:00.000Z",
          metadataRevision: product.metadataRevision + 1,
        };
      else if (url.pathname.endsWith("/restore"))
        product = {
          ...product,
          archivedAt: null,
          metadataRevision: product.metadataRevision + 1,
        };
      else throw Error("UNEXPECTED_WRITE");
      if (mode === "unknown") {
        res.statusCode = 503;
        res.end(
          JSON.stringify({
            code: "WRITE_OUTCOME_UNKNOWN",
            requestId: "synthetic-settings-unknown",
          }),
        );
        return;
      }
      res.end(JSON.stringify({ product, changed: true }));
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui}</style></head><body><div id="root"></div><script src="/probe.js"></script></body></html>',
    );
  } catch {
    res.statusCode = 500;
    res.end("PROBE_ERROR");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true });
const errors = [],
  results = [];
async function open() {
  const p = await browser.newPage({ viewport: { width: 390, height: 900 } });
  p.setDefaultTimeout(7000);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(origin);
  await p.getByRole("button", { name: "打开设置", exact: true }).click();
  await expect(p.getByLabel("测评名称", { exact: true })).toBeVisible();
  return p;
}
try {
  if (!taxonomyOnly) {
    let p = await open();
    await p.getByLabel("测评名称", { exact: true }).fill("保留的未保存输入");
    await p.evaluate(
      () => (window.original = document.querySelector("#product-title")),
    );
    await p.getByRole("button", { name: "关闭当前浮层", exact: true }).click();
    await expect(p.locator("dialog:modal")).toHaveCount(0);
    await p.getByRole("button", { name: "打开设置", exact: true }).click();
    expect(
      await p.evaluate(
        () => window.original === document.querySelector("#product-title"),
      ),
    ).toBe(true);
    await expect(p.getByLabel("测评名称", { exact: true })).toHaveValue(
      "保留的未保存输入",
    );
    await p.getByRole("button", { name: "保存测评信息", exact: true }).click();
    await expect(
      p.getByText("测评信息已保存。", { exact: true }),
    ).toBeVisible();
    expect(writes.length).toBe(1);
    expect(writes[0].input.expectedMetadataRevision).toBe(1);
    await p.getByText("标识、状态与归档", { exact: true }).click();
    await p.getByRole("button", { name: "归档测评", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "确认归档测评", exact: true }),
    ).toBeEnabled();
    expect(writes.length).toBe(1);
    await p.getByRole("button", { name: "确认归档测评", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "返回基本设置", exact: true }),
    ).toBeEnabled();
    expect(writes.length).toBe(2);
    expect(writes[1].path.endsWith("/archive")).toBe(true);
    await p.getByRole("button", { name: "返回基本设置", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "恢复测评", exact: true }),
    ).toBeVisible();
    await p.getByRole("button", { name: "恢复测评", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "确认恢复测评", exact: true }),
    ).toBeVisible();
    expect(writes.length).toBe(2);
    results.push(
      "retained input DOM; external footer form submits once; previous save/archive success cannot complete a newly opened lifecycle task",
    );
    await p.close();
    product = initial();
    writes = [];
    mode = "ok";
    p = await open();
    await p.getByLabel("测评名称", { exact: true }).fill("冲突后保留输入");
    product = { ...product, title: "另一写者内容", metadataRevision: 2 };
    mode = "conflict";
    await p.getByRole("button", { name: "保存测评信息", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "内容发生冲突", exact: true }),
    ).toBeVisible();
    await p.getByRole("button", { name: "关闭当前浮层", exact: true }).click();
    await p.getByRole("button", { name: "打开设置", exact: true }).click();
    await expect(p.getByLabel("测评名称", { exact: true })).toHaveValue(
      "冲突后保留输入",
    );
    await expect(
      p.getByRole("button", { name: "保存测评信息", exact: true }),
    ).toBeDisabled();
    await p
      .getByRole("button", { name: "读取服务器最新内容", exact: true })
      .click();
    await p
      .getByRole("button", {
        name: "保留我的输入，以最新修订重提",
        exact: true,
      })
      .click();
    mode = "ok";
    await p.getByRole("button", { name: "保存测评信息", exact: true }).click();
    await expect(
      p.getByText("测评信息已保存。", { exact: true }),
    ).toBeVisible();
    expect(writes.length).toBe(2);
    expect(writes[1].input.expectedMetadataRevision).toBe(2);
    results.push(
      "CAS conflict remains in same drawer; explicit read/adopt preserves input and only then submits new revision",
    );
    await p.close();
    product = initial();
    writes = [];
    mode = "unknown";
    p = await open();
    await p.getByLabel("测评名称", { exact: true }).fill("未知结果仍保留");
    await p.evaluate(
      () => (window.original = document.querySelector("#product-title")),
    );
    await p.getByRole("button", { name: "保存测评信息", exact: true }).click();
    await expect(
      p.getByRole("heading", { name: "提交结果尚未确认", exact: true }),
    ).toBeVisible();
    await p.getByRole("button", { name: "关闭当前浮层", exact: true }).click();
    await expect(p.locator("#retained-state")).toHaveText("pending");
    await p.getByRole("button", { name: "打开设置", exact: true }).click();
    mode = "deny";
    await p
      .getByRole("button", { name: "读取服务器最新内容", exact: true })
      .click();
    await expect(p.getByLabel("测评名称", { exact: true })).toBeDisabled();
    expect(
      await p.evaluate(
        () => window.original === document.querySelector("#product-title"),
      ),
    ).toBe(true);
    await expect(p.getByLabel("测评名称", { exact: true })).toHaveValue(
      "未知结果仍保留",
    );
    expect(writes.length).toBe(1);
    results.push(
      "UNKNOWN retains same input/DOM and pending marker; shared revocation disables footer without replay",
    );
    await p.close();
  }
  for (const taxonomyMode of ["taxonomy-unavailable", "taxonomy-deny"]) {
    product = initial();
    writes = [];
    mode = taxonomyMode;
    const p = await open();
    await expect(p.getByRole("alert").first()).toBeVisible();
    if (taxonomyMode === "taxonomy-deny") {
      await expect(p.getByLabel("测评名称", { exact: true })).toBeDisabled();
      await expect(
        p.getByRole("button", { name: "保存测评信息", exact: true }),
      ).toBeDisabled();
      await expect(p.getByLabel("测评名称", { exact: true })).toHaveValue(
        "设置合成样例",
      );
      results.push(
        "taxonomy 401 after product read revokes the same authority and disables settings footer without clearing fields",
      );
    } else {
      await expect(p.getByLabel("测评名称", { exact: true })).toBeEnabled();
      await expect(
        p.getByRole("button", { name: "保存测评信息", exact: true }),
      ).toBeEnabled();
      results.push(
        "taxonomy 503 remains a read error and does not revoke product authority",
      );
    }
    expect(writes.length).toBe(0);
    await p.close();
  }
  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "settings-results.json"),
    JSON.stringify(
      {
        source: "current actual Studio settings components",
        evidence: "actual React with synthetic HTTP; no database",
        results,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: results.length, errors }));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
