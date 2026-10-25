/** Real creation components with synthetic HTTP. No managed instance or user data. */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.resolve("package.json"));
const { chromium, expect } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
const out = path.resolve(".cache/studio-create-task", String(Date.now()));
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
await mkdir(out, { recursive: true });
await esbuild.build({
  stdin: {
    contents: `
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioNavigationBoundary} from '@/features/studio/navigation-boundary';
import {ProductCreateTask, ProductCreateAction} from '@/features/studio/workspace/product-create-task';
const session={operator:{id:'00000000-0000-0000-0000-000000000007',label:'Synthetic',role:'operator'},csrfToken:'A'.repeat(43),idleExpiresAt:'2030-01-01T00:00:00.000Z',absoluteExpiresAt:'2030-01-01T00:00:00.000Z'};
function App(){const [query,setQuery]=useState('initial');window.changeCatalogQuery=setQuery;return <StudioNavigationBoundary><ProductCreateTask session={session}>{query==='invalid'?<main><h1>无法使用此列表地址</h1></main>:<main key={query}><h1>测评管理</h1><ProductCreateAction /></main>}<a href='/outside'>离开目录</a></ProductCreateTask></StudioNavigationBoundary>}
createRoot(document.getElementById('root')).render(<App/>);`,
    loader: "tsx",
    resolveDir: process.cwd(),
    sourcefile: "create-task-probe.tsx",
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
let mode = "normal",
  writes = [],
  reads = [],
  heldWrite,
  heldRead;
const product = (id) => ({
  id,
  slug: id,
  title: "创建合成样例",
  metadataRevision: 1,
  primaryCategory: null,
  tags: [],
  archivedAt: null,
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z",
});
const json = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/probe.js" || url.pathname === "/probe.css") {
      res.setHeader(
        "content-type",
        url.pathname.endsWith("js") ? "text/javascript" : "text/css",
      );
      res.end(await readFile(path.join(out, path.basename(url.pathname))));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        writes.push({ path: url.pathname, body: JSON.parse(body) });
        if (mode === "held-write") {
          heldWrite = res;
          return;
        }
        if (mode === "success") {
          json(res, 201, product(JSON.parse(body).id));
          return;
        }
        json(res, 503, { code: "WRITE_OUTCOME_UNKNOWN" });
        return;
      }
      reads.push(url.pathname);
      if (
        url.pathname === "/api/studio/categories" ||
        url.pathname === "/api/studio/tags"
      ) {
        if (
          url.pathname.endsWith("categories") &&
          mode.startsWith("taxonomy-")
        ) {
          json(res, mode === "taxonomy-deny" ? 401 : 503, {
            code:
              mode === "taxonomy-deny"
                ? "UNAUTHENTICATED"
                : "STUDIO_UNAVAILABLE",
          });
          return;
        }
        json(res, 200, {
          items: [],
          total: 0,
          page: 1,
          pageSize: 10,
          hasNext: false,
        });
        return;
      }
      if (mode === "held-read") {
        heldRead = res;
        return;
      }
      if (mode === "found") {
        json(res, 200, product("create-probe"));
        return;
      }
      json(res, 404, { code: "PRODUCT_NOT_FOUND" });
      return;
    }
    res.setHeader("content-type", "text/html");
    if (url.pathname.startsWith("/studio/products/")) {
      res.end("<h1>Created workspace</h1>");
      return;
    }
    res.end(
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/probe.css"><style>body{margin:0;padding:24px;background:#f5f6fa;color:#202743;font:16px/1.55 system-ui}button,input,select{font:inherit}main{min-height:200px}</style><div id="root"></div><script src="/probe.js"></script>',
    );
  } catch (error) {
    json(res, 500, { code: error.name });
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [],
  errors = [];
async function setup(nextMode) {
  mode = nextMode;
  writes = [];
  reads = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (e) => errors.push(e.name));
  await page.goto(origin);
  await page.getByRole("button", { name: "新建测评", exact: true }).click();
  await page
    .getByRole("textbox", { name: "测评名称 *", exact: true })
    .fill("创建合成样例");
  await page
    .getByRole("textbox", { name: "测评编号（需与内容包一致）", exact: true })
    .fill("create-probe");
  return { context, page };
}
async function run(name, body) {
  if (only && only !== name) return;
  await body();
  results.push({
    name,
    passed: true,
    writes: writes.length,
    reads: [...reads],
  });
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
}
try {
  await run("retained-query", async () => {
    const { context, page } = await setup("normal");
    const input = await page
      .getByRole("textbox", { name: "测评名称 *", exact: true })
      .elementHandle();
    await page.getByRole("button", { name: "先返回", exact: true }).click();
    await page.evaluate(() => window.changeCatalogQuery("filtered"));
    await page
      .getByRole("button", { name: "继续新建测评", exact: true })
      .last()
      .click();
    expect(
      await page
        .getByRole("textbox", { name: "测评名称 *", exact: true })
        .evaluate((n, old) => n === old, input),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.changeCatalogQuery("invalid"));
    await page
      .getByRole("heading", { name: "无法使用此列表地址", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "继续新建测评", exact: true })
      .click();
    expect(
      await page
        .getByRole("textbox", { name: "测评名称 *", exact: true })
        .evaluate((n, old) => n === old, input),
    ).toBe(true);
    await expect(
      page.getByRole("textbox", { name: "测评英文标识", exact: true }),
    ).toHaveValue("create-probe");
    await page.screenshot({ path: path.join(out, "create-1440.png") });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({ path: path.join(out, "create-320.png") });
    expect(writes).toHaveLength(0);
    await context.close();
  });
  await run("busy-unknown", async () => {
    const { context, page } = await setup("held-write");
    const input = await page
      .getByRole("textbox", { name: "测评名称 *", exact: true })
      .elementHandle();
    await page.getByRole("button", { name: "创建测评", exact: true }).click();
    await expect.poll(() => Boolean(heldWrite)).toBe(true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "先返回", exact: true }).click();
    await expect(page.locator("dialog:modal")).toBeVisible();
    json(heldWrite, 503, { code: "WRITE_OUTCOME_UNKNOWN" });
    heldWrite = undefined;
    await page
      .getByRole("button", { name: "核实创建结果", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "先返回", exact: true }).click();
    await page
      .getByRole("button", { name: "继续新建测评", exact: true })
      .first()
      .click();
    expect(
      await page
        .getByRole("textbox", { name: "测评名称 *", exact: true })
        .evaluate((n, old) => n === old, input),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "创建测评", exact: true }),
    ).toBeDisabled();
    mode = "held-read";
    await page
      .getByRole("button", { name: "核实创建结果", exact: true })
      .click();
    await expect.poll(() => Boolean(heldRead)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog:modal")).toBeVisible();
    json(heldRead, 404, { code: "PRODUCT_NOT_FOUND" });
    heldRead = undefined;
    await page
      .getByRole("button", { name: "核实后继续编辑创建表单", exact: true })
      .waitFor();
    await expect(
      page.getByRole("button", { name: "创建测评", exact: true }),
    ).toBeDisabled();
    expect(reads).toContain("/api/studio/products/create-probe");
    expect(writes).toHaveLength(1);
    await page
      .getByRole("button", { name: "核实后继续编辑创建表单", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "创建测评", exact: true }),
    ).toBeEnabled();
    expect(writes).toHaveLength(1);
    await context.close();
  });
  await run("found-and-revoked", async () => {
    const { context, page } = await setup("normal");
    await page.getByRole("button", { name: "创建测评", exact: true }).click();
    await page
      .getByRole("button", { name: "核实创建结果", exact: true })
      .waitFor();
    mode = "found";
    await page
      .getByRole("button", { name: "核实创建结果", exact: true })
      .click();
    await expect(
      page.getByText(
        "服务器当前值已确认，存在此编号。不能仅凭当前值证明原请求确定成功，请查看记录。",
        { exact: true },
      ),
    ).toBeVisible();
    await page.evaluate(() =>
      window.dispatchEvent(
        new Event("quizforge:studio-authority-invalidated:v1"),
      ),
    );
    await page.getByRole("button", { name: "先返回", exact: true }).click();
    await page
      .getByRole("button", { name: "继续新建测评", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("textbox", { name: "测评名称 *", exact: true }),
    ).toHaveValue("创建合成样例");
    await expect(
      page.getByRole("button", { name: "创建测评", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "核实创建结果", exact: true }),
    ).toBeDisabled();
    expect(writes).toHaveLength(1);
    expect(new URL(page.url()).pathname).toBe("/");
    await context.close();
  });
  await run("taxonomy-authority", async () => {
    for (const nextMode of ["taxonomy-deny", "taxonomy-unavailable"]) {
      mode = nextMode;
      writes = [];
      reads = [];
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      await page.goto(origin);
      await page.getByRole("button", { name: "新建测评", exact: true }).click();
      if (nextMode === "taxonomy-deny")
        await expect(
          page.getByRole("textbox", { name: "测评名称 *", exact: true }),
        ).toBeDisabled();
      else {
        await page
          .getByText("Studio 暂不可用，请由本机维护者检查配置与数据库。", {
            exact: true,
          })
          .waitFor();
        await expect(
          page.getByRole("textbox", { name: "测评名称 *", exact: true }),
        ).toBeEnabled();
      }
      expect(writes).toHaveLength(0);
      await context.close();
    }
  });
  await run("confirmed-success", async () => {
    const { context, page } = await setup("success");
    await page.getByRole("button", { name: "创建测评", exact: true }).click();
    await page.waitForURL("**/studio/products/create-probe");
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({
      id: "create-probe",
      slug: "create-probe",
      title: "创建合成样例",
    });
    await context.close();
  });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ out, results, errors }));
} catch (error) {
  await writeFile(path.join(out, "failure.txt"), String(error.stack));
  throw error;
} finally {
  if (heldRead && !heldRead.writableEnded)
    json(heldRead, 503, { code: "STUDIO_UNAVAILABLE" });
  if (heldWrite && !heldWrite.writableEnded)
    json(heldWrite, 503, { code: "WRITE_OUTCOME_UNKNOWN" });
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
