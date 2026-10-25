/** Focus-only regression: real Studio frame and globals, synthetic reads, no app/DB server.
 * The fixed pathname adapter replaces Next's router context, not the navigation component.
 * Popup screenshots use viewport capture; full-page visual capture is a separate concern.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.resolve("package.json"));
const { chromium, expect } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
const postcss = createRequire(require.resolve("next/package.json"))("postcss");
const tailwind = require("@tailwindcss/postcss");
const out = path.resolve(".cache/studio-catalog-focus", String(Date.now()));
await mkdir(out, { recursive: true, mode: 0o700 });
const source = `
import {createRoot} from 'react-dom/client';
import {StudioShell} from '@/features/studio/shell';
import {ProductList} from '@/features/studio/workspace/product-list';
import {projectProductOperations} from '@/features/studio/operations/projection';
const now='2026-10-25T00:00:00.000Z';
const products=Array.from({length:4},(_,n)=>projectProductOperations({id:'focus-synthetic-'+n,slug:'focus-synthetic-'+n,title:'隔离合成测评 '+n,metadataRevision:1,createdAt:now,updatedAt:now,archivedAt:null,primaryCategory:null,tags:[]},now,{reception:{total:0,latest:null},validation:{total:0,latest:null},draft:null,reviews:[],versions:[],testing:[]}));
window.calls=[];
window.fetch=async (raw,init={})=>{
 const url=new URL(raw,location.href); window.calls.push({path:url.pathname,method:init.method||'GET'});
 if(init.method&&init.method!=='GET')throw Error('UNEXPECTED_WRITE');
 if(url.pathname==='/api/studio/operations/products')return Response.json({schemaVersion:'quizforge.product-operations-page.v1',asOf:now,items:products,page:1,pageSize:20,total:4,hasNext:false});
 if(url.pathname==='/api/studio/categories'){
  await new Promise(resolve=>window.releaseCategory=resolve);
  window.categoryResponseComplete=true;
  return Response.json({items:[{id:'00000000-0000-4000-8000-000000000001',name:'合成分类',slug:'focus-category',revision:1,archivedAt:null,createdAt:now,updatedAt:now,assignedProductCount:0}],page:1,pageSize:10,total:1,hasNext:false});
 }
 throw Error('UNEXPECTED_SYNTHETIC_READ');
};
const session={operator:{id:'synthetic-operator',label:'隔离合成运营',role:'operator'},csrfToken:'synthetic-csrf',idleExpiresAt:'2030-01-01T00:00:00.000Z',absoluteExpiresAt:'2030-01-01T00:00:00.000Z'};
createRoot(document.getElementById('root')).render(<StudioShell authenticated identity={session.operator}><ProductList session={session}/></StudioShell>);
`;
await esbuild.build({
  stdin: { contents: source, resolveDir: process.cwd(), loader: "tsx" },
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
      name: "fixed-route-context",
      setup(b) {
        b.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "navigation",
          namespace: "probe",
        }));
        b.onResolve({ filter: /^node:util$/ }, () => ({
          path: "policy",
          namespace: "probe",
        }));
        b.onLoad({ filter: /.*/, namespace: "probe" }, ({ path }) => ({
          contents:
            path === "navigation"
              ? "export function usePathname(){return window.location.pathname}"
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
const css =
  globals.css + "\n" + (await readFile(path.join(out, "probe.css"), "utf8"));
const bundle = await readFile(path.join(out, "probe.js"), "utf8");
const browser = await chromium.launch();
const results = [],
  errors = [];
let page;
try {
  page = await browser.newPage({
    viewport: { width: 1440, height: 950 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://catalog-focus.invalid/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto("http://catalog-focus.invalid/studio/products");
  await page.evaluate(() => {
    window.events = [];
    window.record = (type, target) => {
      if (window.events.length < 1000)
        window.events.push({
          type,
          t: performance.now(),
          width: innerWidth,
          height: innerHeight,
          active:
            document.activeElement?.getAttribute("aria-label") ||
            document.activeElement?.id ||
            document.activeElement?.tagName,
          target:
            target?.getAttribute?.("aria-label") ||
            target?.id ||
            target?.tagName,
          popup: Boolean(
            document.querySelector(
              '[role="dialog"][aria-label="选择分类筛选"]',
            ),
          ),
        });
    };
    for (const type of ["resize", "scroll", "focusin", "focusout", "keydown"])
      addEventListener(
        type,
        (event) => window.record(type, event.target),
        true,
      );
  });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  const trigger = page.locator('[data-kind="category"] > button');
  const popup = page.getByRole("dialog", { name: "选择分类筛选", exact: true });
  const search = popup.getByRole("textbox", { name: "搜索分类名称或英文标识" });
  await trigger.waitFor();
  await page.getByText("共 4 个测评 · 每页 20 个", { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      scrollTo(0, 0);
    });
    await page.waitForFunction(() => {
      const nav = document.querySelector(
        'dialog[aria-label="Studio 导航菜单"]',
      );
      return nav.open === matchMedia("(min-width: 960px)").matches;
    });
    await page.evaluate(() => {
      window.categoryResponseComplete = false;
      window.releaseCategory = undefined;
    });
    await trigger.click();
    await expect(search).toBeFocused();
    await page.waitForFunction(
      () => typeof window.releaseCategory === "function",
    );
    await page.evaluate(() => window.releaseCategory());
    // The two presets are always present, even while GET is pending. Wait for data.
    await popup
      .getByRole("button", { name: "合成分类", exact: true })
      .waitFor();
    await expect(search).toBeFocused();
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: path.join(out, `open-${width}.png`),
        fullPage: false,
      });
    // A screenshot must not silently consume the owner before the Escape assertion.
    await expect(popup).toBeVisible();
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(popup).toHaveCount(0);
    results.push({
      width,
      height: 950,
      candidateReady: true,
      escapeReturnedFocus: true,
    });
  }
  // Loading is a separate supported state, not a substitute for candidate readiness.
  await page.setViewportSize({ width: 390, height: 950 });
  await page.evaluate(() => {
    window.categoryResponseComplete = false;
    window.releaseCategory = undefined;
  });
  await trigger.click();
  await expect(search).toBeFocused();
  await page.waitForFunction(
    () => typeof window.releaseCategory === "function",
  );
  await expect(
    popup.getByRole("button", { name: "全部分类", exact: true }),
  ).toBeVisible();
  await expect(
    popup.getByRole("button", { name: "合成分类", exact: true }),
  ).toHaveCount(0);
  await expect(popup.getByRole("status")).toHaveText("正在读取分类…");
  await expect(popup).toBeVisible();
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(popup).toHaveCount(0);
  await page.evaluate(() => window.releaseCategory());
  await page.waitForFunction(() => window.categoryResponseComplete);
  await expect(trigger).toBeFocused();
  results.push({
    width: 390,
    height: 950,
    loadingEscape: true,
    lateReadDidNotStealFocus: true,
  });
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.calls.every((call) => call.method === "GET"),
    ),
  ).toBe(true);
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        compatMode: await page.evaluate(() => document.compatMode),
        results,
        events: await page.evaluate(() => window.events),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "passed", out, results }));
} catch (error) {
  await writeFile(
    path.join(out, "failure.json"),
    JSON.stringify(
      {
        status: "failed",
        message: String(error),
        results,
        errors,
        events: page
          ? await page.evaluate(() => window.events).catch(() => [])
          : [],
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
