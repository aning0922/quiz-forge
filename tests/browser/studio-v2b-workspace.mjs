/** Actual four-task React owners + synthetic HTTP. No application database or author data. */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { projectProductOperations } from "@/features/studio/operations/projection";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY } from "@/features/product/internal-play/implementation-catalog";
const require2 = createRequire(path.resolve("package.json"));
const esbuild = createRequire(require2.resolve("tsx/package.json"))("esbuild");
const postcss = createRequire(require2.resolve("next/package.json"))("postcss");
const tailwind = require2("@tailwindcss/postcss");
const out = path.resolve(".cache/studio-v2b-workspace", String(Date.now()));
await mkdir(out, { recursive: true });
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const id = "v2b-product",
  uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  now = "2026-10-26T00:00:00.000Z";
const hash = (text) => createHash("sha256").update(text).digest("hex"),
  content = "{}",
  assets = "[]";
const target = (revision2) => ({
  draftId: uuid(1),
  revision: revision2,
  canonicalContentSha256: hash(content),
  assetSetSha256: hash(assets),
  canonicalManifestSha256: "c".repeat(64),
});
const product = {
  id,
  slug: id,
  title: "合成测评 \xB7 当前与历史独立",
  metadataRevision: 1,
  primaryCategory: null,
  tags: [],
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};
const draft = (revision2) => ({
  ...target(revision2),
  productId: id,
  applicationId: uuid(2),
  sourceImportId: uuid(3),
  sourceValidationId: uuid(4),
  candidateSha256: "d".repeat(64),
  containerSchemaVersion: "quizpack.v1",
  contentSchemaVersion: "quizpack-content.v2",
  contentKind: "synthetic",
  packId: id,
  packVersion: "1.0.0",
  versions: {
    contentVersion: "1.0.0",
    visualVersion: "1.0.0",
    reportVersion: "1.0.0",
    resourceVersion: "1.0.0",
    componentVersion: "2.0.0",
    engine: { id: "archetype", version: "1.0.0" },
  },
  resourceCount: 1,
  createdAt: now,
  createdBy: uuid(7),
  platformApproval: "unverified",
  publishable: false,
});
let role = "admin",
  revision = 3,
  fixedFail = false,
  summaryMode = "normal",
  currentDraftId = uuid(1),
  heldSummary,
  reads = [],
  writes = [];
const session = () => ({
  operator: {
    id: uuid(7),
    label: "合成管理员",
    displayName: "合成管理员",
    loginName: "synthetic.admin",
    role,
  },
  csrfToken: "A".repeat(43),
  idleExpiresAt: "2030-01-01T00:00:00.000Z",
  absoluteExpiresAt: "2030-01-01T00:00:00.000Z",
});
function operations() {
  return projectProductOperations(product, now, {
    reception: { total: 0, latest: null },
    validation: { total: 0, latest: null },
    draft:
      summaryMode === "empty"
        ? null
        : {
            target: { ...target(revision), draftId: currentDraftId },
            sourceImportId: uuid(3),
            sourceValidationId: uuid(4),
            sourceValidationStateRevision: 1,
            candidateSha256: "d".repeat(64),
            createdAt: now,
          },
    reviews: [],
    versions: [],
    testing: [],
  });
}
await esbuild.build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {StudioShell} from '@/features/studio/shell';
import {ProductWorkspaceFrame} from '@/features/studio/product-workspace/frame';
import {useProductWorkspaceContext} from '@/features/studio/product-workspace/context';
function ReadProbe(){const value=useProductWorkspaceContext();window.refreshWorkspace=value.read.refresh;return null;}
import {ProductTaskWorkspace} from '@/features/studio/product-workspace/task-workspace';
import {DraftRevisionPage} from '@/features/studio/drafts/read-page';
import {invalidateCurrentStudioAuthority} from '@/features/studio/authority-events';
const input=JSON.parse(document.querySelector('#fixture').textContent);
function App(){const [entry,setEntry]=useState(input.entry);window.navigateTask=setEntry;window.revokeWorkspace=invalidateCurrentStudioAuthority;return <StudioShell authenticated identity={input.session.operator} session={input.session}><ProductWorkspaceFrame productId=input.productId><ReadProbe/><>{input.detail?<DraftRevisionPage productId={input.productId} draftId={input.draftId} revision={1} navigation={null}/>:<ProductTaskWorkspace session={input.session} initialTask={entry.task} initialPanel={entry.panel} initialScope={entry.scope} consumerScope={input.scope} consumerRenderer={input.renderer}/>}</></ProductWorkspaceFrame></StudioShell>}
createRoot(document.getElementById('root')).render(<App/>);`.replace(
      "productId=input.productId",
      "productId={input.productId}",
    ),
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  outfile: path.join(out, "probe.js"),
  bundle: true,
  external: ["/assets/*"],
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  logLevel: "silent",
  plugins: [
    {
      name: "fixed-route",
      setup(b) {
        b.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "navigation",
          namespace: "probe",
        }));
        b.onResolve({ filter: /^node:util$/ }, () => ({
          path: "policy",
          namespace: "probe",
        }));
        b.onLoad({ filter: /.*/, namespace: "probe" }, ({ path: p }) => ({
          contents:
            p === "navigation"
              ? "export const usePathname=()=>location.pathname;export const useRouter=()=>({replace(){},refresh(){},push(){}})"
              : 'export const types=new Proxy({}, {get(){throw Error("UNEXPECTED_NODE_POLICY")}})',
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
const json = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    if (p === "/probe.js" || p === "/probe.css") {
      res.setHeader(
        "content-type",
        p.endsWith("js") ? "text/javascript" : "text/css",
      );
      res.end(await readFile(path.join(out, path.basename(p))));
      return;
    }
    if (p.startsWith("/api/")) {
      if (req.method !== "GET") {
        let text = "";
        for await (const chunk of req) text += chunk;
        writes.push({ path: p, body: JSON.parse(text) });
        json(res, 503, { code: "WRITE_OUTCOME_UNKNOWN", requestId: uuid(99) });
        return;
      }
      reads.push(p + url.search);
      if (p === "/api/studio/operations/products/" + id) {
        if (summaryMode === "hold") {
          heldSummary = res;
          return;
        }
        if (summaryMode === "fail") {
          json(res, 503, { code: "STUDIO_UNAVAILABLE", requestId: uuid(99) });
          return;
        }
        json(res, 200, operations());
        return;
      }
      if (p.endsWith("/auth/session")) {
        json(res, 200, session());
        return;
      }
      if (p.endsWith("/imports/settings")) {
        json(res, 200, {
          enabled: true,
          maxArchiveBytes: 33554432,
          receiveTimeoutMs: 6e4,
        });
        return;
      }
      if (p.endsWith("/draft")) {
        json(res, 200, { kind: "draft", draft: draft(revision) });
        return;
      }
      const historyPath = p.match(/\/drafts\/([^/]+)\/revisions$/);
      if (historyPath) {
        const size = Number(url.searchParams.get("pageSize")),
          anchor = historyPath[1] === uuid(1) ? 3 : revision;
        json(res, 200, {
          productId: id,
          draftId: historyPath[1],
          anchorRevision: anchor,
          beforeRevision: anchor + 1,
          pageSize: size,
          items: Array.from({ length: anchor }, (_, i) => ({
            ...draft(anchor - i),
            draftId: historyPath[1],
          })),
          nextBeforeRevision: null,
        });
        return;
      }
      const r = p.match(
        /\/drafts\/[^/]+\/revisions\/(\d+)(\/internal-review)?$/,
      );
      if (r) {
        const n = Number(r[1]);
        if (r[2])
          json(res, 200, {
            ok: true,
            value: {
              productId: id,
              target: target(n),
              observedCurrentRevision: revision,
              review: null,
              baseline: null,
              rendererChoices: [],
              engine: null,
            },
          });
        else if (fixedFail)
          json(res, 503, { code: "STUDIO_UNAVAILABLE", requestId: uuid(99) });
        else
          json(res, 200, {
            draft: draft(n),
            canonicalContentText: content,
            assetSetText: assets,
          });
        return;
      }
      if (p.endsWith("/internal-versions")) {
        json(res, 200, { ok: true, value: { productId: id, versions: [] } });
        return;
      }
      if (p.endsWith("/play-versions")) {
        json(res, 200, { productId: id, versions: [] });
        return;
      }
      if (p.endsWith("/access-keys")) {
        json(res, 200, { productId: id, keys: [], nextCursor: null });
        return;
      }
      if (p === "/api/studio/products/" + id) {
        json(res, 200, product);
        return;
      }
      if (
        p.endsWith("/categories") ||
        p.endsWith("/tags") ||
        p.endsWith("/imports")
      ) {
        json(res, 200, {
          items: [],
          page: 1,
          pageSize: 10,
          total: 0,
          hasNext: false,
        });
        return;
      }
      json(res, 503, { code: "STUDIO_UNAVAILABLE", requestId: uuid(99) });
      return;
    }
    const q = url.searchParams,
      task = q.get("task") || "content",
      scope = q.has("revision")
        ? {
            productId: id,
            draftId: uuid(1),
            revision: Number(q.get("revision")),
          }
        : void 0;
    const input = {
      productId: id,
      detail: p.includes("/drafts/"),
      draftId: uuid(1),
      session: session(),
      entry: { task, scope, panel: q.get("panel") || void 0 },
      scope: {
        origin: `http://127.0.0.1:${server.address().port}`,
        instanceId: "9".repeat(32),
        issuerId: uuid(7),
        productId: id,
      },
      renderer: CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1_2,
    };
    res.setHeader("content-type", "text/html");
    res.end(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><div id="root"></div><script type="application/json" id="fixture">' +
        JSON.stringify(input) +
        '<\/script><script src="/probe.js"><\/script>',
    );
  } catch (error) {
    json(res, 500, {
      code: error instanceof Error ? error.name : "TEST_ERROR",
    });
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`,
  browser = await chromium.launch(),
  results = [],
  errors = [];
let context, page;
async function open(nextRole = "admin", query = "", initialSummary = "normal") {
  if (context) await context.close();
  role = nextRole;
  revision = 3;
  fixedFail = false;
  summaryMode = initialSummary;
  currentDraftId = uuid(1);
  reads = [];
  writes = [];
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.setDefaultTimeout(6e3);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/studio/products/" + id + query);
  if (initialSummary === "normal" || initialSummary === "empty")
    await expect(
      page.getByRole("heading", { name: product.title, exact: true }),
    ).toBeVisible();
}
const button = (name) =>
  page.getByRole("button", { name, exact: true }).filter({ visible: true });
async function run(name, body) {
  if (only && !only.split(",").includes(name)) return;
  await body();
  results.push(name);
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
}
async function noOverflow() {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (await page.locator("dialog:modal").count())
    expect(
      await page
        .locator("dialog:modal")
        .evaluate((n) => n.scrollWidth <= n.clientWidth),
    ).toBe(true);
}
try {
  await run("composition", async () => {
    await open();
    const nav = page.getByRole("navigation", {
      name: "测评核心任务",
    });
    await expect(nav.getByRole("button")).toHaveCount(4);
    for (const [task, label] of [
      ["content", "内容制作"],
      ["preview", "体验预览"],
      ["review", "审核封存"],
      ["testing", "内测发放"],
    ]) {
      await nav.getByRole("button", { name: label, exact: true }).click();
      await expect(
        nav.getByRole("button", { name: label, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect
        .poll(() =>
          nav
            .getByRole("button", { name: label, exact: true })
            .evaluate((node) => getComputedStyle(node).backgroundColor),
        )
        .toBe("rgb(255, 255, 255)");
      if (task === "testing")
        await expect(
          page.getByRole("table", {
            name: "本次读取的访问码记录，不代表全量统计",
          }),
        ).toBeVisible();
      if (task === "review")
        await expect(
          page.getByText("此界面不能自动生成或授予人工审批。", {
            exact: false,
          }),
        ).toBeVisible();
      await noOverflow();
      await writeFile(
        path.join(out, `tab-${task}.json`),
        JSON.stringify(
          await nav.getByRole("button").evaluateAll((nodes) =>
            nodes.map((node) => ({
              label: node.textContent,
              current: node.getAttribute("aria-current"),
              background: getComputedStyle(node).backgroundColor,
            })),
          ),
          null,
          2,
        ),
      );
      await page.screenshot({
        path: path.join(out, `workspace-${task}-1440.png`),
      });
    }
    await nav.getByRole("button", { name: "内容制作", exact: true }).click();
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 1e3 });
      await noOverflow();
      await expect(
        page.getByRole("complementary", {
          name: "测评对象与操作说明",
        }),
      ).toBeVisible();
      if (width === 390)
        await page.screenshot({
          path: path.join(out, "workspace-content-390.png"),
        });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await button("记录与历史").click();
    await expect(page.locator("dialog:modal")).toHaveCount(1);
    expect(
      await page
        .locator("dialog:modal")
        .evaluate((n) => Math.round(n.getBoundingClientRect().width)),
    ).toBe(460);
    await page.screenshot({
      path: path.join(out, "workspace-history-1440.png"),
    });
    await button("关闭详情").click();
    await button("基本设置").click();
    await expect(page.getByLabel("测评名称")).toBeVisible();
    await page.screenshot({
      path: path.join(out, "workspace-settings-1440.png"),
    });
    await button("关闭详情").click();
    await button("更新内容包").click();
    await expect(page.locator("input[type=file]")).toBeVisible();
    expect(
      await page
        .locator("dialog:modal")
        .evaluate((n) => Math.round(n.getBoundingClientRect().width)),
    ).toBe(640);
    await page.screenshot({
      path: path.join(out, "workspace-content-task-1440.png"),
    });
  });
  await run("retained-file-unknown", async () => {
    await open("operator");
    await button("更新内容包").click();
    const file = page.locator("input[type=file]");
    await file.setInputFiles({
      name: "synthetic.quizpack",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("synthetic isolated file"),
    });
    await expect(button("建立本次接收记录")).toBeEnabled();
    const handle = await file.elementHandle();
    await file.evaluate((n) => (window.originalFile = n.files[0]));
    await button("关闭当前浮层").click();
    await button("刷新当前状态").click();
    await button("继续内容制作").click();
    expect(await file.evaluate((n, old) => n === old, handle)).toBe(true);
    expect(await file.evaluate((n) => n.files[0] === window.originalFile)).toBe(
      true,
    );
    await button("建立本次接收记录").click();
    await expect(button("按原操作核实")).toBeVisible();
    expect(writes).toHaveLength(1);
    const original = structuredClone(writes[0]);
    await button("关闭当前浮层").click();
    revision = 4;
    await button("刷新当前状态").click();
    await page.evaluate((next) => window.navigateTask(next), {
      task: "review",
      scope: { productId: id, draftId: uuid(1), revision: 1 },
    });
    await expect(
      page.getByText("本次地址中的新目标未接管原任务", { exact: false }),
    ).toBeVisible();
    await button("继续内容制作").click();
    expect(await file.evaluate((n, old) => n === old, handle)).toBe(true);
    expect(await file.evaluate((n) => n.files[0] === window.originalFile)).toBe(
      true,
    );
    await page.evaluate(() => window.revokeWorkspace());
    await expect(file).toBeDisabled();
    expect(writes).toEqual([original]);
    await page.screenshot({
      path: path.join(out, "workspace-unknown-retained-1440.png"),
    });
  });
  await run("role-review", async () => {
    for (const nextRole of ["admin", "operator", "read-only"]) {
      await open(nextRole, "?task=review");
      await expect(
        page.getByText("当前版本尚无可直接使用的批准依据。", { exact: false }),
      ).toBeVisible();
      if (nextRole === "operator")
        await expect(
          page.getByText("需管理员核对并完成审核封存。", { exact: false }),
        ).toBeVisible();
      if (nextRole === "read-only")
        await expect(
          page.getByText("只读身份可查看审核状态，不能登记依据或封存版本。", {
            exact: true,
          }),
        ).toBeVisible();
      expect(writes).toHaveLength(0);
    }
  });
  await run("fixed-url-target", async () => {
    await open("operator", "?task=review&revision=1");
    await expect(
      page.getByText("固定处理目标 r1", {
        exact: true,
      }),
    ).toBeVisible();
    expect(reads.some((p) => p.endsWith("/revisions/1/internal-review"))).toBe(
      true,
    );
    expect(reads.some((p) => p.endsWith("/revisions/3/internal-review"))).toBe(
      false,
    );
    revision = 4;
    await button("刷新当前状态").click();
    await expect(
      page.getByText("后台摘要已是 r4，本任务仍绑定 r1。", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "测评核心任务" })
      .getByRole("button", { name: "体验预览", exact: true })
      .click();
    await expect(
      page.getByText("选择目标：r1 \xB7 固定修订", { exact: true }),
    ).toBeVisible();
    expect(writes).toHaveLength(0);
  });
  await run("failed-fixed-no-latest", async () => {
    await open("read-only", "?task=preview&revision=1");
    await expect(
      page.getByText("选择目标：r1 \xB7 固定修订", { exact: true }),
    ).toBeVisible();
    await page.evaluate((next) => window.navigateTask(next), {
      task: "preview",
      scope: { productId: id, draftId: uuid(1), revision: 2 },
    });
    fixedFail = true;
    await expect(
      page.getByText("不会改为当前最新修订", { exact: false }),
    ).toBeVisible();
    await expect(button("体验 r3 完整流程")).toHaveCount(0);
    expect(writes).toHaveLength(0);
  });
  await run("formal-detail-frame", async () => {
    await open("read-only", "/drafts/" + uuid(1) + "/revisions/1");
    const nav = page.getByRole("navigation", { name: "测评核心任务" });
    await expect(nav.getByRole("link")).toHaveCount(4);
    for (const task of ["content", "preview", "review", "testing"])
      await expect(nav.locator(`a[href$="?task=${task}"]`)).toBeVisible();
    await expect(
      page.getByText("固定目标：修订 1", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "测评对象与操作说明" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "商品操作流程" }),
    ).toHaveCount(0);
    await page.getByText("固定修订完整正文与素材集合", { exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "完整内容正文" }),
    ).toHaveValue("{}");
    expect(reads).toContain(
      `/api/studio/products/${id}/drafts/${uuid(1)}/revisions/1`,
    );
    expect(reads).not.toContain(
      `/api/studio/products/${id}/drafts/${uuid(1)}/revisions/3`,
    );
    await noOverflow();
    await page.screenshot({
      path: path.join(out, "workspace-formal-revision-1440.png"),
    });
  });
  await run("revisions-url", async () => {
    const historyReads = () =>
      reads.filter((value) => /\/drafts\/[^/]+\/revisions\?/.test(value));
    await open("read-only", "?task=content&panel=revisions", "hold");
    const dialog = page.getByRole("dialog", {
      name: "内容修订记录",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("正在读取草稿范围，请稍候…", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("尚无可读取的草稿修订。", { exact: true }),
    ).toHaveCount(0);
    expect(historyReads()).toHaveLength(0);
    await expect.poll(() => Boolean(heldSummary)).toBe(true);
    summaryMode = "normal";
    json(heldSummary, 200, operations());
    heldSummary = undefined;
    await expect(dialog.getByText("修订 r3", { exact: true })).toBeVisible();
    expect(historyReads()).toEqual([
      `/api/studio/products/${id}/drafts/${uuid(1)}/revisions?pageSize=20`,
    ]);
    const row = await dialog
      .getByText("修订 r3", { exact: true })
      .elementHandle();
    revision = 4;
    currentDraftId = uuid(11);
    await page.evaluate(() => window.refreshWorkspace());
    await expect
      .poll(() =>
        page
          .locator("header")
          .allTextContents()
          .then((values) => values.join(" ").includes("草稿 r4")),
      )
      .toBe(true);
    expect(
      await dialog
        .getByText("修订 r3", { exact: true })
        .evaluate((node, old) => node === old, row),
    ).toBe(true);
    expect(historyReads()).toHaveLength(1);
    expect(historyReads().some((value) => value.includes(uuid(11)))).toBe(
      false,
    );
    summaryMode = "fail";
    await page.evaluate(() => window.refreshWorkspace());
    await expect(
      page.getByText("当前状态读取失败，已保留任务不会被替换。", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(dialog.getByText("修订 r3", { exact: true })).toBeVisible();
    expect(historyReads()).toHaveLength(1);
    await open("read-only", "?task=content&panel=revisions", "fail");
    await expect(
      page.getByRole("dialog", { name: "内容修订记录", exact: true }),
    ).toContainText("草稿范围读取失败，尚不能判定是否存在可读修订。");
    await expect(
      page.getByText("尚无可读取的草稿修订。", { exact: true }),
    ).toHaveCount(0);
    expect(historyReads()).toHaveLength(0);
    summaryMode = "normal";
    await button("重新读取草稿范围").click();
    await expect(page.getByText("修订 r3", { exact: true })).toBeVisible();
    expect(historyReads()).toHaveLength(1);
    await open("read-only", "?task=content&panel=revisions", "empty");
    await expect(
      page.getByText("尚无可读取的草稿修订。", { exact: true }),
    ).toBeVisible();
    expect(historyReads()).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ out, results, errors }));
} catch (error) {
  if (page)
    await writeFile(
      path.join(out, "browser-failure.json"),
      JSON.stringify(
        { reads, errors, text: await page.locator("body").innerText() },
        null,
        2,
      ),
    );
  await writeFile(
    path.join(out, "failure.txt"),
    String(error instanceof Error ? error.stack : error),
  );
  throw error;
} finally {
  if (heldSummary && !heldSummary.writableEnded)
    json(heldSummary, 503, { code: "STUDIO_UNAVAILABLE", requestId: uuid(99) });
  await browser.close();
  await new Promise((resolve) => server.close(() => resolve()));
}
