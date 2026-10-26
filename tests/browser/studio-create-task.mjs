/** Real creation components with synthetic HTTP. No managed instance or user data. */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.resolve("package.json"));
const { chromium, expect } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
const postcss = createRequire(require.resolve("next/package.json"))("postcss");
const tailwind = require("@tailwindcss/postcss");
const out = path.resolve(".cache/studio-create-task", String(Date.now()));
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
await mkdir(out, { recursive: true });
await esbuild.build({
  stdin: {
    contents: `
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioShell} from '@/features/studio/shell';
import {invalidateCurrentStudioAuthority} from '@/features/studio/authority-events';
import {ProductCreatePage} from '@/features/studio/workspace/product-create';
window.revokeCreate=invalidateCurrentStudioAuthority;
import {ProductCreateTask, ProductCreateAction} from '@/features/studio/workspace/product-create-task';
const session={operator:{loginName:"synthetic.account",accountRevision:1,id:'00000000-0000-0000-0000-000000000007',displayName:'Synthetic',role:'operator'},csrfToken:'A'.repeat(43),idleExpiresAt:'2030-01-01T00:00:00.000Z',absoluteExpiresAt:'2030-01-01T00:00:00.000Z'};
function App(){const [query,setQuery]=useState('initial');window.changeCatalogQuery=setQuery;return <StudioShell authenticated identity={{label:session.operator.displayName,role:session.operator.role}} session={session}>{location.search.includes('deep=1')?<ProductCreatePage session={session}/>:<ProductCreateTask session={session}>{query==='invalid'?<main><h1>无法使用此列表地址</h1></main>:<main key={query}><h1>测评管理</h1><ProductCreateAction /></main>}<a href='/outside'>离开目录</a></ProductCreateTask>}</StudioShell>}
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
        b.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "navigation",
          namespace: "route",
        }));
        b.onLoad({ filter: /.*/, namespace: "route" }, () => ({
          contents: "export const usePathname=()=>location.pathname",
          loader: "js",
        }));
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
const globalsPath = path.resolve("src/app/globals.css");
const globals = await postcss([tailwind({ base: process.cwd() })]).process(
  await readFile(globalsPath, "utf8"),
  { from: globalsPath },
);
await writeFile(
  path.join(out, "probe.css"),
  globals.css + "\n" + (await readFile(path.join(out, "probe.css"), "utf8")),
);
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
          items: [
            {
              id: url.pathname.endsWith("categories")
                ? "00000000-0000-4000-8000-000000000101"
                : "00000000-0000-4000-8000-000000000102",
              name: url.pathname.endsWith("categories") ? "古风" : "合成标签",
              slug: "synthetic-choice",
              revision: 1,
              archivedAt: null,
              createdAt: "2026-10-25T00:00:00.000Z",
              updatedAt: "2026-10-25T00:00:00.000Z",
              assignedProductCount: 0,
            },
          ],
          total: 1,
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
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/probe.css"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}main>h1{font-size:28px;font-weight:700;margin-bottom:20px}</style><div id="root"></div><script src="/probe.js"></script>',
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
async function setup(nextMode, fill = true, deep = false) {
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
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("not focusable"))
      errors.push("invalid-hidden-control");
  });
  await page.goto(origin + (deep ? "/?deep=1" : "/"));
  if (!deep)
    await page.getByRole("button", { name: "新建测评", exact: true }).click();
  if (!fill) return { context, page };
  await page
    .getByRole("textbox", { name: "测评名称 *", exact: true })
    .fill("创建合成样例");
  await page
    .getByRole("textbox", { name: "测评编号（需与内容包一致）", exact: true })
    .fill("create-probe");
  return { context, page };
}
async function run(name, body) {
  if (only && !only.split(",").includes(name)) return;
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
  await run("empty-close", async () => {
    const { context, page } = await setup("normal", false);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.locator('form[aria-label="新建测评"]')).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "继续新建测评", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "新建测评", exact: true }).click();
    await page.evaluate(() => window.revokeCreate());
    await expect(
      page.getByRole("textbox", { name: "测评名称 *", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.locator('form[aria-label="新建测评"]')).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "继续新建测评", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "新建测评", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "测评名称 *", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "创建测评", exact: true }),
    ).toBeDisabled();
    expect(writes).toHaveLength(0);
    await context.close();
  });
  await run("discard-input", async () => {
    const { context, page } = await setup("normal");
    await page.getByRole("button", { name: "收起", exact: true }).click();
    await page
      .getByRole("button", { name: "继续新建测评", exact: true })
      .first()
      .click();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "放弃输入", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "测评名称 *", exact: true }),
    ).toHaveValue("创建合成样例");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "放弃输入", exact: true }).click();
    await expect(page.locator('form[aria-label="新建测评"]')).toHaveCount(0);
    await page.getByRole("button", { name: "新建测评", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "测评名称 *", exact: true }),
    ).toHaveValue("");
    expect(writes).toHaveLength(0);
    await context.close();
  });
  await run("layout-and-choices", async () => {
    const { context, page } = await setup("normal", false);
    await expect(
      page.getByRole("textbox", { name: "测评英文标识", exact: true }),
    ).toBeHidden();
    expect(reads).toHaveLength(0);
    for (const width of [1440, 390, 320, 375, 430]) {
      await page.setViewportSize({ width, height: 1000 });
      const dialog = page.locator("dialog:modal");
      await expect
        .poll(() =>
          dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      const controls = await dialog.evaluate((node) =>
        [...node.querySelectorAll("input,button,summary")]
          .filter((item) => item.getClientRects().length > 0)
          .map((item) => ({
            height: item.getBoundingClientRect().height,
            width: item.getBoundingClientRect().width,
            font: parseFloat(getComputedStyle(item).fontSize),
          })),
      );
      expect(
        controls.every(
          (item) => item.height >= 44 && item.width >= 44 && item.font >= 16,
        ),
      ).toBe(true);
      await page.screenshot({ path: path.join(out, `create-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect
      .poll(() =>
        page
          .locator("dialog:modal")
          .evaluate((node) => Math.round(node.getBoundingClientRect().width)),
      )
      .toBe(540);
    await page
      .locator("details > summary")
      .filter({ hasText: "选择分类" })
      .click();
    await page.getByRole("button", { name: "古风", exact: true }).click();
    await expect(
      page.locator("details > summary").filter({ hasText: "古风" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "搜索分类", exact: true }),
    ).toBeHidden();
    await page
      .getByRole("textbox", { name: "测评编号（需与内容包一致）", exact: true })
      .fill("create-probe");
    await page.getByText("更多设置", { exact: false }).click();
    await expect(
      page.getByRole("textbox", { name: "测评英文标识", exact: true }),
    ).toHaveValue("create-probe");
    await page
      .getByRole("textbox", { name: "测评英文标识", exact: true })
      .fill("custom-slug");
    await page
      .getByRole("textbox", { name: "测评编号（需与内容包一致）", exact: true })
      .fill("other-probe");
    await expect(
      page.getByRole("textbox", { name: "测评英文标识", exact: true }),
    ).toHaveValue("custom-slug");
    expect(writes).toHaveLength(0);
    await context.close();
  });
  await run("deep-link-form", async () => {
    const { context, page } = await setup("normal", false, true);
    await page
      .getByRole("textbox", { name: "测评编号（需与内容包一致）", exact: true })
      .fill("create-probe");
    await page.getByText("更多设置", { exact: false }).click();
    await expect(
      page.getByRole("textbox", { name: "测评英文标识", exact: true }),
    ).toHaveValue("create-probe");
    await expect(
      page.getByRole("textbox", { name: "测评名称 *", exact: true }),
    ).toBeVisible();
    expect(writes).toHaveLength(0);
    await context.close();
  });
  await run("hidden-slug", async () => {
    for (const invalid of ["", "Invalid Value"]) {
      const { context, page } = await setup("normal");
      const more = page
        .locator("details")
        .filter({
          has: page.locator("summary").filter({ hasText: "更多设置" }),
        })
        .first();
      await page.getByText("更多设置", { exact: false }).click();
      const slug = page.getByRole("textbox", {
        name: "测评英文标识",
        exact: true,
      });
      await slug.fill(invalid);
      await page.getByText("更多设置", { exact: false }).click();
      await expect(slug).toBeHidden();
      await page.getByRole("button", { name: "创建测评", exact: true }).click();
      await expect(more).toHaveAttribute("open", "");
      await expect(slug).toBeVisible();
      await expect(slug).toBeFocused();
      await expect(
        page.getByText("请填写有效的英文标识：使用小写字母、数字和连字符。", {
          exact: true,
        }),
      ).toBeVisible();
      expect(writes).toHaveLength(0);
      await context.close();
    }
  });
  await run("retained-query", async () => {
    const { context, page } = await setup("normal");
    const input = await page
      .getByRole("textbox", { name: "测评名称 *", exact: true })
      .elementHandle();
    await page.getByRole("button", { name: "收起", exact: true }).click();
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
    await page.getByText("更多设置", { exact: false }).click();
    await expect(
      page.getByRole("textbox", { name: "测评英文标识", exact: true }),
    ).toHaveValue("create-probe");
    await page.getByText("更多设置", { exact: false }).click();
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
    await page.getByRole("button", { name: "收起", exact: true }).click();
    await expect(page.locator("dialog:modal")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "放弃输入", exact: true }),
    ).toHaveCount(0);
    json(heldWrite, 503, { code: "WRITE_OUTCOME_UNKNOWN" });
    heldWrite = undefined;
    await page
      .getByRole("button", { name: "核实创建结果", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "收起", exact: true }).click();
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
    await expect(
      page.getByRole("button", { name: "放弃输入", exact: true }),
    ).toHaveCount(0);
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
    await page.getByRole("button", { name: "收起", exact: true }).click();
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
      await page
        .locator("details > summary")
        .filter({ hasText: "选择分类" })
        .click();
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
    await page
      .locator("details > summary")
      .filter({ hasText: "选择分类" })
      .click();
    await page
      .getByRole("textbox", { name: "搜索分类", exact: true })
      .fill("古风");
    await page
      .getByRole("textbox", { name: "搜索分类", exact: true })
      .press("Enter");
    expect(writes).toHaveLength(0);
    await page.getByRole("button", { name: "古风", exact: true }).click();
    await page.getByText("更多设置", { exact: false }).click();
    await page
      .locator("details > summary")
      .filter({ hasText: "选择标签" })
      .click();
    await page
      .getByRole("textbox", { name: "搜索标签", exact: true })
      .fill("合成");
    await page
      .getByRole("textbox", { name: "搜索标签", exact: true })
      .press("Enter");
    await page.getByRole("button", { name: "合成标签", exact: true }).click();
    expect(writes).toHaveLength(0);
    await page.getByRole("button", { name: "创建测评", exact: true }).click();
    await page.waitForURL("**/studio/products/create-probe");
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toMatchObject({
      id: "create-probe",
      slug: "create-probe",
      title: "创建合成样例",
      primaryCategoryId: "00000000-0000-4000-8000-000000000101",
      tagIds: ["00000000-0000-4000-8000-000000000102"],
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
