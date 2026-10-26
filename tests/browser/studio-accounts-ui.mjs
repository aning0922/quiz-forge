/** Accounts UI behavior and visual checks with the actual React frame and synthetic HTTP.
 * No application server or database. Raw synthetic secrets stay out of reports/screenshots.
 * During cross-branch development only, QUIZFORGE_PASSWORD_TOKEN_MODULE may point to B's exact shared module; the default resolves the integrated production module.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.resolve("package.json"));
const { chromium, expect } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
const postcss = createRequire(require.resolve("next/package.json"))("postcss");
const tailwind = require("@tailwindcss/postcss");
const out = path.resolve(".cache/studio-accounts-ui", String(Date.now()));
await mkdir(out, { recursive: true, mode: 0o700 });
const source = `
import {createRoot} from 'react-dom/client';
import {StudioShell} from '@/features/studio/shell';
import {AccountsPage} from '@/features/studio/accounts/admin-page';
import {AccountAuditPage} from '@/features/studio/accounts/audit-page';
import {MyAccountPage} from '@/features/studio/accounts/self-page';
import {SetPasswordPage} from '@/features/studio/accounts/set-password-page';
import {StudioLoginForm} from '@/features/studio/login-form';
import {CreateReceive} from '@/features/studio/imports/create-receive';
import {invalidateCurrentStudioAuthority} from '@/features/studio/authority-events';
const now='2026-10-25T00:00:00.000Z', id='00000000-0000-4000-8000-000000000001';
const params=new URLSearchParams(location.search), role=params.get('role')||'admin';
const session={operator:{id,label:'synthetic-stable-label',displayName:'合成管理员',loginName:'synthetic.admin',role,accountRevision:1},csrfToken:'A'.repeat(43),idleExpiresAt:'2030-01-01T00:00:00.000Z',absoluteExpiresAt:'2030-01-01T00:00:00.000Z'};
const account={id,label:'synthetic-stable-label',displayName:'合成管理员',loginName:'synthetic.admin',role,status:'active',revision:1,createdAt:now,disabledAt:null};
const token='qfa_setup_v1_'+'A'.repeat(43);
window.calls=[];window.currentSession=session;window.revoke=invalidateCurrentStudioAuthority;
const operation=(operationId,action,actorId=id)=>({operationId,action,actorId,targetId:id,status:'completed',errorCode:null,createdAt:now});
window.fetch=async(raw,init={})=>{
 const url=new URL(raw,location.href), method=init.method||'GET';window.calls.push({path:url.pathname,method});
 const body=init.body?JSON.parse(init.body):{};
 if(url.pathname.endsWith('/auth/preauth'))return Response.json({csrfToken:'A'.repeat(43),expiresAt:now});
 if(url.pathname.endsWith('/auth/password-login'))return Response.json(session);
 if(url.pathname.endsWith('/auth/session'))return Response.json(window.currentSession);
 if(url.pathname.endsWith('/password-setup/inspect')){
  if(params.has('expired'))return Response.json({code:'PASSWORD_TOKEN_INVALID'},{status:403});
  return Response.json({tokenId:id,purpose:'setup',loginName:'synthetic.admin',displayName:'合成人员',expiresAt:'2030-01-01T00:00:00Z',passwordPolicy:{minCodePoints:15,maxCodePoints:256}});
 }
 if(url.pathname.endsWith('/password-setup/result'))return Response.json(window.resultFound?{status:'found',operation:operation(body.operationId,'password-setup',null)}:{status:'unknown',operationId:body.operationId});
 if(url.pathname.endsWith('/auth/password-setup'))throw Error('synthetic acknowledgement loss');
 if(url.pathname.endsWith('/accounts/me'))return Response.json(account);
 if(url.pathname.endsWith('/accounts/audit'))return Response.json({items:[{...operation('00000000-0000-4000-8000-000000000002','role'),actorDisplayName:'合成管理员',targetDisplayName:'合成运营'}],offset:0,limit:25,hasMore:false});
 if(url.pathname.includes('/accounts/operations/')){
  const operationId=url.pathname.split('/').pop();return Response.json(window.resultFound?{status:'found',operation:operation(operationId,'create')}:{status:'unknown',operationId});
 }
 if(url.pathname.endsWith('/accounts') && method==='GET')return Response.json({items:[account,{...account,id:'00000000-0000-4000-8000-000000000003',displayName:'合成待设置运营',loginName:'synthetic.operator',role:'operator',status:'pending'}],offset:0,limit:25,hasMore:false});
 if(url.pathname.endsWith('/accounts') && method==='POST'){
  if(params.has('unknown'))throw Error('synthetic acknowledgement loss');
  return Response.json({account,operation:operation(body.operationId,'create'),passwordSetup:{tokenId:id,purpose:'setup',url:location.origin+'/studio/set-password#token='+token,expiresAt:'2030-01-01T00:00:00Z'}}, {status:201});
 }
 if(url.pathname.endsWith('/imports') && method==='POST')throw Error('synthetic acknowledgement loss');
 throw Error('Unexpected synthetic request');
};
const view=params.get('view')||'accounts';
const page=view==='self'?<MyAccountPage session={session}/>:view==='audit'?<AccountAuditPage/>:view==='setup'?<SetPasswordPage/>:view==='login'?<StudioLoginForm/>:view==='recovery'?<CreateReceive embedded productId="synthetic-product" session={session} settings={{enabled:true,maxArchiveBytes:33554432,receiveTimeoutMs:60000}} onChanged={()=>{}}/>:<AccountsPage session={session}/>;
const authenticated=!['setup','login'].includes(view);
createRoot(document.getElementById('root')).render(<StudioShell authenticated={authenticated} identity={session.operator} session={authenticated?session:undefined}>{page}</StudioShell>);
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
const results = [],
  errors = [];
let page;
const origin = "http://127.0.0.1:32888";
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(origin + "/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
    }),
  );
  async function open(view, extra = "") {
    await page.goto(origin + "/studio/probe?view=" + view + extra);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
  }
  async function shot(name, width) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({ path: path.join(out, name + ".png") });
    results.push(name);
  }
  await open("login");
  await expect(page.getByText("请输入登录账号和密码。")).toBeVisible();
  const password = page.getByLabel("密码", { exact: true });
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await password.fill("synthetic long passphrase");
  await page.evaluate(() => {
    window.passwordNode = document.querySelector(
      'input[autocomplete="current-password"]',
    );
  });
  await page.getByRole("button", { name: "显示密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.passwordNode ===
          document.querySelector('input[autocomplete="current-password"]'),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "隐藏密码", exact: true }).click();
  await password.fill("");
  await shot("login-375", 375);
  await open("accounts");
  await expect(
    page.getByRole("heading", { name: "账号与权限", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("合成待设置运营", { exact: true })).toBeVisible();
  await shot("accounts-desktop", 1440);
  await shot("accounts-320", 320);
  await page.getByRole("button", { name: "开通账号", exact: true }).click();
  await page.getByLabel("登录账号（创建后不可修改）").fill("synthetic.new");
  await page.getByLabel("显示名称", { exact: true }).fill("合成新运营");
  await page.getByRole("button", { name: "确认开通账号", exact: true }).click();
  await expect(page.getByLabel("密码设置链接")).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage)
        .map((k) => sessionStorage.getItem(k))
        .join(""),
    ),
  ).not.toContain("qfa_setup_v1_");
  await expect(
    page.getByRole("button", { name: "明确结束本次记录" }),
  ).toBeDisabled();
  await page.getByText("我已妥善保存或发送设置链接").click();
  await page.getByRole("button", { name: "明确结束本次记录" }).click();
  await expect(page.getByLabel("密码设置链接")).toHaveCount(0);
  results.push("one-off-link-never-persisted");
  await open("accounts", "&unknown=1");
  await page.getByRole("button", { name: "开通账号", exact: true }).click();
  await page.getByLabel("登录账号（创建后不可修改）").fill("synthetic.unknown");
  await page.getByLabel("显示名称", { exact: true }).fill("合成未知操作");
  await page.getByRole("button", { name: "确认开通账号", exact: true }).click();
  await expect(page.getByText("原操作编号：", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认开通账号", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "核实原操作", exact: true }).click();
  await expect(
    page.getByText("结果待确认，请先核实，勿重复提交。"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        window.calls.filter(
          (c) => c.method === "POST" && c.path.endsWith("/accounts"),
        ).length,
    ),
  ).toBe(1);
  await page.evaluate(() => {
    window.resultFound = true;
  });
  await page.getByRole("button", { name: "核实原操作", exact: true }).click();
  await expect(page.getByText("已核实原操作，请查看处理结果。")).toBeVisible();
  await expect(page.getByLabel("密码设置链接")).toHaveCount(0);
  await page.getByRole("button", { name: "明确结束本次记录" }).click();
  results.push("unknown-original-only-no-replay");
  await open("self", "&role=read-only");
  await expect(
    page.getByRole("heading", { name: "我的账号", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("新密码", { exact: true })).toHaveAttribute(
    "autocomplete",
    "new-password",
  );
  await shot("self-read-only-390", 390);
  await open("audit");
  await expect(page.getByText("调整角色", { exact: true })).toBeVisible();
  await shot("audit-430", 430);
  await open("recovery");
  const file = page.locator("input[type=file]");
  await file.setInputFiles({
    name: "synthetic.quizpack",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("synthetic-file-only"),
  });
  await expect(
    page.getByText("synthetic.quizpack", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "建立本次接收记录", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "以原操作和原输入重提", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    window.fileNode = document.querySelector("input[type=file]");
    window.fileObject = window.fileNode.files[0];
    window.revoke();
    window.currentSession = {
      ...window.currentSession,
      operator: {
        ...window.currentSession.operator,
        id: "00000000-0000-4000-8000-000000000099",
      },
    };
  });
  await page.getByRole("button", { name: "检查登录状态" }).click();
  await expect(
    page.getByText("当前登录的是其他账号。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "继续原任务" })).toHaveCount(0);
  await page.evaluate(() => {
    window.currentSession = {
      ...window.currentSession,
      operator: {
        ...window.currentSession.operator,
        id: "00000000-0000-4000-8000-000000000001",
        role: "read-only",
      },
    };
  });
  await page.getByRole("button", { name: "检查登录状态" }).click();
  await page
    .getByRole("checkbox", {
      name: "我已核对账号与操作状态，继续后先核实待确认结果",
    })
    .check();
  await page.getByRole("button", { name: "继续原任务" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.fileNode === document.querySelector("input[type=file]") &&
          window.fileObject === window.fileNode.files[0],
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "以原操作和原输入重提", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        window.calls.filter(
          (c) => c.method === "POST" && c.path.endsWith("/imports"),
        ).length,
    ),
  ).toBe(1);
  results.push(
    "same-owner-generation-file-dom-preserved-different-owner-blocked",
  );
  await open("setup", "#token=qfa_setup_v1_" + "A".repeat(43));
  await expect(page.getByText("登录账号：synthetic.admin")).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe("");
  await page
    .getByLabel("新密码", { exact: true })
    .fill("synthetic long new password");
  await page
    .getByLabel("确认新密码", { exact: true })
    .fill("synthetic long new password");
  await page.getByRole("button", { name: "确认设置密码", exact: true }).click();
  await expect(page.getByText("原操作编号：", { exact: false })).toBeVisible();
  const originalId = await page.evaluate(
    () =>
      JSON.parse(
        sessionStorage.getItem(
          "quizforge.studio.password-setup.v1:00000000-0000-4000-8000-000000000001",
        ),
      ).operationId,
  );
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage)
        .map((k) => sessionStorage.getItem(k))
        .join(""),
    ),
  ).not.toContain("qfa_setup_v1_");
  await open(
    "setup",
    "&expired=1#token=qfa_setup_v1_" +
      "A".repeat(43) +
      "&tokenId=00000000-0000-4000-8000-000000000001",
  );
  await expect(
    page.getByText("原操作编号：" + originalId, { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.resultFound = true;
  });
  await page
    .getByRole("button", { name: "核实原设置结果", exact: true })
    .click();
  await expect(page.getByText("已核实上次操作：密码设置成功。")).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.path.endsWith("/auth/password-login") ||
          c.path.endsWith("/auth/logout"),
      ),
    ),
  ).toBe(false);
  results.push(
    "setup-fragment-stripped-expired-token-original-result-no-auto-login",
  );
  await open(
    "setup",
    "#token=qfa_setup_v1_" +
      "A".repeat(43) +
      "&tokenId=00000000-0000-4000-8000-000000000099",
  );
  await expect(
    page.getByText("设置链接与账号信息不一致，已停止操作。请联系管理员核实。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认设置密码", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "核实原设置结果", exact: true }),
  ).toBeDisabled();
  results.push("setup-untrusted-token-index-mismatch-blocked");
  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        browser: "Chromium",
        evidence:
          "synthetic HTTP and React UI only; no application or DB server",
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
