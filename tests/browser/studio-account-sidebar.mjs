/** Sidebar logout wiring with the real owner, leave gate and native BroadcastChannel.
 * HTTP is synthetic and held until browser channel delivery; no app/DB process.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.resolve("package.json"));
const { chromium, expect } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
const out = path.resolve(".cache/studio-account-sidebar", String(Date.now()));
await mkdir(out, { recursive: true, mode: 0o700 });
await esbuild.build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
import {createRoot} from 'react-dom/client';
import {useCallback,useEffect,useState} from 'react';
import {StudioNavigation} from '@/features/studio/navigation';
import shellStyles from '@/features/studio/studio.module.css';
import {StudioNavigationBoundary,useStudioLeaveProtection} from '@/features/studio/navigation-boundary';
import {StudioMobileNavigation,useStudioMobileNavigation} from '@/features/studio/mobile-navigation';
import {StudioAccountOwner,useStudioAccountOwner,useOwnedStudioSession} from '@/features/studio/accounts/session-owner';
import {SidebarLogoutAction} from '@/features/studio/accounts/sidebar-logout-action';
import {invalidateCurrentStudioAuthority} from '@/features/studio/authority-events';
const session={operator:{id:'00000000-0000-4000-8000-000000000001',label:'synthetic',loginName:'synthetic.reader',displayName:'合成只读人员',role:'read-only',accountRevision:1},csrfToken:'A'.repeat(43),idleExpiresAt:'2030-01-01T00:00:00.000Z',absoluteExpiresAt:'2030-01-01T00:00:00.000Z'};
const sessionChangeCase=new URLSearchParams(location.search).get('case')==='sessionchange';
if(sessionChangeCase){session.operator.role='admin';session.operator.displayName='合成管理员';}
window.currentSession=session;window.logoutCalls=[];window.revoke=invalidateCurrentStudioAuthority;window.sessionChanges=[];window.ownerMounts=0;
window.fetch=async(raw,init={})=>{
 const url=new URL(raw,location.href);
 if(url.pathname==='/api/studio/auth/session')return Response.json(window.currentSession);
 if(url.pathname==='/api/studio/auth/logout'){
  window.logoutCalls.push({csrf:init.headers['X-CSRF-Token']});
  return await new Promise(resolve=>{window.releaseLogout=()=>resolve(new Response(null,{status:204}));});
 }
 throw Error('UNEXPECTED_SYNTHETIC_REQUEST');
};
function Surface(){
 const nav=useStudioMobileNavigation(),owner=useStudioAccountOwner();
 const [protectedTask,setProtected]=useState({dirty:false,pending:false});
 useStudioLeaveProtection(protectedTask);
 useEffect(()=>{window.setProtected=setProtected;},[]);
 return <><SidebarLogoutAction session={session}/>
 <button ref={nav.registerTrigger} onClick={nav.open}>打开导航</button>
 <dialog ref={nav.registerDialog} aria-label="主导航"><button data-navigation-close onClick={nav.close}>关闭导航</button><div id="studio-sidebar-logout"/></dialog>
 <output data-testid="owner" data-revoked={String(owner.revoked)} data-generation={owner.generation}/>
 <output data-testid="protected">{JSON.stringify(protectedTask)}</output>
 </>;
}
function RecoveryFacts(){
 const owner=useStudioAccountOwner(),owned=useOwnedStudioSession(session);
 const [draft,setDraft]=useState('保留的未提交输入');
 useState(()=>{window.ownerMounts++;return null;});
 return <><input aria-label="原任务输入" value={draft} onChange={event=>setDraft(event.target.value)}/><output data-testid="recovery-role">{owned.operator.role}</output><output data-testid="recovery-generation">{owner.generation}</output></>;
}
function Harness(){
 const [accepted,setAccepted]=useState(session);
 const changed=useCallback(fresh=>{window.sessionChanges.push({id:fresh.operator.id,role:fresh.operator.role});setAccepted(fresh);},[]);
 if(sessionChangeCase)return <div className={shellStyles.shell}><StudioNavigation identity={{label:accepted.operator.displayName,role:accepted.operator.role}}/><main className={shellStyles.main}><StudioAccountOwner initialSession={session} onSessionChange={changed}><RecoveryFacts/></StudioAccountOwner></main></div>;
 return <StudioAccountOwner initialSession={session}><Surface/></StudioAccountOwner>;
}
createRoot(document.getElementById('root')).render(<StudioNavigationBoundary><StudioMobileNavigation><Harness/></StudioMobileNavigation></StudioNavigationBoundary>);
`,
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
      name: "route",
      setup(b) {
        b.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "navigation",
          namespace: "probe",
        }));
        b.onLoad({ filter: /.*/, namespace: "probe" }, () => ({
          contents:
            "export function usePathname(){return window.location.pathname} export function useRouter(){return {replace:()=>{},refresh:()=>{}}}",
          loader: "js",
        }));
      },
    },
  ],
});
const bundle = await readFile(path.join(out, "probe.js"), "utf8"),
  css = await readFile(path.join(out, "probe.css"), "utf8");
const browser = await chromium.launch(),
  origin = "http://127.0.0.1:32893",
  results = [],
  errors = [];
let context, page;
async function open(width = 1440, scenario = "") {
  if (context) await context.close();
  context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(origin + "/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto(origin + "/studio" + (scenario ? "?case=" + scenario : ""));
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  if (scenario !== "sessionchange")
    await expect(page.locator("#studio-sidebar-logout button")).toBeAttached();
  else
    await expect(page.getByLabel("原任务输入", { exact: true })).toBeVisible();
}
const launcher = () => page.locator("#studio-sidebar-logout button");
async function launch() {
  if (
    (await page
      .getByRole("button", { name: "打开导航", exact: true })
      .isVisible()) &&
    (await page.evaluate(() => innerWidth < 960))
  )
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await launcher().click();
  await expect(
    page.getByRole("dialog", { name: "退出当前登录", exact: true }),
  ).toBeVisible();
}
async function channelTask(invalidate = false) {
  await page.evaluate(
    (invalidate) =>
      new Promise((resolve) => {
        const observer = new BroadcastChannel("quizforge.studio-authority.v1"),
          sender = new BroadcastChannel("quizforge.studio-authority.v1");
        const marker = invalidate ? "invalidate" : crypto.randomUUID();
        observer.onmessage = (event) => {
          if (event.data === marker) {
            observer.close();
            sender.close();
            resolve();
          }
        };
        sender.postMessage(marker);
      }),
    invalidate,
  );
}
async function start() {
  await page
    .getByRole("button", { name: "确认退出当前登录", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.logoutCalls.length))
    .toBe(1);
  await channelTask();
  await expect(page.locator('[data-testid="owner"]')).toHaveAttribute(
    "data-revoked",
    "true",
  );
}
const selected = (name) =>
  !process.env.QUIZFORGE_ACCOUNT_SIDEBAR_CASES ||
  process.env.QUIZFORGE_ACCOUNT_SIDEBAR_CASES.split(",").includes(name);
try {
  if (selected("gate")) {
    await open();
    await page.evaluate(() =>
      window.setProtected({ dirty: false, pending: true }),
    );
    await expect(page.locator('[data-testid="protected"]')).toContainText(
      '"pending":true',
    );
    page.once("dialog", (d) => d.accept());
    await launcher().click();
    await expect(
      page.getByRole("dialog", { name: "退出当前登录", exact: true }),
    ).not.toBeVisible();
    expect(await page.evaluate(() => window.logoutCalls.length)).toBe(0);
    await page.evaluate(() =>
      window.setProtected({ dirty: true, pending: false }),
    );
    await expect(page.locator('[data-testid="protected"]')).toContainText(
      '"dirty":true',
    );
    page.once("dialog", (d) => d.dismiss());
    await launcher().click();
    await expect(
      page.getByRole("dialog", { name: "退出当前登录", exact: true }),
    ).not.toBeVisible();
    expect(await page.evaluate(() => window.logoutCalls.length)).toBe(0);
    await page.evaluate(() =>
      window.setProtected({ dirty: false, pending: false }),
    );
    await launch();
    await page.evaluate(() =>
      window.setProtected({ dirty: false, pending: true }),
    );
    await expect(page.locator('[data-testid="protected"]')).toContainText(
      '"pending":true',
    );
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "确认退出当前登录", exact: true })
      .click();
    expect(await page.evaluate(() => window.logoutCalls.length)).toBe(0);
    await page.getByRole("button", { name: "保留登录", exact: true }).click();
    await page.evaluate(() =>
      window.setProtected({ dirty: true, pending: false }),
    );
    await expect(page.locator('[data-testid="protected"]')).toContainText(
      '"dirty":true',
    );
    page.once("dialog", (d) => d.accept());
    await launch();
    await page.getByRole("button", { name: "保留登录", exact: true }).click();
    const unload = page
      .waitForEvent("dialog", { timeout: 5000 })
      .then(async (prompt) => {
        expect(prompt.type()).toBe("beforeunload");
        await prompt.dismiss();
      });
    await page.evaluate(() =>
      location.assign(new URL("/outside", window.location.origin).href),
    );
    await unload;
    expect(page.url()).toBe(origin + "/studio");
    expect(await page.evaluate(() => window.logoutCalls.length)).toBe(0);
    results.push(
      "pending blocks opening/submission; canceled dirty leave or logout keeps document protection and sends no request",
    );
  }
  if (selected("mobile")) {
    await open(390);
    await launch();
    await expect(page.locator("dialog:modal")).toHaveCount(1);
    await expect(
      page.getByRole("dialog", { name: "主导航", exact: true }),
    ).not.toBeVisible();
    await start();
    await page.evaluate(() => window.releaseLogout());
    await expect(page).toHaveURL(origin + "/studio/login");
    results.push(
      "mobile navigation closes before confirmation; delayed 204 survives real channel task and navigates once",
    );
  }
  if (selected("external")) {
    await open();
    await launch();
    await start();
    await channelTask(true);
    await page.evaluate(() => window.releaseLogout());
    await expect(
      page
        .getByRole("dialog", { name: "退出当前登录", exact: true })
        .getByRole("alert"),
    ).toContainText("Studio 暂不可用");
    expect(page.url()).toBe(origin + "/studio");
    await expect(
      page.getByRole("button", { name: "确认退出当前登录", exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate(() => window.logoutCalls.length)).toBe(1);
    results.push(
      "external authority invalidation rejects the held old receipt and never retries",
    );
  }
  if (selected("owner")) {
    await open();
    await page.evaluate(() => window.revoke());
    await expect(launcher()).toBeDisabled();
    await page.evaluate(
      () =>
        (window.currentSession = {
          ...window.currentSession,
          csrfToken: "B".repeat(43),
          operator: {
            ...window.currentSession.operator,
            id: "00000000-0000-4000-8000-000000000002",
          },
        }),
    );
    await page
      .getByRole("button", { name: "检查登录状态", exact: true })
      .click();
    await expect(page.getByText(/当前登录的是其他账号/)).toBeVisible();
    await expect(launcher()).toBeDisabled();
    await page.evaluate(
      () =>
        (window.currentSession = {
          ...window.currentSession,
          csrfToken: "C".repeat(43),
          operator: {
            ...window.currentSession.operator,
            id: "00000000-0000-4000-8000-000000000001",
          },
        }),
    );
    await page
      .getByRole("button", { name: "检查登录状态", exact: true })
      .click();
    await page
      .getByLabel("我已核对账号与操作状态，继续后先核实待确认结果", {
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "继续原任务", exact: true }).click();
    await expect(launcher()).toBeEnabled();
    await launch();
    await start();
    expect(await page.evaluate(() => window.logoutCalls[0].csrf)).toBe(
      "C".repeat(43),
    );
    await page.evaluate(() => window.releaseLogout());
    await expect(page).toHaveURL(origin + "/studio/login");
    results.push(
      "other account cannot restore; explicit original-owner recovery uses the new session for logout",
    );
  }
  if (selected("dirty")) {
    await open();
    await page.evaluate(() =>
      window.setProtected({ dirty: true, pending: false }),
    );
    await expect(page.locator('[data-testid="protected"]')).toContainText(
      '"dirty":true',
    );
    page.once("dialog", (d) => d.accept());
    await launch();
    page.once("dialog", (d) => d.accept());
    await start();
    let repeatedUnload = false;
    page.on("dialog", async (d) => {
      repeatedUnload ||= d.type() === "beforeunload";
      await d.dismiss();
    });
    await page.evaluate(() => window.releaseLogout());
    await expect(page).toHaveURL(origin + "/studio/login");
    expect(repeatedUnload).toBe(false);
    results.push(
      "accepted dirty discard permits only the confirmed successful logout document exit without a second prompt",
    );
  }
  if (selected("sessionchange")) {
    await open(1440, "sessionchange");
    const nav = page.getByRole("navigation", {
      name: "Studio 导航",
      exact: true,
    });
    const input = page.getByLabel("原任务输入", { exact: true });
    const original = await input.elementHandle();
    await input.fill("恢复后仍保留的原输入");
    await expect(
      nav.getByRole("link", { name: "账号与权限", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.sessionChanges)).toEqual([]);
    await page.evaluate(() => window.revoke());
    await page.evaluate(
      () =>
        (window.currentSession = {
          ...window.currentSession,
          operator: {
            ...window.currentSession.operator,
            id: "00000000-0000-4000-8000-000000000002",
            role: "operator",
          },
        }),
    );
    await page
      .getByRole("button", { name: "检查登录状态", exact: true })
      .click();
    await expect(page.getByText(/当前登录的是其他账号/)).toBeVisible();
    expect(await page.evaluate(() => window.sessionChanges)).toEqual([]);
    await expect(
      page.getByRole("button", { name: "继续原任务", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(
      () =>
        (window.currentSession = {
          ...window.currentSession,
          csrfToken: "C".repeat(43),
          operator: {
            ...window.currentSession.operator,
            id: "00000000-0000-4000-8000-000000000001",
            role: "operator",
            displayName: "合成运营人员",
            accountRevision: 2,
          },
        }),
    );
    await page
      .getByRole("button", { name: "检查登录状态", exact: true })
      .click();
    const acknowledgement = page.getByLabel(
      "我已核对账号与操作状态，继续后先核实待确认结果",
      { exact: true },
    );
    await expect(acknowledgement).toBeVisible();
    expect(await page.evaluate(() => window.sessionChanges)).toEqual([]);
    await expect(
      nav.getByRole("link", { name: "账号与权限", exact: true }),
    ).toBeVisible();
    await acknowledgement.check();
    expect(await page.evaluate(() => window.sessionChanges)).toEqual([]);
    await page.getByRole("button", { name: "继续原任务", exact: true }).click();
    await expect(page.getByTestId("recovery-role")).toHaveText("operator");
    await expect(page.getByTestId("recovery-generation")).toHaveText("1");
    await expect(
      nav.getByRole("link", { name: "账号与权限", exact: true }),
    ).toHaveCount(0);
    await expect(
      nav.getByRole("link", { name: "账号操作记录", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "我的账号", exact: true }),
    ).toContainText("合成运营人员");
    expect(await page.evaluate(() => window.sessionChanges)).toEqual([
      { id: "00000000-0000-4000-8000-000000000001", role: "operator" },
    ]);
    expect(await page.evaluate(() => window.ownerMounts)).toBe(1);
    expect(await input.evaluate((node, old) => node === old, original)).toBe(
      true,
    );
    await expect(input).toHaveValue("恢复后仍保留的原输入");
    expect(await page.evaluate(() => window.logoutCalls.length)).toBe(0);
    results.push(
      "only explicit same-owner recovery publishes one accepted session; outer real navigation follows downgraded role without remounting owner or losing draft DOM",
    );
  }
  expect(errors).toEqual([]);
} catch (error) {
  await writeFile(path.join(out, "failure.txt"), String(error.stack));
  throw error;
} finally {
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        results,
        errors,
        evidence:
          "Real React/owner/leave gate/BroadcastChannel with synthetic held HTTP; no DB integration.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ out, results, errors }));
  await browser.close();
}
