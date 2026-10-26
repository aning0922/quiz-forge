/** Real people UI with synthetic HTTP. No application database or managed service. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.resolve("package.json"));
const { chromium, expect } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
const postcss = createRequire(require.resolve("next/package.json"))("postcss");
const tailwind = require("@tailwindcss/postcss");
const out = path.resolve(".cache/studio-account-people", String(Date.now()));
await mkdir(out, { recursive: true, mode: 0o700 });
const source = `
import {createRoot} from 'react-dom/client';
import {StudioShell} from '@/features/studio/shell';
import {AccountsPage} from '@/features/studio/accounts/admin-page';
import {invalidateCurrentStudioAuthority} from '@/features/studio/authority-events';
const id='00000000-0000-4000-8000-000000000001', now='2026-10-26T00:00:00.000Z';
const session={operator:{id,label:'合成管理员',loginName:'synthetic.admin',displayName:'合成管理员',role:'admin',accountRevision:1},csrfToken:'A'.repeat(43),idleExpiresAt:'2030-01-01T00:00:00.000Z',absoluteExpiresAt:'2030-01-01T00:00:00.000Z'};
const accounts=Array.from({length:26},(_,i)=>({id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),label:'合成人员',displayName:['合成管理员','合成运营','合成待开通','合成停用'][i]||'合成人员'+(i+1),loginName:'synthetic.'+(i+1),role:i===0?'admin':i===3?'read-only':'operator',status:i===2?'pending':i===3?'disabled':'active',revision:4,createdAt:now,disabledAt:i===3?now:null}));
window.mode='unknown';window.writes=[];window.reads=[];window.revoke=invalidateCurrentStudioAuthority;window.setDirectoryRevision=revision=>{accounts[1].revision=revision;};
function result(body,target,action){return {account:{...target,revision:target.revision+1,...(action==='display-name'?{displayName:body.displayName}:{}),...(action==='role'?{role:body.role}:{})},operation:{operationId:body.operationId,actorId:id,targetId:target.id,action,status:'completed',errorCode:null,createdAt:now},...((action==='create'||action.startsWith('issue-'))?{passwordSetup:{tokenId:target.id,purpose:'setup',url:location.origin+'/studio/set-password#synthetic-private-link',expiresAt:'2030-01-01T00:00:00.000Z'}}:{})}}
window.fetch=async(raw,init={})=>{
 const url=new URL(raw,location.href),method=init.method||'GET',path=url.pathname;
 if(method==='GET')window.reads.push(url.pathname+url.search);
 if(path==='/api/studio/accounts'&&method==='GET'){
  const q=url.searchParams.get('q')||'',role=url.searchParams.get('role'),status=url.searchParams.get('status'),offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
  const filtered=accounts.filter(a=>(a.displayName.includes(q)||a.loginName.includes(q))&&(!role||role==='all'||a.role===role)&&(!status||status==='all'||a.status===status));
  return Response.json({items:filtered.slice(offset,offset+limit),offset,limit,hasMore:offset+limit<filtered.length,total:filtered.length,summary:{total:30,active:27,pending:2,disabled:1},snapshotAt:now});
 }
 if(path.includes('/accounts/operations/')){const w=window.writes[0];return Response.json({status:'found',operation:result(w.body,w.target,w.action).operation});}
 if(path.endsWith('/auth/session'))return Response.json(session);
 if(method==='POST'||method==='PATCH'){
  const body=JSON.parse(init.body),target=method==='POST'&&path==='/api/studio/accounts'?{...accounts[2],displayName:body.displayName,loginName:body.loginName,role:body.role}:accounts.find(a=>path.includes(a.id));
  const action=body.action||(path.endsWith('password-token')?(body.purpose==='setup'?'issue-setup':'issue-reset'):path.endsWith('revoke-sessions')?'revoke-sessions':'create');
  window.writes.push({path,method,body,target,action});
  if(window.mode==='held')return new Promise(resolve=>window.releaseWrite=()=>resolve(Response.json({code:'WRITE_OUTCOME_UNKNOWN'},{status:503})));
  if(window.mode==='success')return Response.json(result(body,target,action));
  if(window.mode==='last-admin')return Response.json({code:'LAST_ACTIVE_ADMIN'},{status:409});
  return Response.json({code:'WRITE_OUTCOME_UNKNOWN'},{status:503});
 }
 throw Error('UNEXPECTED_SYNTHETIC_PATH');
};
createRoot(document.getElementById('root')).render(<StudioShell authenticated identity={session.operator} session={session}><AccountsPage session={session}/><a href='/outside' id='leave-test'>离开页面</a></StudioShell>);
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
try {
  async function open(scenario, fragment = "") {
    if (context) await context.close();
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
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
    await page.goto(origin + "/studio/accounts?case=" + scenario + fragment);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
  }
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
  async function run(name, body) {
    if (only && !only.split(",").includes(name)) return;
    await open(name);
    await expect(page.locator('[data-account-stat="total"]')).toHaveText("30");
    await body();
    results.push(name);
    await writeFile(
      path.join(out, "results.json"),
      JSON.stringify({ results, errors }, null, 2),
    );
  }
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  async function person(name = "合成运营") {
    await button("查看与管理 " + name).click();
  }
  async function create(fill = true) {
    await button("开通人员").click();
    if (fill) {
      await page.getByLabel("显示名称", { exact: true }).fill("合成新成员");
      await page.getByLabel("登录账号（创建后不可修改）").fill("synthetic.new");
    }
  }
  async function noOverflow() {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const dialog = page.locator("dialog:modal");
    if (await dialog.count())
      expect(await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(
        true,
      );
  }
  await run("server-list", async () => {
    await expect(page.getByRole("table", { name: "人员账号" })).toBeVisible();
    await expect(
      page.getByText("共 26 位人员，显示 1–25 位", { exact: true }),
    ).toBeVisible();
    await button("下一页").click();
    await expect(
      page.getByText("共 26 位人员，显示 26–26 位", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("姓名或登录账号").fill("合成待开通");
    await page.getByLabel("角色", { exact: true }).selectOption("operator");
    await page.getByLabel("账号状态", { exact: true }).selectOption("pending");
    await button("应用筛选").click();
    await expect(
      page.getByText("共 1 位人员，显示 1–1 位", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-account-stat="total"]')).toHaveText("30");
    const count = await page.evaluate(() => window.reads.length);
    await button("应用筛选").click();
    await expect
      .poll(() => page.evaluate(() => window.reads.length))
      .toBe(count + 1);
    expect(await page.evaluate(() => window.reads.at(-1))).toContain(
      "role=operator&status=pending&offset=0&limit=25",
    );
    await button("重置").click();
    await expect(
      page.getByText("共 26 位人员，显示 1–25 位", { exact: true }),
    ).toBeVisible();
  });
  await run("layout-actions", async () => {
    for (const width of [1440, 320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverflow();
      const tabs = page.getByRole("navigation", {
        name: "账号工作区",
        exact: true,
      });
      await expect(tabs.getByRole("link")).toHaveCount(3);
      await expect(tabs.locator('a[aria-current="page"]')).toHaveAttribute(
        "href",
        "/studio/accounts",
      );
      await expect(
        page.getByRole("heading", { name: "人员账号", exact: true }),
      ).toBeVisible();
      if (width < 731) {
        const geometry = await page.evaluate(() => {
          const box = (id) =>
            document.getElementById(id).getBoundingClientRect();
          const search = box("account-search"),
            role = box("account-filter-role"),
            status = box("account-status");
          const apply = [...document.querySelectorAll("button")]
            .find((n) => n.textContent === "应用筛选")
            .getBoundingClientRect();
          const stats = [
            ...document.querySelector('[aria-label="全部账号概览"]').children,
          ].map((n) => n.getBoundingClientRect());
          return {
            row: role.y === status.y,
            search: Math.abs(search.width - apply.width) < 1,
            apply: apply.y > role.bottom,
            stats:
              stats[0].y === stats[1].y &&
              stats[2].y === stats[3].y &&
              stats[2].y > stats[0].y,
          };
        });
        expect(geometry).toEqual({
          row: true,
          search: true,
          apply: true,
          stats: true,
        });
      }
      if (width === 1440 || width === 390)
        await page.screenshot({ path: path.join(out, `people-${width}.png`) });
      if (width === 390) {
        await page
          .getByRole("article")
          .first()
          .screenshot({ path: path.join(out, "people-card-390.png") });
        await page
          .getByRole("navigation", { name: "账号分页", exact: true })
          .screenshot({ path: path.join(out, "people-pager-390.png") });
      }
      await person();
      await expect(page.locator("dialog:modal")).toHaveCount(1);
      await expect
        .poll(() =>
          page
            .locator("dialog:modal")
            .evaluate((n) => Math.round(n.getBoundingClientRect().width)),
        )
        .toBe(width === 1440 ? 470 : width);
      await noOverflow();
      expect(
        await page
          .locator("dialog:modal")
          .evaluate((n) =>
            [...n.querySelectorAll("button,input,select")]
              .filter((e) => e.getClientRects().length)
              .every(
                (e) =>
                  e.getBoundingClientRect().height >= 44 &&
                  parseFloat(getComputedStyle(e).fontSize) >= 16,
              ),
          ),
      ).toBe(true);
      if (width === 1440 || width === 390)
        await page.screenshot({ path: path.join(out, `drawer-${width}.png`) });
      await button("调整角色").click();
      if (width === 1440)
        await page.screenshot({ path: path.join(out, "inline-role-1440.png") });
      await expect(page.locator("dialog:modal")).toHaveCount(1);
      await button("取消返回详情").click();
      await button("关闭").click();
      await create(false);
      await noOverflow();
      await expect
        .poll(() =>
          page
            .locator("dialog:modal")
            .evaluate((n) => Math.round(n.getBoundingClientRect().width)),
        )
        .toBe(width === 1440 ? 640 : width - 36);
      if (width === 1440 || width === 390)
        await page.screenshot({ path: path.join(out, `create-${width}.png`) });
      await button("取消").click();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await person("合成停用");
    await expect(button("恢复账号")).toBeVisible();
    await expect(button("停用账号")).toHaveCount(0);
    await expect(button("生成密码重置入口")).toHaveCount(0);
    await expect(button("撤销全部登录")).toHaveCount(0);
    await button("关闭").click();
    await person("合成待开通");
    await expect(button("生成设置入口")).toBeVisible();
    await expect(button("生成密码重置入口")).toHaveCount(0);
    await expect(button("撤销全部登录")).toHaveCount(0);
  });
  await run("inline-action-replacement", async () => {
    await person();
    const drawer = page.locator("dialog:modal");
    await expect(
      drawer.getByRole("region", { name: "账号管理" }),
    ).toBeVisible();
    await button("调整角色").click();
    const form = page.getByRole("form", { name: "调整角色", exact: true });
    await expect(form).toBeVisible();
    await expect(
      drawer.getByRole("heading", { name: "调整角色", exact: true }),
    ).toBeVisible();
    await expect(button("编辑显示名称")).toHaveCount(0);
    await expect(button("生成密码重置入口")).toHaveCount(0);
    await expect(page.locator("dialog:modal")).toHaveCount(1);
    await form.getByLabel("角色", { exact: true }).selectOption("read-only");
    const input = await form
      .getByLabel("角色", { exact: true })
      .elementHandle();
    await button("关闭调整角色").click();
    await button("应用筛选").click();
    await expect(
      page.getByText("共 26 位人员，显示 1–25 位", { exact: true }),
    ).toBeVisible();
    await button("继续未提交账号任务").click();
    expect(
      await form
        .getByLabel("角色", { exact: true })
        .evaluate((node, original) => node === original, input),
    ).toBe(true);
    await expect(form.getByLabel("角色", { exact: true })).toHaveValue(
      "read-only",
    );
    await page.screenshot({
      path: path.join(out, "inline-action-replacement-1440.png"),
    });
    page.once("dialog", (dialog) => dialog.accept());
    await button("取消返回详情").click();
    await expect(
      page.getByRole("form", { name: "调整角色", exact: true }),
    ).toHaveCount(0);
    await expect(button("编辑显示名称")).toBeVisible();
    await button("生成密码重置入口").click();
    await expect(
      page.getByRole("form", { name: "生成密码重置入口", exact: true }),
    ).toContainText("管理员手动保存并私下交付本人");
    await button("取消返回详情").click();
    await expect(button("编辑显示名称")).toBeVisible();
    await button("关闭").click();
    await person("合成待开通");
    await button("生成设置入口").click();
    await expect(
      page.getByRole("form", { name: "生成设置入口", exact: true }),
    ).toContainText("管理员手动保存并私下交付本人");
    await button("取消返回详情").click();
    await expect(button("生成设置入口")).toBeVisible();
    expect(await page.evaluate(() => window.writes.length)).toBe(0);
  });
  await run("empty-dirty-retain", async () => {
    await create(false);
    await button("取消").click();
    await expect(button("继续未提交账号任务")).toHaveCount(0);
    await expect(page.locator('form[aria-label="开通账号"]')).toHaveCount(0);
    await create();
    const input = await page
      .getByLabel("显示名称", { exact: true })
      .elementHandle();
    await button("收起").click();
    await page.getByLabel("姓名或登录账号").fill("合成待开通");
    await button("应用筛选").click();
    await expect(
      page.getByText("共 1 位人员，显示 1–1 位", { exact: true }),
    ).toBeVisible();
    await button("继续未提交账号任务").click();
    expect(
      await page
        .getByLabel("显示名称", { exact: true })
        .evaluate((n, old) => n === old, input),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await button("继续未提交账号任务").click();
    await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue(
      "合成新成员",
    );
    page.once("dialog", (d) => d.dismiss());
    await button("放弃输入").click();
    await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue(
      "合成新成员",
    );
    page.once("dialog", (d) => d.accept());
    await button("放弃输入").click();
    await expect(button("继续未提交账号任务")).toHaveCount(0);
    expect(await page.evaluate(() => window.writes.length)).toBe(0);
  });
  await run("busy-unknown-original", async () => {
    await person();
    await button("编辑显示名称").click();
    await page.getByLabel("显示名称", { exact: true }).fill("合成编辑");
    const input = await page
      .getByLabel("显示名称", { exact: true })
      .elementHandle();
    await page.evaluate(() => (window.mode = "held"));
    await button("确认编辑显示名称").click();
    await expect
      .poll(() => page.evaluate(() => Boolean(window.releaseWrite)))
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog:modal")).toBeVisible();
    await expect(button("关闭编辑显示名称")).toBeDisabled();
    await page.evaluate(() => window.releaseWrite());
    await expect(button("核实原操作")).toBeEnabled();
    await button("收起").click();
    await button("应用筛选").click();
    await expect(button("查看与管理 合成管理员")).toBeVisible();
    await person("合成管理员");
    await expect(page.locator("dialog:modal")).toContainText("合成运营");
    expect(
      await page
        .getByLabel("显示名称", { exact: true })
        .evaluate((n, old) => n === old, input),
    ).toBe(true);
    await expect(page.getByLabel("显示名称", { exact: true })).toBeDisabled();
    await button("核实原操作").click();
    await expect(
      page.getByText("处理结果：已完成", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.writes.length)).toBe(1);
    const state = await page.evaluate(() => ({
      write: window.writes[0],
      reads: window.reads,
    }));
    expect(state.write.body.expectedRevision).toBe(4);
    expect(state.reads.at(-1)).toBe(
      "/api/studio/accounts/operations/" + state.write.body.operationId,
    );
    await button("明确结束本次记录").click();
    await expect(page.locator("dialog:modal")).toHaveCount(0);
  });
  await run("unknown-finish-fresh-revision", async () => {
    await person();
    await button("编辑显示名称").click();
    await page.getByLabel("显示名称", { exact: true }).fill("合成第一次修改");
    await button("确认编辑显示名称").click();
    await expect(button("核实原操作")).toBeEnabled();
    const original = await page.evaluate(() => window.writes[0].body);
    expect(original.expectedRevision).toBe(4);
    await page.evaluate(() => window.setDirectoryRevision(9));
    await button("核实原操作").click();
    await expect(
      page.getByText("处理结果：已完成", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.writes.length)).toBe(1);
    await button("明确结束本次记录").click();
    await expect(page.locator("dialog:modal")).toHaveCount(0);
    await expect(button("继续未提交账号任务")).toHaveCount(0);
    await expect(button("查看与管理 合成运营")).toBeVisible();
    await person();
    await button("编辑显示名称").click();
    await page.getByLabel("显示名称", { exact: true }).fill("合成第二次修改");
    await page.evaluate(() => (window.mode = "success"));
    await button("确认编辑显示名称").click();
    await expect(button("明确结束本次记录")).toBeEnabled();
    const writes = await page.evaluate(() => window.writes);
    expect(writes).toHaveLength(2);
    expect(writes[1].body.expectedRevision).toBe(9);
    expect(writes[1].body.operationId).not.toBe(original.operationId);
    expect(writes[1].path).toBe(writes[0].path);
    await button("明确结束本次记录").click();
    await expect(page.locator("dialog:modal")).toBeVisible();
    await expect(button("编辑显示名称")).toBeEnabled();
  });
  await run("one-off-link", async () => {
    await page.evaluate(() => (window.mode = "success"));
    await create();
    await button("确认开通账号").click();
    await expect(page.getByLabel("密码设置链接")).toBeVisible();
    await expect(page.getByLabel("密码设置链接")).toHaveAttribute(
      "type",
      "password",
    );
    await expect(button("关闭一次性设置入口")).toBeDisabled();
    await expect(button("收起")).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.mouse.click(10, 10);
    await expect(page.locator("dialog:modal")).toBeVisible();
    await expect(button("明确结束本次记录")).toBeDisabled();
    expect(
      await page.evaluate(() =>
        JSON.stringify({ ...sessionStorage, ...localStorage }).includes(
          "synthetic-private-link",
        ),
      ),
    ).toBe(false);
    let blocked = false;
    page.once("dialog", async (d) => {
      blocked = d.type() === "alert";
      await d.accept();
    });
    await page.locator("#leave-test").evaluate((n) => n.click());
    expect(blocked).toBe(true);
    await page.getByLabel("我已妥善保存或发送设置链接").check();
    await button("明确结束本次记录").click();
    await expect(page.locator("dialog:modal")).toHaveCount(0);
    expect(await page.evaluate(() => window.writes.length)).toBe(1);
  });
  await run("unknown-create-reissue", async () => {
    await create();
    await button("确认开通账号").click();
    await expect(button("核实原操作")).toBeEnabled();
    await button("核实原操作").click();
    await expect(
      page.getByText(
        "原操作已完成，但本页无法再次显示设置链接。结束本次记录后，可重新发送；以前的设置链接将失效。",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByLabel("密码设置链接")).toHaveCount(0);
    expect(await page.evaluate(() => window.writes.length)).toBe(1);
    await button("明确结束本次记录").click();
    await person("合成待开通");
    await button("生成设置入口").click();
    await page.getByLabel("我已了解影响，确认生成设置入口").check();
    await page.evaluate(() => (window.mode = "success"));
    await button("确认生成设置入口").click();
    await expect(page.getByLabel("密码设置链接")).toBeVisible();
    expect(await page.evaluate(() => window.writes.length)).toBe(2);
    expect(
      await page.evaluate(() => window.writes[1].body.expectedRevision),
    ).toBe(4);
  });
  await run("inline-success-reject", async () => {
    await page.evaluate(() => (window.mode = "success"));
    await person();
    await button("编辑显示名称").click();
    await page.getByLabel("显示名称", { exact: true }).fill("合成新名称");
    await button("确认编辑显示名称").click();
    await expect(page.locator("dialog:modal")).toContainText("合成新名称");
    await button("明确结束本次记录").click();
    await button("调整角色").click();
    await page
      .locator("dialog:modal")
      .getByLabel("角色", { exact: true })
      .selectOption("read-only");
    await page.getByLabel("我已了解影响，确认调整角色").check();
    await button("确认调整角色").click();
    expect(
      await page.evaluate(() => window.writes.at(-1).body.expectedRevision),
    ).toBe(5);
    await button("明确结束本次记录").click();
    await button("关闭").click();
    await person("合成管理员");
    await button("停用账号").click();
    await page.getByLabel("我已了解影响，确认停用账号").check();
    await page.evaluate(() => (window.mode = "last-admin"));
    await button("确认停用账号").click();
    await expect(button("明确结束本次记录")).toBeEnabled();
    await expect(page.locator("dialog:modal")).toContainText(
      "不能停用或降权最后一名可登录管理员",
    );
    expect(await page.evaluate(() => window.writes.length)).toBe(3);
  });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ out, results, errors }));
} catch (error) {
  await writeFile(path.join(out, "failure.txt"), String(error.stack));
  throw error;
} finally {
  await browser.close();
}
