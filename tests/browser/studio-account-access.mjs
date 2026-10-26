/** Real account React components with synthetic HTTP. No server, database or real credentials.
 * Entry routes use their actual pathname. Screenshots contain only synthetic, non-secret states.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.resolve("package.json"));
const { chromium, expect } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
const postcss = createRequire(require.resolve("next/package.json"))("postcss");
const tailwind = require("@tailwindcss/postcss");
const out = path.resolve(".cache/studio-account-access", String(Date.now()));
await mkdir(out, { recursive: true, mode: 0o700 });
const source = `
import {createRoot} from 'react-dom/client';
import {StudioShell} from '@/features/studio/shell';
import {MyAccountPage} from '@/features/studio/accounts/self-page';
import {SetPasswordPage} from '@/features/studio/accounts/set-password-page';
import {AccountAuditPage} from '@/features/studio/accounts/audit-page';
import {StudioLoginForm} from '@/features/studio/login-form';
import {invalidateCurrentStudioAuthority} from '@/features/studio/authority-events';
const id='00000000-0000-4000-8000-000000000001',target='00000000-0000-4000-8000-000000000002';
const now=new Date().toISOString(),expiry=new Date(Date.now()+1800000).toISOString();
const session={operator:{id,label:'synthetic-stable-label',loginName:'synthetic.admin',displayName:'合成管理员',role:'admin',accountRevision:1},csrfToken:'A'.repeat(43),idleExpiresAt:expiry,absoluteExpiresAt:new Date(Date.now()+28800000).toISOString()};
const account={id,label:'synthetic-stable-label',loginName:'synthetic.admin',displayName:'合成管理员',role:'admin',status:'active',revision:1,createdAt:now,disabledAt:null};
const params=new URLSearchParams(location.search),scenario=params.get('case')||'success';
window.calls=[];window.auditQueries=[];window.resultFound=false;window.currentSession=session;window.originalSession=session;window.revoke=invalidateCurrentStudioAuthority;window.routes=[];window.records={};
if(scenario==='reader'){session.operator.role='read-only';account.role='read-only';}
const operation=(operationId,action,actorId=id,targetId=id)=>({operationId,action,actorId,targetId,status:'completed',errorCode:null,createdAt:now});
window.fetch=async(raw,init={})=>{
 const url=new URL(raw,location.href),method=init.method||'GET',body=init.body?JSON.parse(init.body):{};
 window.calls.push({path:url.pathname,search:url.search,method,operationId:body.operationId});
 if(url.pathname.endsWith('/auth/preauth'))return Response.json({csrfToken:'A'.repeat(43),expiresAt:expiry});
 if(url.pathname.endsWith('/auth/password-login'))return Response.json(session);
 if(url.pathname.endsWith('/auth/logout')){
  if(scenario==='logout-broadcast')return await new Promise(resolve=>{window.releaseLogout=()=>resolve(new Response(null,{status:204}));window.logoutWaiting=true;});
  return new Response(null,{status:204});
 }
 if(url.pathname.endsWith('/auth/session'))return Response.json(window.currentSession);
 if(url.pathname.endsWith('/accounts/me'))return Response.json(account);
 if(url.pathname.endsWith('/accounts/me/password')||url.pathname.endsWith('/accounts/me/logout-all')){
  const action=url.pathname.endsWith('/password')?'password-change':'logout-all';window.records[body.operationId]=operation(body.operationId,action);
  if(scenario==='unknown')throw Error('synthetic acknowledgement loss');
  if(scenario==='rate')return Response.json({code:'RATE_LIMITED'},{status:429});
  return Response.json(operation(body.operationId,action));
 }
 if(url.pathname.includes('/accounts/operations/')){const op=url.pathname.split('/').pop();return Response.json(window.resultFound?{status:'found',operation:window.records[op]}:{status:'unknown',operationId:op});}
 if(url.pathname.endsWith('/password-setup/inspect')){
  if(scenario==='expired')return Response.json({code:'PASSWORD_TOKEN_INVALID'},{status:400});
  return Response.json({tokenId:target,purpose:'setup',loginName:'synthetic.operator',displayName:'合成运营人员',expiresAt:expiry,passwordPolicy:{minCodePoints:15,maxCodePoints:256}});
 }
 if(url.pathname.endsWith('/auth/password-setup')){
  window.records[body.operationId]=operation(body.operationId,'password-setup',null,target);
  if(scenario==='unknown')throw Error('synthetic acknowledgement loss');
  if(scenario==='rate')return Response.json({code:'RATE_LIMITED'},{status:429});
  return Response.json(window.records[body.operationId]);
 }
 if(url.pathname.endsWith('/password-setup/result'))return Response.json(window.resultFound?{status:'found',operation:window.records[body.operationId]}:{status:'unknown',operationId:body.operationId});
 if(url.pathname.endsWith('/accounts/audit')){
  window.auditQueries.push(url.search);
  if(window.auditFail)return Response.json({code:'STUDIO_UNAVAILABLE'},{status:503});
  const q=url.searchParams.get('q'),action=url.searchParams.get('action'),offset=Number(url.searchParams.get('offset'));
  const base={...operation('00000000-0000-4000-8000-000000000003','role',id,target),actorDisplayName:'合成管理员',targetDisplayName:'合成运营人员'};
  const item=q?{...base,operationId:'00000000-0000-4000-8000-000000000004',targetDisplayName:'跨页目标'}:offset?{...base,targetDisplayName:'下一页人员'}:base;
  if(action&&action!=='all'){item.action=action;item.status='rejected';item.errorCode='LAST_ACTIVE_ADMIN';}
  return Response.json({items:q==='无结果'?[]:[item],offset,limit:25,total:q==='无结果'?0:q||action!=='all'?1:26,hasMore:!q&&action==='all'&&offset===0,snapshotAt:now});
 }
 throw Error('unexpected synthetic request '+url.pathname);
};
const route=location.pathname;
const entry=route==='/studio/login'||route==='/studio/set-password';
const content=route==='/studio/login'?<StudioLoginForm/>:route==='/studio/set-password'?<SetPasswordPage/>:route==='/studio/accounts/audit'?<AccountAuditPage/>:<MyAccountPage session={session}/>;
createRoot(document.getElementById('root')).render(<StudioShell authenticated={!entry} identity={{label:session.operator.displayName,role:session.operator.role}} session={entry?undefined:session}>{content}</StudioShell>);
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
              ? "export function usePathname(){return window.location.pathname} export function useRouter(){return {replace:p=>window.routes.push(p),refresh:()=>{}}}"
              : 'export const types=new Proxy({}, {get(){throw Error("UNEXPECTED_NODE_POLICY")}})',
          loader: "js",
        }));
      },
    },
  ],
});
const globalsPath = path.resolve("src/app/globals.css"),
  globals = await postcss([tailwind({ base: process.cwd() })]).process(
    await readFile(globalsPath, "utf8"),
    { from: globalsPath },
  );
const css =
    globals.css + "\n" + (await readFile(path.join(out, "probe.css"), "utf8")),
  bundle = await readFile(path.join(out, "probe.js"), "utf8");
const origin = "http://127.0.0.1:32887",
  id = "00000000-0000-4000-8000-000000000001",
  target = "00000000-0000-4000-8000-000000000002";
const passwordKey = `quizforge.studio.account-operation.v1:${id}:password`,
  allKey = `quizforge.studio.account-operation.v1:${id}:logout-all`,
  setupKey = `quizforge.studio.password-setup.v1:${target}`;
const token = "qfa_setup_v1_" + "A".repeat(43),
  phrase = "synthetic access long passphrase 2026";
const selected = new Set(
  (
    process.env.QUIZFORGE_ACCOUNT_ACCESS_CASES ??
    "login,self,unknown,rate,logout,setup,expired,setupunknown,audit"
  ).split(","),
);
const browser = await chromium.launch(),
  results = [],
  errors = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
let page;
async function open(route, scenario = "success") {
  if (page) await page.close();
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(origin + "/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
    }),
  );
  const hash =
    route === "/studio/set-password" ? `#token=${token}&tokenId=${target}` : "";
  await page.goto(origin + route + "?case=" + scenario + hash);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
}
async function assertLayout() {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  const small = await page
    .locator(
      "[data-account-access] button:visible,[data-studio-entry] button:visible",
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return r.width < 43.5 || r.height < 43.5;
        })
        .map((n) => n.textContent),
    );
  expect(small).toEqual([]);
}
async function shot(name, width = 1440) {
  await page.setViewportSize({ width, height: 1000 });
  await assertLayout();
  await page.screenshot({ path: path.join(out, name + ".png") });
}
async function fillPassword() {
  await page.getByLabel("当前密码", { exact: true }).fill(phrase);
  await page.getByLabel("新密码", { exact: true }).fill(phrase + " next");
  await page.getByLabel("确认新密码", { exact: true }).fill(phrase + " next");
}
async function posts(path) {
  return page.evaluate(
    (p) =>
      window.calls.filter((c) => c.path === p && c.method === "POST").length,
    path,
  );
}
try {
  if (selected.has("login")) {
    await open("/studio/login");
    await expect(
      page.getByText("请输入登录账号和密码。", { exact: true }),
    ).toBeVisible();
    const pw = page.getByLabel("密码", { exact: true });
    await pw.fill(phrase);
    await page.evaluate(
      () =>
        (window.passwordNode = document.querySelector(
          'input[autocomplete="current-password"]',
        )),
    );
    await page.getByRole("button", { name: "显示密码", exact: true }).click();
    await expect(pw).toHaveAttribute("type", "text");
    expect(
      await page.evaluate(
        () =>
          window.passwordNode ===
          document.querySelector('input[autocomplete="current-password"]'),
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "隐藏密码", exact: true }).click();
    await pw.fill("");
    await shot("login-1440");
    await shot("login-390", 390);
    for (const width of [320, 375, 430]) {
      await page.setViewportSize({ width, height: 900 });
      await assertLayout();
    }
    await page.getByLabel("登录账号", { exact: true }).fill("synthetic.admin");
    await pw.fill(phrase);
    await page
      .getByRole("button", { name: "登录 Studio", exact: true })
      .click();
    await expect(pw).toHaveValue("");
    await expect
      .poll(() => page.evaluate(() => window.routes.includes("/studio")))
      .toBe(true);
    results.push(
      "login form, stable password input/visibility, actual route and mobile entry",
    );
  }
  if (selected.has("self")) {
    await open("/studio/session");
    await expect(
      page.getByRole("heading", { name: "我的账号", exact: true }),
    ).toBeVisible();
    await shot("self-1440");
    await shot("self-390", 390);
    for (const width of [320, 375, 430]) {
      await page.setViewportSize({ width, height: 900 });
      await assertLayout();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "修改登录密码", exact: true }),
    ).toBeVisible();
    await shot("password-modal-1440");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByLabel("保留的密码输入")).toHaveCount(0);
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    await fillPassword();
    await page.evaluate(
      () =>
        (window.originalCurrent = document.querySelector(
          'input[autocomplete="current-password"]',
        )),
    );
    await page
      .getByRole("button", { name: "收起并保留输入", exact: true })
      .click();
    await expect(page.getByLabel("保留的密码输入")).toBeVisible();
    await page
      .getByRole("button", { name: "继续修改密码", exact: true })
      .click();
    await expect(page.getByLabel("当前密码", { exact: true })).toHaveValue(
      phrase,
    );
    expect(
      await page.evaluate(
        () =>
          window.originalCurrent ===
          document.querySelector('input[autocomplete="current-password"]'),
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "确认修改密码", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "登录密码已修改" }),
    ).toBeVisible();
    await expect(page.getByLabel("当前密码", { exact: true })).toHaveValue("");
    await page
      .getByRole("button", { name: "关闭修改登录密码", exact: true })
      .click();
    await expect(
      page.getByText("当前登录已失效。请完成原操作记录后重新登录。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "退出当前", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "修改密码", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "继续处理原改密操作", exact: true })
      .click();
    await page
      .getByRole("button", { name: "完成并返回登录", exact: true })
      .click();
    await expect(page).toHaveURL(origin + "/studio/login");
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), passwordKey),
    ).toBeNull();
    results.push(
      "self two-column profile, empty close, preserved DOM/draft, erased sent passwords, confirmed finish before logout",
    );
  }
  if (selected.has("unknown")) {
    await open("/studio/session", "unknown");
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    await fillPassword();
    await page
      .getByRole("button", { name: "确认修改密码", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "核实原操作", exact: true }),
    ).toBeVisible();
    const pending = await page.evaluate(
      (k) => sessionStorage.getItem(k),
      passwordKey,
    );
    expect(pending).not.toContain(phrase);
    await expect(
      page.getByRole("button", { name: "明确结束本次记录", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "收起并保留记录", exact: true })
      .click();
    await page.evaluate(() => window.revoke());
    await page.evaluate(
      () =>
        (window.currentSession = {
          ...window.originalSession,
          operator: {
            ...window.originalSession.operator,
            id: "00000000-0000-4000-8000-000000000009",
          },
        }),
    );
    await page
      .getByRole("button", { name: "检查登录状态", exact: true })
      .click();
    await expect(page.getByText(/当前登录的是其他账号/)).toBeVisible();
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), passwordKey),
    ).toBe(pending);
    await page.evaluate(() => (window.currentSession = window.originalSession));
    await page
      .getByRole("button", { name: "检查登录状态", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: /我已核对账号与操作状态/ })
      .check();
    await page.getByRole("button", { name: "继续原任务", exact: true }).click();
    await page
      .getByRole("button", { name: "继续处理原改密操作", exact: true })
      .click();
    await page.getByRole("button", { name: "核实原操作", exact: true }).click();
    expect(await posts("/api/studio/accounts/me/password")).toBe(1);
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), passwordKey),
    ).toBe(pending);
    await page.evaluate(() => (window.resultFound = true));
    await page.getByRole("button", { name: "核实原操作", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "完成并返回登录", exact: true }),
    ).toBeVisible();
    results.push(
      "UNKNOWN tuple kept through close and wrong-owner denial; explicit same-owner restore and readonly receipt resolution only",
    );
  }
  if (selected.has("rate")) {
    await open("/studio/session", "rate");
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    await fillPassword();
    await page
      .getByRole("button", { name: "确认修改密码", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "明确结束本次记录", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "明确结束本次记录", exact: true })
      .click();
    expect(await posts("/api/studio/accounts/me/password")).toBe(1);
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), passwordKey),
    ).toBeNull();
    results.push("definite 429 may end explicitly without automatic retry");
  }
  if (selected.has("logout")) {
    await open("/studio/session");
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    await fillPassword();
    await page
      .getByRole("button", { name: "收起并保留输入", exact: true })
      .click();
    await page.getByRole("button", { name: "退出全部", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "退出全部登录", exact: true }),
    ).toBeVisible();
    expect(await posts("/api/studio/accounts/me/logout-all")).toBe(0);
    await expect(
      page
        .getByRole("dialog", { name: "退出全部登录", exact: true })
        .getByText("本页还有未提交的密码输入；确认退出将放弃这些输入。", {
          exact: true,
        }),
    ).toBeVisible();
    await page.getByRole("button", { name: "保留登录", exact: true }).click();
    await expect(page.getByLabel("当前密码", { exact: true })).toHaveValue(
      phrase,
    );
    expect(await posts("/api/studio/accounts/me/logout-all")).toBe(0);
    await page.getByRole("button", { name: "退出全部", exact: true }).click();
    await page
      .getByRole("button", { name: "确认退出全部登录", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "全部登录已退出", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "完成并返回登录", exact: true })
      .click();
    await expect(page).toHaveURL(origin + "/studio/login");
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), allKey),
    ).toBeNull();
    await open("/studio/session");
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    await fillPassword();
    await page
      .getByRole("button", { name: "收起并保留输入", exact: true })
      .click();
    await page.getByRole("button", { name: "退出当前", exact: true }).click();
    expect(await posts("/api/studio/auth/logout")).toBe(0);
    await expect(
      page
        .getByRole("dialog", { name: "退出当前登录", exact: true })
        .getByText("本页还有未提交的密码输入；确认退出将放弃这些输入。", {
          exact: true,
        }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "确认退出当前登录", exact: true })
      .click();
    await expect(page).toHaveURL(origin + "/studio/login");
    results.push(
      "current/all logout have separate explicit confirmation and scope",
    );
  }
  if (selected.has("logoutbroadcast")) {
    async function holdLogout() {
      await open("/studio/session", "logout-broadcast");
      await page.evaluate(() => {
        window.broadcasts = [];
        window.logoutObserver = new BroadcastChannel(
          "quizforge.studio-authority.v1",
        );
        window.logoutObserver.onmessage = (event) =>
          window.broadcasts.push(event.data);
      });
      await page.getByRole("button", { name: "退出当前", exact: true }).click();
      await page
        .getByRole("button", { name: "确认退出当前登录", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => window.logoutWaiting))
        .toBe(true);
      // A real channel task must run before releasing HTTP, exposing the old
      // pre-request broadcast race rather than relying on immediate mock fetch.
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const sender = new BroadcastChannel(
              "quizforge.studio-authority.v1",
            );
            const marker = crypto.randomUUID();
            window.logoutObserver.addEventListener(
              "message",
              function observed(event) {
                if (event.data !== marker) return;
                window.logoutObserver.removeEventListener("message", observed);
                sender.close();
                resolve();
              },
            );
            sender.postMessage(marker);
          }),
      );
      expect(await posts("/api/studio/auth/logout")).toBe(1);
    }
    await holdLogout();
    const beforeReceipt = await page.evaluate(
      () => window.broadcasts.filter((v) => v === "invalidate").length,
    );
    await page.evaluate(() => window.releaseLogout());
    await expect(page).toHaveURL(origin + "/studio/login");
    expect(beforeReceipt).toBe(0);
    results.push(
      "delayed current logout 204 navigates after real BroadcastChannel task without self-invalidating its receipt",
    );

    await holdLogout();
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const sender = new BroadcastChannel("quizforge.studio-authority.v1");
          window.logoutObserver.addEventListener(
            "message",
            function observed(event) {
              if (event.data !== "invalidate") return;
              window.logoutObserver.removeEventListener("message", observed);
              sender.close();
              resolve();
            },
          );
          sender.postMessage("invalidate");
        }),
    );
    await page.evaluate(() => window.releaseLogout());
    await expect(
      page
        .getByRole("dialog", { name: "退出当前登录", exact: true })
        .getByRole("alert"),
    ).toHaveText("Studio 暂不可用，请由本机维护者检查配置与数据库。");
    await expect(
      page.getByRole("button", { name: "确认退出当前登录", exact: true }),
    ).toBeDisabled();
    expect(page.url()).toContain("/studio/session");
    expect(await posts("/api/studio/auth/logout")).toBe(1);
    results.push(
      "independent channel invalidation still rejects the old logout receipt and keeps writes disabled without retry",
    );
  }
  if (selected.has("setup")) {
    await open("/studio/set-password");
    await expect(
      page.getByText("登录账号：synthetic.operator", { exact: true }),
    ).toBeVisible();
    expect(page.url()).not.toContain("token=");
    await shot("setup-1440");
    await shot("setup-390", 390);
    for (const width of [320, 375, 430]) {
      await page.setViewportSize({ width, height: 900 });
      await assertLayout();
    }
    await page.getByLabel("新密码", { exact: true }).fill(phrase);
    await page.getByLabel("确认新密码", { exact: true }).fill(phrase);
    await page
      .getByRole("button", { name: "确认设置密码", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "密码设置成功", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "完成并返回登录", exact: true })
      .click();
    await expect(page).toHaveURL(origin + "/studio/login");
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), setupKey),
    ).toBeNull();
    results.push(
      "actual bearer inspect, scrubbed fragment, setup success and confirmed return to login",
    );
  }
  if (selected.has("expired")) {
    await open("/studio/set-password", "expired");
    await expect(page.getByText(/入口失效或未收到完整链接/)).toBeVisible();
    await expect(page.getByLabel("新密码", { exact: true })).toHaveCount(0);
    expect(await posts("/api/studio/auth/password-setup")).toBe(0);
    results.push("invalid/expired setup does not expose a writable form");
  }
  if (selected.has("setupunknown")) {
    await open("/studio/set-password", "unknown");
    await expect(page.getByLabel("新密码", { exact: true })).toBeVisible();
    await page.getByLabel("新密码", { exact: true }).fill(phrase);
    await page.getByLabel("确认新密码", { exact: true }).fill(phrase);
    await page
      .getByRole("button", { name: "确认设置密码", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "核实原设置结果", exact: true }),
    ).toBeVisible();
    const setupPending = await page.evaluate(
      (k) => sessionStorage.getItem(k),
      setupKey,
    );
    expect(setupPending).not.toContain(phrase);
    expect(setupPending).not.toContain(token);
    await page
      .getByRole("button", { name: "核实原设置结果", exact: true })
      .click();
    expect(await posts("/api/studio/auth/password-setup")).toBe(1);
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), setupKey),
    ).toBe(setupPending);
    results.push(
      "setup UNKNOWN preserves original index and never re-sends password",
    );
  }
  if (selected.has("audit")) {
    await open("/studio/accounts/audit");
    await expect(page.getByText("共 26 条记录", { exact: true })).toBeVisible();
    await shot("audit-1440");
    await page
      .getByRole("button", { name: "查看调整角色详情", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "操作详情", exact: true }),
    ).toBeVisible();
    await shot("audit-detail-1440");
    expect(
      await page
        .getByRole("dialog", { name: "操作详情", exact: true })
        .innerText(),
    ).not.toContain(token);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "操作详情", exact: true }),
    ).not.toBeVisible();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(
      page.getByText("下一页人员", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await page
      .getByLabel("操作者 / 目标人员", { exact: true })
      .fill("跨页目标");
    await page.getByRole("button", { name: "查询记录", exact: true }).click();
    await expect(
      page.getByText("共 1 条匹配记录", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          new URLSearchParams(window.auditQueries.at(-1)).get("q"),
        ),
      )
      .toBe("跨页目标");
    expect(
      await page.evaluate(() =>
        new URLSearchParams(window.auditQueries.at(-1)).get("offset"),
      ),
    ).toBe("0");
    await page.getByLabel("操作类型", { exact: true }).selectOption("disable");
    await page.getByRole("button", { name: "查询记录", exact: true }).click();
    await expect(
      page.getByText("已拒绝", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        new URLSearchParams(window.auditQueries.at(-1)).get("action"),
      ),
    ).toBe("disable");
    await shot("audit-390", 390);
    for (const width of [320, 375, 430]) {
      await page.setViewportSize({ width, height: 900 });
      await assertLayout();
    }
    await page
      .getByRole("button", { name: "查看停用账号详情", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "操作详情", exact: true }),
    ).toBeVisible();
    await assertLayout();
    await page.keyboard.press("Escape");
    await page.getByLabel("操作者 / 目标人员", { exact: true }).fill("无结果");
    await page.getByRole("button", { name: "查询记录", exact: true }).click();
    await expect(
      page.getByText("没有符合条件的操作记录", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => (window.auditFail = true));
    await page.getByRole("button", { name: "刷新记录", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(
      await page.evaluate(
        () => window.calls.filter((c) => c.method !== "GET").length,
      ),
    ).toBe(0);
    results.push(
      "server-wide audit search/action/page/reset, total snapshot, table/mobile cards, readonly drawer and failure state",
    );
  }
  if (selected.has("navigation")) {
    for (const route of ["/studio/session", "/studio/accounts/audit"]) {
      await open(route);
      const tabs = page.getByRole("navigation", {
        name: "账号工作区",
        exact: true,
      });
      await expect(tabs.getByRole("link")).toHaveCount(3);
      await expect(tabs.locator('a[aria-current="page"]')).toHaveAttribute(
        "href",
        route,
      );
      await expect(
        tabs.getByRole("link", { name: "账号与权限", exact: true }),
      ).toHaveAttribute("href", "/studio/accounts");
    }
    await open("/studio/session", "reader");
    const tabs = page.getByRole("navigation", {
      name: "账号工作区",
      exact: true,
    });
    await expect(tabs.getByRole("link")).toHaveCount(1);
    await expect(
      tabs.getByRole("link", { name: "我的账号", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByText(
        "仅可查看测评、版本和已授权的安全信息，不可进行业务写入。",
        { exact: false },
      ),
    ).toBeVisible();
    results.push(
      "account route tabs use real href/current route and read-only role exposes only self",
    );
  }
  if (selected.has("layout")) {
    for (const [route, ready] of [
      ["/studio/login", "请输入登录账号和密码。"],
      ["/studio/set-password", "登录账号：synthetic.operator"],
    ]) {
      await open(route);
      await expect(page.getByText(ready, { exact: true })).toBeVisible();
      for (const width of [1440, 320, 375, 390, 430]) {
        await page.setViewportSize({ width, height: 1000 });
        await assertLayout();
        const box = await page.locator("[data-studio-entry]").boundingBox();
        expect(Math.abs(box.width - width)).toBeLessThan(1);
        expect(box.height).toBeGreaterThanOrEqual(1000);
        if (width < 731)
          await expect(
            page.getByRole("complementary", { name: "QuizForge Studio" }),
          ).toBeHidden();
        const fontSizes = await page
          .locator("[data-studio-entry] input:visible")
          .evaluateAll((nodes) =>
            nodes.map((n) => parseFloat(getComputedStyle(n).fontSize)),
          );
        expect(fontSizes.every((size) => size >= 16)).toBe(true);
      }
      if (route.endsWith("login")) await shot("final-login-1440", 1440);
      else await shot("final-setup-390", 390);
    }
    for (const route of ["/studio/session", "/studio/accounts/audit"]) {
      await open(route);
      await expect(
        page.getByRole("navigation", { name: "账号工作区", exact: true }),
      ).toBeVisible();
      for (const width of [1440, 320, 375, 390, 430]) {
        await page.setViewportSize({ width, height: 1000 });
        await assertLayout();
        if (width === 1440 || width === 390)
          await shot(
            `final-${route.endsWith("session") ? "self" : "audit"}-${width}`,
            width,
          );
      }
      if (route.endsWith("session")) {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page
          .getByRole("button", { name: "修改密码", exact: true })
          .click();
        expect(
          await page
            .locator("dialog:modal")
            .evaluate((n) => Math.round(n.getBoundingClientRect().width)),
        ).toBe(490);
        await shot("final-short-task-1440", 1440);
      }
    }
    results.push(
      "integrated entry shell: exact full viewport, five widths, mobile hidden side, 16px inputs and 44px targets",
    );
  }
  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        results,
        errors,
        screenshots:
          "Representative 1440/390 images only; 320/375/430 geometry assertions",
        evidence:
          "Real React components with synthetic HTTP; no DB/application integration.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ out, passed: results.length, errors }));
} catch (error) {
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        results,
        errors,
        failure: error instanceof Error ? error.message : "probe failed",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ out, completed: results.length }));
  throw error;
} finally {
  await browser.close();
}
