/** Actual React + browser navigation, synthetic import HTTP; no DB or author data. */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import type { ImportDto } from "@/features/quizpack/import/contracts";

const mobileNavigationOnly = process.argv.includes("--mobile-navigation-only");
const mobileOnly =
  process.argv.includes("--mobile-only") || mobileNavigationOnly;
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
    import {PathnameContext} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
    import {StudioShell} from "@/features/studio/shell";
    import {StudioNavigationBoundary,useStudioLeaveProtection} from "@/features/studio/navigation-boundary";
    import {subscribeStudioAuthorityInvalidation} from "@/features/studio/authority-events";
    import {CreateReceive} from "@/features/studio/imports/create-receive";
    let invalidations=0;
    subscribeStudioAuthorityInvalidation(()=>{invalidations++; if(${mobileOnly})sessionStorage.setItem("mobile-invalidations",String(Number(sessionStorage.getItem("mobile-invalidations")??0)+1))});
    window.probe=()=>({invalidations,uploadSame:window.uploadSame});
    if(${mobileOnly}) window.addEventListener("beforeunload",()=>sessionStorage.setItem("mobile-beforeunload-revoked",String(invalidations>0)));
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
    const file=location.pathname.includes('/imports/')||(location.pathname==='/studio/products/example'&&new URLSearchParams(location.search).get('task')==='content');
    const content = <>
        <a href="/studio/products">测评管理</a>
        <a href="/studio/new-product">新建测评</a>
        <a href="/studio/products/example?task=content">原包接收</a>
        <form action="/studio/products" data-studio-navigation-form><input name="q" aria-label="搜索"/><button>搜索</button></form>
        {file?<CreateReceive productId="example" settings={{enabled:true,maxArchiveBytes:33554432,receiveTimeoutMs:60000}}
          session={{operator:{id:'00000000-0000-0000-0000-000000000007',label:'Synthetic',role:'operator'},csrfToken:'A'.repeat(43),idleExpiresAt:'2030-01-01T00:00:00.000Z',absoluteExpiresAt:'2030-01-01T00:00:00.000Z'}} onChanged={()=>{}}/>
          :location.pathname==='/studio/new-product'?<Form/>:<h1>目录</h1>}
      </>;
    createRoot(document.getElementById("root")).render(${mobileOnly}?<PathnameContext.Provider value={location.pathname}><StudioShell authenticated identity={{id:"00000000-0000-0000-0000-000000000007",label:"Synthetic",role:"operator"}}>{content}</StudioShell></PathnameContext.Provider>:<StudioNavigationBoundary>{content}</StudioNavigationBoundary>);
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
let deny = false;
let posts = 0,
  uploads = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("content-type", "application/json");
    if (deny) {
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          code: "UNAUTHENTICATED",
          requestId: "00000000-0000-0000-0000-000000000002",
        }),
      );
      return;
    }
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
  if (mobileOnly) {
    if (!mobileNavigationOnly) {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(origin + "/studio/products/example?task=content");
      const opener = page.getByRole("button", {
        name: "打开 Studio 导航",
        exact: true,
      });
      const menu = page.getByRole("dialog", { name: "Studio 导航菜单" });
      await opener.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(opener).toBeFocused();
      await expect(menu).not.toBeVisible();
      await opener.click();
      await page.mouse.click(385, 850);
      await expect(menu).not.toBeVisible();
      await expect(opener).toBeFocused();
      await opener.click();
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.querySelector("dialog")?.matches(":modal"),
          ),
        )
        .toBe(false);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.style.overflow),
        )
        .not.toBe("hidden");
      await page.setViewportSize({ width: 390, height: 900 });
      expect(await page.evaluate("window.probe().invalidations")).toBe(0);
      observations.push(
        "actual shell drawer: Escape/backdrop/desktop resize close modal and release scroll without revocation; mobile close restores trigger focus",
      );
      await page.getByLabel("内容包文件", { exact: true }).setInputFiles({
        name: "synthetic.zip",
        mimeType: "application/zip",
        buffer: Buffer.from("original synthetic archive"),
      });
      await page.evaluate(
        'window.originalFile=document.querySelector("input[type=file]").files[0];window.originalInput=document.querySelector("input[type=file]")',
      );
      const create = page.getByRole("button", {
        name: "创建内容包接收意图",
        exact: true,
      });
      await expect(create).toBeEnabled();
      await opener.click();
      await dialog(
        () => menu.getByRole("link", { name: "测评管理", exact: true }).click(),
        "confirm",
      );
      await originalRemains(page);
      expect(
        await page.evaluate(
          'document.querySelector("input[type=file]")===window.originalInput',
        ),
      ).toBe(true);
      expect(await page.evaluate("window.probe().invalidations")).toBe(0);
      await page.keyboard.press("Escape");
      await create.click();
      await expect(
        page.getByText("意图提交结果尚未确认。原文件、原操作编号", {
          exact: false,
        }),
      ).toBeVisible();
      await opener.click();
      await dialog(
        () => menu.getByRole("link", { name: "测评管理", exact: true }).click(),
        "alert",
      );
      await originalRemains(page);
      expect(
        await page.evaluate(
          'document.querySelector("input[type=file]")===window.originalInput',
        ),
      ).toBe(true);
      expect(await page.evaluate("window.probe().invalidations")).toBe(0);
      expect(posts).toBe(1);
      expect(uploads).toBe(0);
      await page.keyboard.press("Escape");
      await writeFile(
        path.join(out, "mobile-unknown-state.json"),
        JSON.stringify(
          {
            intent,
            storage: await page.evaluate(() =>
              Object.fromEntries(Object.entries(sessionStorage)),
            ),
          },
          null,
          2,
        ),
      );
      observations.push(
        "actual CreateReceive inside new shell: canceled drawer navigation and UNKNOWN block preserve exact File/input with one POST and zero uploads",
      );
    }
    const clean = await browser.newPage({
      viewport: { width: 390, height: 900 },
    });
    await clean.goto(origin + "/studio/products");
    await clean
      .getByRole("button", { name: "打开 Studio 导航", exact: true })
      .click();
    await clean
      .getByRole("dialog", { name: "Studio 导航菜单" })
      .getByRole("link", { name: "工作台", exact: true })
      .click();
    await expect(clean).toHaveURL(origin + "/studio");
    expect(
      await clean.evaluate(() =>
        sessionStorage.getItem("mobile-beforeunload-revoked"),
      ),
    ).toBe("true");
    await clean.close();
    observations.push(
      "accepted real drawer navigation invokes the existing one-window revocation before entering the destination",
    );
  } else {
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
      await dialog(() => page.evaluate("history.back()"), "beforeunload");
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
    await dialog(() => page.evaluate("history.back()"), "beforeunload");
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
    deny = true;
    await page
      .getByRole("button", { name: "读取最新接收状态", exact: true })
      .click();
    await expect(
      page.getByText("会话已失效，请重新登录。", { exact: true }),
    ).toBeVisible();
    await dialog(
      () => page.getByRole("link", { name: "测评管理", exact: true }).click(),
      "alert",
    );
    const popupReady = page.waitForEvent("popup");
    await page
      .getByRole("link", { name: "在新标签重新登录", exact: true })
      .click();
    const popup = await popupReady;
    await popup.waitForLoadState("domcontentloaded");
    await originalRemains(page);
    await expect(
      page.getByRole("link", { name: "在新标签打开原接收记录", exact: true }),
    ).toHaveAttribute(
      "href",
      "/studio/products/example/imports/00000000-0000-0000-0000-000000000001",
    );
    expect(posts).toBe(1);
    expect(uploads).toBe(0);
    await popup.close();
    deny = false;
    await page.getByRole("button", { name: "收起提示", exact: true }).click();
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
      "expired authority: new-tab login and original-record link preserve File without restoring old authority",
    );
    observations.push(
      "original File survives canceled Back, UNKNOWN and awaiting-upload; exact original body uploads once after reconciliation; confirmed receive releases protection",
    );
  }
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
