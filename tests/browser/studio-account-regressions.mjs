/** Targeted account regressions only: loop, late, downgrade, task, account429, setup429, query.
 * Select a subset with QUIZFORGE_ACCOUNT_REGRESSION_CASES (comma-separated).
 * Real React components and synthetic HTTP; no application/DB service or screenshot matrix.
 * The optional QUIZFORGE_PASSWORD_TOKEN_MODULE is the exact B-owned helper during branch integration.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.resolve("package.json"));
const { chromium, expect } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
const postcss = createRequire(require.resolve("next/package.json"))("postcss");
const tailwind = require("@tailwindcss/postcss");
const out = path.resolve(
  ".cache/studio-account-regressions",
  String(Date.now()),
);
await mkdir(out, { recursive: true, mode: 0o700 });
const source = `
import {createRoot} from 'react-dom/client';
import {useEffect} from 'react';
import {StudioShell} from '@/features/studio/shell';
import {AccountsPage} from '@/features/studio/accounts/admin-page';
import {SetPasswordPage} from '@/features/studio/accounts/set-password-page';
import {CreateReceive} from '@/features/studio/imports/create-receive';
import {useStudioAccountOwner} from '@/features/studio/accounts/session-owner';
import {InternalAuthorityProvider,useInternalAuthority} from '@/features/studio/internal-versions/authority';
import {ProductDetail} from '@/features/studio/workspace/product-detail';
import {ProductTaskSurfaces} from '@/features/studio/product-workspace/task-surfaces';
import {useImportRead} from '@/features/studio/imports/use-read';
import {invalidateCurrentStudioAuthority} from '@/features/studio/authority-events';
const id='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002', now='2026-10-25T00:00:00.000Z';
const session={operator:{id,label:'合成原身份',loginName:'synthetic.admin',displayName:'合成管理员',role:'admin',accountRevision:1},csrfToken:'A'.repeat(43),idleExpiresAt:'2030-01-01T00:00:00.000Z',absoluteExpiresAt:'2030-01-01T00:00:00.000Z'};
const account={id,label:'合成原身份',loginName:'synthetic.admin',displayName:'合成管理员',role:'admin',status:'active',revision:1,createdAt:now,disabledAt:null};
const scenario=new URLSearchParams(location.search).get('case');
window.calls=[];window.operationIds=[];window.currentSession=session;window.revoke=invalidateCurrentStudioAuthority;
window.metadataReads=0;window.deniedReads=0;window.revokedOwners=new Set();window.directoryQueries=[];
window.fetch=async(raw,init={})=>{
 const path=new URL(raw,location.href).pathname,method=init.method||'GET';window.calls.push({path,method});
 if(path==='/synthetic/denied'){
   window.deniedReads++;
   if(window.deniedReads>8)return new Promise(()=>{});
   return Response.json({code:'UNAUTHENTICATED'},{status:401});
 }
 if(path==='/api/studio/products/synthetic-product'){
   window.metadataReads++;
   if(window.metadataReads===1)return new Promise(resolve=>{window.releaseOld=()=>resolve(Response.json({code:'UNAUTHENTICATED'},{status:401}));});
   return Response.json({id:'synthetic-product',slug:'synthetic-product',title:'合成测评原名称',metadataRevision:1,primaryCategory:null,tags:[],archivedAt:null,createdAt:now,updatedAt:now});
 }
 if(path==='/api/studio/categories'||path==='/api/studio/tags')return Response.json({items:[],page:1,pageSize:10,total:0,hasNext:false});
 if(path.endsWith('/auth/session'))return Response.json(window.currentSession);
 if(path.endsWith('/accounts')&&method==='GET'){
   window.directoryQueries.push(new URL(raw,location.href).search);
   return Response.json({items:[account,{...account,id:other,displayName:'合成其他运营',loginName:'synthetic.other',role:'operator',...(scenario==='query'?{status:window.directoryStatus||'pending',revision:window.directoryRevision||1}:{})}],offset:0,limit:25,hasMore:false});
 }
 if(path.endsWith('/accounts/'+other)&&method==='PATCH'){
   const body=JSON.parse(init.body);window.patchRevision=body.expectedRevision;
   return Response.json({account:{...account,id:other,displayName:body.displayName,revision:3},operation:{operationId:body.operationId,action:'display-name',actorId:id,targetId:other,status:'completed',errorCode:null,createdAt:now}});
 }
 if(path.endsWith('/accounts')&&method==='POST'){
   const body=JSON.parse(init.body);window.operationIds.push(body.operationId);
   if(window.postStatus)return Response.json({code:'RATE_LIMITED'},{status:window.postStatus});
   throw Error('synthetic lost acknowledgement');
 }
 if(path.includes('/accounts/operations/'))return Response.json({status:'found',operation:{operationId:path.split('/').pop(),action:'create',actorId:id,targetId:other,status:'completed',errorCode:null,createdAt:now}});
 if(path.endsWith('/password-setup/inspect'))return Response.json({tokenId:id,purpose:'setup',loginName:'synthetic.admin',displayName:'合成人员',expiresAt:'2030-01-01T00:00:00.000Z',passwordPolicy:{minCodePoints:15,maxCodePoints:256}});
 if(path.endsWith('/auth/password-setup')){
   const body=JSON.parse(init.body);window.operationIds.push(body.operationId);
   if(window.postStatus)return Response.json({code:'RATE_LIMITED'},{status:window.postStatus});
   throw Error('synthetic lost acknowledgement');
 }
 throw Error('unexpected synthetic request');
};
function OwnerFacts(){const owner=useStudioAccountOwner();useEffect(()=>{window.owner=owner;if(owner.revoked)window.revokedOwners.add(owner);},[owner]);return <output data-testid="owner" data-revoked={String(owner.revoked)} data-generation={owner.generation}/>;}
function Denied(){useImportRead('/synthetic/denied');return <OwnerFacts/>;}
function Late(){const authority=useInternalAuthority();return <ProductTaskSurfaces><OwnerFacts/><output data-testid="authority" data-revoked={String(authority.isRevoked)}/><ProductDetail productId="synthetic-product" session={session} embedded/></ProductTaskSurfaces>;}
const content=scenario==='loop'?<Denied/>:scenario==='late'?<InternalAuthorityProvider productId="synthetic-product"><Late/></InternalAuthorityProvider>:scenario==='setup'?<SetPasswordPage/>:<><OwnerFacts/><AccountsPage session={session}/></>;
createRoot(document.getElementById('root')).render(<StudioShell authenticated={scenario!=='setup'} identity={session.operator} session={scenario==='setup'?undefined:session}>{content}</StudioShell>);
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
        b.onResolve({ filter: /^\.\/password-token$/ }, () =>
          process.env.QUIZFORGE_PASSWORD_TOKEN_MODULE
            ? {
                path: path.resolve(process.env.QUIZFORGE_PASSWORD_TOKEN_MODULE),
              }
            : undefined,
        );
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
              ? "export function usePathname(){return window.location.pathname} export function useRouter(){return {replace:()=>{},refresh:()=>{}}}"
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
const origin = "http://127.0.0.1:32889";
const results = [],
  errors = [];
let context, page;
const selected = (name) =>
  !process.env.QUIZFORGE_ACCOUNT_REGRESSION_CASES ||
  process.env.QUIZFORGE_ACCOUNT_REGRESSION_CASES.split(",").includes(name);
try {
  async function open(scenario, fragment = "") {
    if (context) await context.close();
    context = await browser.newContext({
      viewport: { width: 1100, height: 1000 },
      reducedMotion: "reduce",
    });
    page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(origin + "/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
      }),
    );
    await page.goto(origin + "/studio/regression?case=" + scenario + fragment);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
  }
  async function frames() {
    await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame);
    });
  }
  async function recover() {
    await page.getByRole("button", { name: "检查登录状态" }).click();
    await page
      .getByRole("checkbox", {
        name: "我已核对账号与操作状态，继续后先核实待确认结果",
      })
      .check();
    await page.getByRole("button", { name: "继续原任务" }).click();
    await expect(page.getByTestId("owner")).toHaveAttribute(
      "data-revoked",
      "false",
    );
  }
  async function create() {
    await page.getByRole("button", { name: "开通账号", exact: true }).click();
    await page.getByLabel("登录账号（创建后不可修改）").fill("synthetic.new");
    await page.getByLabel("显示名称", { exact: true }).fill("合成输入");
  }
  if (selected("loop")) {
    await open("loop");
    await expect(page.getByTestId("owner")).toHaveAttribute(
      "data-revoked",
      "true",
    );
    await frames();
    expect(await page.evaluate(() => window.deniedReads)).toBeLessThanOrEqual(
      2,
    );
    await page.evaluate(() => {
      window.stableOwner = window.owner;
      for (let i = 0; i < 5; i++) window.revoke();
    });
    await frames();
    expect(await page.evaluate(() => window.deniedReads)).toBeLessThanOrEqual(
      2,
    );
    expect(await page.evaluate(() => window.revokedOwners.size)).toBe(1);
    expect(await page.evaluate(() => window.owner === window.stableOwner)).toBe(
      true,
    );
    results.push("P1-repeated-401-bounded-owner-idempotent");
  }
  if (selected("late")) {
    await open("late");
    await expect(
      page.getByText("正在读取测评…", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Boolean(window.releaseOld)))
      .toBe(true);
    await page.evaluate(() => window.revoke());
    await recover();
    await expect(page.getByTestId("owner")).toHaveAttribute(
      "data-generation",
      "1",
    );
    await page.evaluate(() => window.releaseOld());
    await expect(page.getByText("正在读取测评…", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("本次读取已中断，请重新读取。", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("owner")).toHaveAttribute(
      "data-revoked",
      "false",
    );
    await expect(page.getByTestId("authority")).toHaveAttribute(
      "data-revoked",
      "false",
    );
    expect(await page.evaluate(() => window.metadataReads)).toBe(1);
    await page
      .getByRole("button", { name: "重新读取测评", exact: true })
      .click();
    const title = page.getByLabel("测评名称", { exact: true });
    await expect(title).toHaveValue("合成测评原名称");
    await expect(title).toBeEnabled();
    await title.fill("合成未保存名称");
    await page.evaluate(() => {
      window.titleNode = document.querySelector("#product-title");
    });
    await frames();
    await expect(title).toHaveValue("合成未保存名称");
    expect(
      await page.evaluate(
        () => window.titleNode === document.querySelector("#product-title"),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => window.metadataReads)).toBe(2);
    expect(
      await page.evaluate(
        () => window.calls.filter((call) => call.method !== "GET").length,
      ),
    ).toBe(0);
    await expect(
      page.getByRole("button", { name: "重新读取测评", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("owner")).toHaveAttribute(
      "data-revoked",
      "false",
    );
    results.push(
      "actual-product-settings-stale-read-settles-then-existing-retry-loads-editable-form-without-write",
    );
  }
  if (selected("downgrade")) {
    await open("accounts");
    await create();
    await page
      .getByRole("button", { name: "确认开通账号", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "明确结束本次记录" }),
    ).toBeDisabled();
    const original = await page.evaluate(() => window.operationIds[0]);
    await page.getByRole("button", { name: "收起", exact: true }).click();
    await page.evaluate(() => {
      window.revoke();
      window.currentSession = {
        ...window.currentSession,
        operator: { ...window.currentSession.operator, role: "read-only" },
      };
    });
    await recover();
    await expect(
      page.getByRole("button", { name: "开通账号", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("原操作编号：" + original, { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "核实原操作", exact: true }).click();
    await expect(
      page.getByText("已核实原操作，请查看处理结果。"),
    ).toBeVisible();
    await page.getByRole("button", { name: "明确结束本次记录" }).click();
    expect(
      await page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((key) =>
            key.includes("account-operation"),
          ).length,
      ),
    ).toBe(0);
    expect(
      await page.evaluate(
        () =>
          window.calls.filter(
            (c) => c.path.endsWith("/accounts") && c.method === "GET",
          ).length,
      ),
    ).toBe(1);
    expect(await page.evaluate(() => window.operationIds.length)).toBe(1);
    results.push(
      "P2-downgraded-actor-can-resolve-and-finish-original-without-management-access",
    );
  }
  if (selected("task")) {
    await open("accounts");
    await create();
    await page.getByLabel("角色", { exact: true }).selectOption("admin");
    await page.evaluate(() => {
      window.loginNode = document.querySelector("#new-account-login");
    });
    await page.getByRole("button", { name: "收起", exact: true }).click();
    let leavePrompts = 0;
    page.once("dialog", async (dialog) => {
      leavePrompts++;
      await dialog.dismiss();
    });
    await page.locator('a[href="/studio/session"]').first().click();
    expect(leavePrompts).toBe(1);
    expect(page.url()).toContain("case=accounts");
    await page.getByRole("button", { name: "继续未提交账号任务" }).click();
    await expect(page.getByLabel("登录账号（创建后不可修改）")).toHaveValue(
      "synthetic.new",
    );
    await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue(
      "合成输入",
    );
    await expect(page.getByLabel("角色", { exact: true })).toHaveValue("admin");
    expect(
      await page.evaluate(
        () => window.loginNode === document.querySelector("#new-account-login"),
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "收起", exact: true }).click();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page
      .getByRole("button", { name: "修改显示名称", exact: true })
      .nth(1)
      .click();
    await page.getByRole("button", { name: "继续未提交账号任务" }).click();
    await expect(page.getByLabel("登录账号（创建后不可修改）")).toHaveValue(
      "synthetic.new",
    );
    await page.getByRole("button", { name: "收起", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "修改显示名称", exact: true })
      .nth(1)
      .click();
    await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue(
      "合成其他运营",
    );
    await expect(page.getByLabel("登录账号（创建后不可修改）")).toHaveCount(0);
    results.push(
      "P2-collapsed-dirty-task-preserved-dom-and-leave-guard-switch-requires-explicit-discard",
    );
  }
  if (selected("account429")) {
    await open("accounts");
    await page.evaluate(() => {
      window.postStatus = 429;
    });
    await create();
    await page
      .getByRole("button", { name: "确认开通账号", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "明确结束本次记录" }),
    ).toBeEnabled();
    expect(await page.evaluate(() => window.operationIds.length)).toBe(1);
    await page.getByRole("button", { name: "明确结束本次记录" }).click();
    await expect(
      page.getByRole("dialog", { name: "账号操作", exact: true }),
    ).not.toBeVisible();
    expect(
      await page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) =>
            k.includes("account-operation"),
          ).length,
      ),
    ).toBe(0);
    await page.evaluate(() => {
      window.postStatus = 503;
    });
    await create();
    await page
      .getByRole("button", { name: "确认开通账号", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "明确结束本次记录" }),
    ).toBeDisabled();
    expect(await page.evaluate(() => new Set(window.operationIds).size)).toBe(
      2,
    );
    results.push(
      "P2-account-explicit-429-finish-no-autoreplay-503-with-same-code-remains-unknown",
    );
  }
  if (selected("setup429")) {
    await open(
      "setup",
      "#token=qfa_setup_v1_" +
        "A".repeat(43) +
        "&tokenId=00000000-0000-4000-8000-000000000001",
    );
    await expect(page.getByText("登录账号：synthetic.admin")).toBeVisible();
    await page.evaluate(() => {
      window.postStatus = 429;
    });
    async function setPassword() {
      await page
        .getByLabel("新密码", { exact: true })
        .fill("synthetic long new password");
      await page
        .getByLabel("确认新密码", { exact: true })
        .fill("synthetic long new password");
      await page
        .getByRole("button", { name: "确认设置密码", exact: true })
        .click();
    }
    await setPassword();
    await expect(
      page.getByRole("button", { name: "结束本次记录并重新设置" }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.operationIds.length)).toBe(1);
    await page.getByRole("button", { name: "结束本次记录并重新设置" }).click();
    await expect(
      page.getByRole("button", { name: "确认设置密码", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) =>
            k.includes("password-setup"),
          ).length,
      ),
    ).toBe(0);
    await page.evaluate(() => {
      window.postStatus = 503;
    });
    await setPassword();
    await expect(
      page.getByText("原操作编号：", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "结束本次记录并重新设置" }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => window.operationIds.length)).toBe(2);
    results.push(
      "P2-setup-explicit-429-finish-no-autoreplay-503-with-same-code-remains-unknown",
    );
  }
  if (selected("query")) {
    await open("query");
    const target = page.locator("article").filter({
      has: page.getByRole("heading", { name: "合成其他运营", exact: true }),
    });
    await expect(
      target.getByText("运营者 · 待本人设置密码", { exact: true }),
    ).toBeVisible();
    await expect(
      target.getByRole("button", { name: "重新发送设置链接", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      window.directoryStatus = "active";
      window.directoryRevision = 2;
    });
    await page.getByRole("button", { name: "查询账号", exact: true }).click();
    await expect(
      target.getByText("运营者 · 可登录", { exact: true }),
    ).toBeVisible();
    await expect(
      target.getByRole("button", { name: "发送密码重置链接", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.directoryQueries.length)).toBe(2);
    expect(
      await page.evaluate(() => new Set(window.directoryQueries).size),
    ).toBe(1);
    await target
      .getByRole("button", { name: "修改显示名称", exact: true })
      .click();
    await page.getByLabel("显示名称", { exact: true }).fill("合成已刷新运营");
    await page
      .getByRole("button", { name: "确认修改显示名称", exact: true })
      .click();
    await expect.poll(() => page.evaluate(() => window.patchRevision)).toBe(2);
    results.push(
      "account-identical-query-refreshes-status-and-latest-cas-revision",
    );
  }
  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        browser: "Chromium",
        evidence:
          "targeted real React components with synthetic HTTP only; no app or DB server",
        results,
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
      { status: "failed", message: String(error), results, errors },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
