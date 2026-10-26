/** Real React navigation/owner/mutation behavior with synthetic HTTP; no database. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.resolve("package.json"));
const { chromium, expect } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
const out = path.resolve(
  ".cache/studio-navigation-recovery",
  String(Date.now()),
);
await mkdir(out, { recursive: true });
await esbuild.build({
  stdin: {
    contents: `
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioNavigationBoundary,useStudioLeaveProtection} from '@/features/studio/navigation-boundary';
import {StudioAccountOwner,useStudioAccountOwner} from '@/features/studio/accounts/session-owner';
import {useWorkspaceMutation} from '@/features/studio/workspace/use-mutation';
import {studioFetch} from '@/features/studio/client';
import {invalidateCurrentStudioAuthority,captureStudioEpoch} from '@/features/studio/authority-events';
const session={operator:{loginName:"synthetic.account",accountRevision:1,id:'00000000-0000-4000-8000-000000000001',displayName:'Synthetic',role:'operator'},csrfToken:'A'.repeat(43),idleExpiresAt:'2030-01-01T00:00:00Z',absoluteExpiresAt:'2030-01-01T00:00:00Z'};
window.mode='normal';window.posts=0;window.dialogs=[];window.revoked=invalidateCurrentStudioAuthority;window.epoch=captureStudioEpoch;
window.confirm=()=>{window.dialogs.push('confirm');return window.acceptLeave===true};
window.alert=()=>window.dialogs.push('alert');
window.fetch=async(url,options={})=>{
 if(options.method==='POST'){window.posts++;throw Error('synthetic lost response')}
 if(url==='/held')return new Promise(resolve=>{window.releaseRead=()=>resolve(Response.json({accepted:true}))});
 if(url==='/denied')return Response.json({code:'UNAUTHENTICATED'},{status:401});
 return Response.json(url==='/api/studio/auth/session'?session:{accepted:true});
};
window.read=(url)=>studioFetch(url,{}).then(()=>window.readResult='accepted',e=>window.readResult=e.code);
function Form(){const [value,setValue]=useState('');const m=useWorkspaceMutation(session.csrfToken);const o=useStudioAccountOwner();
 useStudioLeaveProtection({dirty:!!value,pending:m.pending});
 return <><label>名称<input value={value} onChange={e=>setValue(e.target.value)}/></label><button disabled={m.blocked} onClick={()=>void m.submit('/create','POST',{id:'retained-id'},'done')}>提交</button><output aria-label='真实请求状态'>{m.state.phase}</output><output aria-label='待确认'>{String(m.pending)}</output><output aria-label='权限暂停'>{String(o.revoked)}</output></>;
}
function App(){const [route,setRoute]=useState(location.pathname);function go(e){e.preventDefault();history.pushState({},'',e.currentTarget.href);setRoute(location.pathname)}
 return <StudioNavigationBoundary><nav><a href='/studio' onClick={go}>工作台</a><a href='/studio/products' onClick={go}>测评管理</a><a href='#section'>页内定位</a><a href='/studio/login' target='_blank'>新标签登录</a></nav><StudioAccountOwner initialSession={session}><h1>{route}</h1><Form/></StudioAccountOwner></StudioNavigationBoundary>}
createRoot(document.getElementById('root')).render(<App/>);`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  logLevel: "silent",
});
const bundle = await readFile(path.join(out, "probe.js"), "utf8");
const browser = await chromium.launch({ headless: true });
const results = [],
  errors = [];
const origin = "http://127.0.0.1:32887";
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(origin + "/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><meta charset="utf-8"><div id="root"></div>',
    }),
  );
  async function open() {
    await page.goto(origin + "/studio");
    await page.addScriptTag({ content: bundle });
    await expect(page.getByLabel("权限暂停")).toHaveText("false");
  }
  await open();
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  await expect(page.getByLabel("权限暂停")).toHaveText("false");
  expect(await page.evaluate(() => window.epoch())).toBe(0);
  results.push("same-route-does-not-revoke");

  await page.getByLabel("名称", { exact: true }).fill("尚未提交");
  await page.getByRole("link", { name: "工作台", exact: true }).click();
  expect(await page.evaluate(() => window.dialogs)).toEqual([]);
  await page.getByRole("link", { name: "测评管理", exact: true }).click();
  await expect(page.getByRole("heading")).toHaveText("/studio");
  expect(await page.evaluate(() => window.dialogs)).toEqual(["confirm"]);
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue(
    "尚未提交",
  );
  expect(await page.evaluate(() => window.epoch())).toBe(0);
  results.push("cancelled-dirty-navigation-retains-authority-and-input");

  await page.getByLabel("名称", { exact: true }).fill("");
  await page.evaluate(() => {
    void window.read("/held");
  });
  await expect
    .poll(() => page.evaluate(() => typeof window.releaseRead))
    .toBe("function");
  await page.getByRole("link", { name: "测评管理", exact: true }).click();
  await expect(page.getByRole("heading")).toHaveText("/studio/products");
  await expect(page.getByLabel("权限暂停")).toHaveText("false");
  await page.evaluate(() => window.releaseRead());
  await expect
    .poll(() => page.evaluate(() => window.readResult))
    .toBe("STUDIO_REQUEST_STALE");
  await page.evaluate(() => window.read("/fresh"));
  expect(await page.evaluate(() => window.readResult)).toBe("accepted");
  results.push("spa-navigation-invalidates-old-reads-without-revoking-account");

  await open();
  await page.evaluate(() => window.revoked());
  await expect(page.getByLabel("权限暂停")).toHaveText("true");
  await expect(page.getByLabel("待确认")).toHaveText("false");
  await expect(
    page.getByRole("button", { name: "提交", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "测评管理", exact: true }).click();
  expect(await page.evaluate(() => window.dialogs)).toEqual([]);
  results.push(
    "idle-revocation-blocks-writes-without-inventing-pending-request",
  );

  await open();
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await expect(page.getByLabel("真实请求状态")).toHaveText("unknown");
  await page.getByRole("link", { name: "测评管理", exact: true }).click();
  await expect(page.getByRole("heading")).toHaveText("/studio");
  expect(await page.evaluate(() => window.dialogs)).toEqual(["alert"]);
  await page.evaluate(() => window.read("/denied"));
  await expect(page.getByLabel("权限暂停")).toHaveText("true");
  await expect(page.getByLabel("待确认")).toHaveText("true");
  await page.getByRole("button", { name: "检查登录状态", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续原任务", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("我已核对账号与操作状态，继续后先核实待确认结果", {
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "继续原任务", exact: true }).click();
  await expect(page.getByLabel("权限暂停")).toHaveText("false");
  await expect(page.getByLabel("待确认")).toHaveText("true");
  await expect(
    page.getByRole("button", { name: "提交", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.posts)).toBe(1);
  results.push(
    "unknown-request-survives-navigation-auth-loss-and-explicit-recovery-without-replay",
  );
  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ out, results, errors }));
} finally {
  await browser.close();
}
