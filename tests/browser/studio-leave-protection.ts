/** Actual React + browser navigation, synthetic import HTTP; no DB or author data. */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import type { ImportDto } from "@/features/quizpack/import/contracts";

const out = path.resolve(".cache/studio-a1-leave", String(Date.now()));
await mkdir(out, { recursive: true, mode: 0o700 });
const require = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await require("esbuild").build({
  stdin: {
    contents: `
    import {createRoot} from "react-dom/client";
    import {useState} from "react";
    import {StudioNavigationBoundary,useStudioLeaveProtection} from "@/features/studio/navigation-boundary";
    import {subscribeStudioAuthorityInvalidation} from "@/features/studio/authority-events";
    import {CreateReceive} from "@/features/studio/imports/create-receive";
    let invalidations=0;
    subscribeStudioAuthorityInvalidation(()=>{invalidations++});
    window.probe=()=>({invalidations,uploadSame:window.uploadSame});
    const fetchOriginal=window.fetch;
    window.fetch=(url,init)=>{
      if(init?.method==='PUT') window.uploadSame=init.body===window.originalFile;
      return fetchOriginal(url,init);
    };
    function Field({name}){
      const [value,setValue]=useState('');
      useStudioLeaveProtection({dirty:!!value,pending:false});
      return <label>{name}<input value={value} onChange={e=>setValue(e.target.value)}/></label>
    }
    function Form(){const [first,setFirst]=useState(true);return <>
      {first&&<Field name="第一项"/>}<Field name="第二项"/>
      <button onClick={()=>setFirst(false)}>卸载第一项</button></>}
    const file=location.pathname.includes('/imports');
    createRoot(document.getElementById('root')).render(
      <StudioNavigationBoundary>
        <a href="/studio/products">测评管理</a>
        <a href="/studio/new-product">新建测评</a>
        <a href="/studio/products/example/imports">原包接收</a>
        <form action="/studio/products" data-studio-navigation-form><input name="q" aria-label="搜索"/><button>搜索</button></form>
        {file?<CreateReceive productId="example" settings={{enabled:true,maxArchiveBytes:33554432,receiveTimeoutMs:60000}}
          session={{operator:{id:'00000000-0000-0000-0000-000000000007',label:'Synthetic',role:'operator'},csrfToken:'A'.repeat(43),idleExpiresAt:'2030-01-01T00:00:00.000Z',absoluteExpiresAt:'2030-01-01T00:00:00.000Z'}} onChanged={()=>{}}/>
          :location.pathname==='/studio/new-product'?<Form/>:<h1>目录</h1>}
      </StudioNavigationBoundary>);
  `,
    loader: "tsx",
    resolveDir: process.cwd(),
    sourcefile: "studio-leave-probe.tsx",
  },
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
let intent: ImportDto | undefined;
let posts = 0,
  uploads = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST") {
      posts++;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      intent = {
        id: "00000000-0000-0000-0000-000000000001",
        productId: "example",
        status: "awaiting-upload",
        stateRevision: 1,
        expectedArchiveBytes: input.expectedArchiveBytes,
        expectedArchiveSha256: input.expectedArchiveSha256,
        actualArchiveBytes: null,
        actualArchiveSha256: null,
        createdAt: "2026-10-24T00:00:00.000Z",
        updatedAt: "2026-10-24T00:00:00.000Z",
        receivedAt: null,
        storageCondition: "clean",
        lastErrorCode: null,
        validationStatus: "not-run",
        publishable: false,
      };
      res.statusCode = 503;
      res.end(
        JSON.stringify({ code: "WRITE_OUTCOME_UNKNOWN", requestId: intent.id }),
      );
      return;
    }
    if (req.method === "PUT") {
      uploads++;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      expect(Buffer.concat(chunks).toString()).toBe(
        "original synthetic archive",
      );
      intent = {
        ...intent!,
        status: "received",
        stateRevision: 2,
        actualArchiveBytes: intent!.expectedArchiveBytes,
        actualArchiveSha256: intent!.expectedArchiveSha256,
        receivedAt: "2026-10-24T00:00:01.000Z",
      };
      res.end(JSON.stringify(intent));
      return;
    }
    res.end(
      JSON.stringify({
        items: intent ? [intent] : [],
        total: intent ? 1 : 0,
        page: 1,
        pageSize: 1,
        hasNext: false,
      }),
    );
    return;
  }
  if (url.pathname === "/probe.js" || url.pathname === "/probe.css") {
    res.setHeader(
      "content-type",
      url.pathname.endsWith(".js") ? "text/javascript" : "text/css",
    );
    res.end(await readFile(path.join(out, url.pathname.slice(1))));
    return;
  }
  res.setHeader("content-type", "text/html;charset=utf-8");
  res.end(
    '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/probe.css"><div id="root"></div><script src="/probe.js"></script>',
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw Error("NO_PORT");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(10000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const observations: string[] = [];
async function dialog(
  action: () => Promise<unknown>,
  type: "confirm" | "alert" | "beforeunload",
  accept = false,
) {
  console.log("expect dialog", type, new URL(page.url()).pathname);
  const seen = page.waitForEvent("dialog").then(async (d) => {
    expect(d.type()).toBe(type);
    if (accept) await d.accept();
    else await d.dismiss();
  });
  await Promise.all([seen, action()]);
}
async function originalRemains(p: Page) {
  expect(
    await p.evaluate(() => {
      const w = window as Window & { originalFile?: File };
      return (
        document.querySelector<HTMLInputElement>("input[type=file]")
          ?.files?.[0] === w.originalFile
      );
    }),
  ).toBe(true);
}
try {
  await page.goto(origin + "/studio/products");
  await page.getByRole("link", { name: "新建测评", exact: true }).click();
  await page.getByLabel("第一项").fill("unsaved one");
  await page.getByLabel("第二项").fill("unsaved two");
  await page.getByRole("button", { name: "卸载第一项" }).click();
  await dialog(
    () => page.getByRole("link", { name: "测评管理", exact: true }).click(),
    "confirm",
  );
  await expect(page.getByLabel("第二项")).toHaveValue("unsaved two");
  await dialog(
    () => page.getByRole("button", { name: "搜索", exact: true }).click(),
    "confirm",
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    await dialog(() => page.goBack().catch(() => null), "beforeunload");
    await expect(page.getByLabel("第二项")).toHaveValue("unsaved two");
  }
  expect(await page.evaluate("window.probe().invalidations")).toBe(0);
  observations.push(
    "multi-registration, canceled link/search, native repeated Back retain exact input without revocation",
  );
  await dialog(
    () => page.getByRole("link", { name: "测评管理", exact: true }).click(),
    "confirm",
    true,
  );
  await expect(page.getByRole("heading", { name: "目录" })).toBeVisible();
  await page.getByRole("link", { name: "原包接收", exact: true }).click();
  await page.getByLabel("内容包文件", { exact: true }).setInputFiles({
    name: "synthetic.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("original synthetic archive"),
  });
  await page.evaluate(
    'window.originalFile=document.querySelector("input[type=file]").files[0]',
  );
  await expect(
    page.getByRole("button", { name: "创建内容包接收意图", exact: true }),
  ).toBeEnabled();
  await dialog(
    () => page.getByRole("link", { name: "测评管理", exact: true }).click(),
    "confirm",
  );
  await originalRemains(page);
  await dialog(() => page.goBack().catch(() => null), "beforeunload");
  await originalRemains(page);
  await page
    .getByRole("button", { name: "创建内容包接收意图", exact: true })
    .click();
  await expect(
    page.getByText("意图提交结果尚未确认。原文件、原操作编号", {
      exact: false,
    }),
  ).toBeVisible();
  await dialog(
    () => page.getByRole("link", { name: "测评管理", exact: true }).click(),
    "alert",
  );
  await originalRemains(page);
  expect(posts).toBe(1);
  await page
    .getByRole("button", { name: "按原操作编号精确核实", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "上传所选内容包", exact: true }),
  ).toBeEnabled();
  await dialog(
    () => page.getByRole("link", { name: "测评管理", exact: true }).click(),
    "alert",
  );
  await originalRemains(page);
  expect(posts).toBe(1);
  await page
    .getByRole("button", { name: "上传所选内容包", exact: true })
    .click();
  await expect(
    page.getByText("服务器已确认本次内容包接收状态。", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate("window.probe().uploadSame")).toBe(true);
  expect(posts).toBe(1);
  expect(uploads).toBe(1);
  await page.getByRole("link", { name: "测评管理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "目录" })).toBeVisible();
  observations.push(
    "original File survives canceled Back, UNKNOWN and awaiting-upload; exact original body uploads once after reconciliation; confirmed receive releases protection",
  );
  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        evidence:
          "actual React/Chromium with synthetic HTTP; no database proof",
        observations,
        posts,
        uploads,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      out,
      observations: observations.length,
      posts,
      uploads,
      errors,
    }),
  );
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
