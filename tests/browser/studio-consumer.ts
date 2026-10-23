import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import {
  internalPlayFixture,
  testMoment,
  testUuid,
} from "@/features/product/internal-play/contracts.test-support";
import {
  createInternalPlayBindingSchema,
  internalPlayBindingSha256,
  internalPlaySnapshotSha256,
} from "@/features/product/internal-play/contracts";
import {
  issueAccessKeyBindingSchema,
  issueAccessKeyBindingSha256,
  voidUnusedAccessKeyBindingSchema,
  voidUnusedAccessKeyBindingSha256,
  type AccessKeyDetail,
} from "@/features/fulfillment/access/contracts";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY } from "@/features/product/internal-play/implementation-catalog";
import { digestConsumerToken } from "@/lib/consumer-contract/v1/credentials";
/** Synthetic in-memory Studio HTTP + actual UI, no DB/real permission/3100/OS clipboard. */
const out = path.resolve(".cache/p4-studio-consumer", String(Date.now()));
await mkdir(out, { recursive: true, mode: 0o700 });
const f = await internalPlayFixture(),
  productId = f.content.product.productId,
  issuerId = testUuid(7);
const session = {
  operator: { id: issuerId, label: "Synthetic operator", role: "operator" },
  csrfToken: "A".repeat(43),
  idleExpiresAt: "2026-10-18T08:00:00.000Z",
  absoluteExpiresAt: "2026-10-18T08:00:00.000Z",
};
const parent = f.parent,
  versions = [
    {
      id: parent.version.id,
      productId,
      slot: parent.version.slot,
      target: parent.snapshot.target,
      reviewId: parent.snapshot.reviewId,
      reviewSha256: parent.snapshot.reviewSha256,
      snapshotSha256: parent.version.snapshotSha256,
      renderer: parent.snapshot.renderer,
      rendererCapability: parent.snapshot.rendererCapability,
      engine: parent.snapshot.engine,
      purpose: parent.snapshot.purpose,
      publicationApproved: parent.snapshot.publicationApproved,
      createdAt: parent.version.createdAt,
      createdBy: parent.version.createdBy,
    },
  ];
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
const navigationOnly = process.argv.slice(2).includes("--navigation-only");
await fromTsx("esbuild").build({
  entryPoints: [path.resolve("tests/browser/studio-consumer.client.tsx")],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  logLevel: "silent",
});
// Keep the original domain-only capture unchanged. This second entry uses the
// actual shell/pathname context from the independent review counterexample.
await fromTsx("esbuild").build({
  stdin: {
    contents: `
      import { createRoot } from "react-dom/client";
      import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
      import { StudioShell } from "@/features/studio/shell";
      import { StudioConsumerAccessPageV1 } from "@/features/studio/consumer-access/page";
      import { subscribeStudioAuthorityInvalidation } from "@/features/studio/authority-events";
      const input = JSON.parse(document.getElementById("fixture").textContent);
      let invalidations = 0;
      subscribeStudioAuthorityInvalidation(() => { invalidations++; });
      window.readNavigationInvalidations = () => invalidations;
      createRoot(document.getElementById("root")).render(
        <PathnameContext.Provider value={"/studio/products/" + input.scope.productId + "/consumer-access"}>
          <StudioShell authenticated><StudioConsumerAccessPageV1 {...input} /></StudioShell>
        </PathnameContext.Provider>);
    `,
    resolveDir: process.cwd(),
    loader: "tsx",
    sourcefile: "studio-shell-consumer-probe.tsx",
  },
  outfile: path.join(out, "shell-probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  logLevel: "silent",
});
const files = new Map([
  [
    "/probe.js",
    {
      body: await readFile(path.join(out, "probe.js")),
      type: "text/javascript",
    },
  ],
  [
    "/probe.css",
    { body: await readFile(path.join(out, "probe.css")), type: "text/css" },
  ],
]);
for (const [name, type] of [
  ["shell-probe.js", "text/javascript"],
  ["shell-probe.css", "text/css"],
])
  files.set(`/${name}`, {
    body: await readFile(path.join(out, name!)),
    type: type!,
  });
let origin = "",
  mode = "normal",
  play = f.play.play,
  hasPlay = false;
const keys: AccessKeyDetail[] = [];
const issueBindings: string[] = [];
let rawSeenByApi = false,
  posts = 0;
let holdAuth = false,
  releaseAuth: (() => void) | undefined,
  notifyAuth: (() => void) | undefined;
let authReached = Promise.resolve();
let holdPlay = false,
  releasePlay: (() => void) | undefined,
  notifyPlay: (() => void) | undefined,
  sentPlays = 0;
let playReached = Promise.resolve();
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const send = (v: unknown, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    });
    res.end(JSON.stringify(v));
  };
  try {
    if (url.pathname === "/api/studio/auth/session") {
      if (holdAuth) {
        holdAuth = false;
        notifyAuth?.();
        await new Promise<void>((resolve) => {
          releaseAuth = resolve;
        });
      }
      send({
        ...session,
        operator: {
          ...session.operator,
          role: mode === "readonly" ? "read-only" : "operator",
          id: mode === "other-issuer" ? testUuid(100) : issuerId,
        },
      });
      return;
    }
    if (req.method === "POST") {
      posts++;
      const chunks: Buffer[] = [];
      for await (const part of req) chunks.push(Buffer.from(part));
      const text = Buffer.concat(chunks).toString("utf8");
      rawSeenByApi ||= /qfk_p4_|qfg_p4_/.test(text);
      const body = JSON.parse(text);
      if (url.pathname.endsWith("/play-versions")) {
        const binding = createInternalPlayBindingSchema.parse(body),
          snapshot = { ...f.play.snapshot, renderer: binding.renderer };
        play = {
          ...f.play.play,
          binding,
          bindingSha256: await internalPlayBindingSha256(binding),
          snapshotSha256: await internalPlaySnapshotSha256(snapshot),
        };
        hasPlay = true;
        if (holdPlay) {
          holdPlay = false;
          notifyPlay?.();
          await new Promise<void>((resolve) => {
            releasePlay = resolve;
          });
        }
        send({ created: true, play }, 201);
        sentPlays++;
        return;
      }
      if (url.pathname.endsWith("/access-keys")) {
        const binding = issueAccessKeyBindingSchema.parse(body);
        issueBindings.push(await issueAccessKeyBindingSha256(binding));
        let key = keys.find((k) => k.issue.binding.keyId === binding.keyId);
        if (!key) {
          key = {
            issue: {
              schemaVersion: "quizforge.access-key-issue-receipt.v1",
              binding,
              bindingSha256: await issueAccessKeyBindingSha256(binding),
              issuedBy: issuerId,
              issuedAt: testMoment,
              expiresAt: new Date(
                Date.parse(testMoment) + binding.validForSeconds * 1000,
              ).toISOString(),
            },
            current: {
              observedAt: testMoment,
              claim: null,
              completion: null,
              voidReceipt: null,
            },
          };
          keys.unshift(key);
        }
        if (mode === "unknown") {
          send(
            {
              schemaVersion: "quizforge.consumer-error.v1",
              code: "OUTCOME_UNKNOWN",
              requestId: testUuid(101),
            },
            503,
          );
          return;
        }
        send({ created: true, key }, 201);
        return;
      }
      if (url.pathname.endsWith("/access-key-applications/resolve")) {
        const binding = issueAccessKeyBindingSchema.parse(body),
          key = keys.find((k) => k.issue.binding.keyId === binding.keyId);
        send({
          schemaVersion: "quizforge.access-key-issue-resolution.v1",
          kind: key ? "applied" : "unresolved",
          binding,
          bindingSha256: await issueAccessKeyBindingSha256(binding),
          ...(key ? { key } : {}),
        });
        return;
      }
      if (url.pathname.endsWith("/void")) {
        const binding = voidUnusedAccessKeyBindingSchema.parse(body),
          key = keys.find((k) => k.issue.binding.keyId === binding.keyId)!;
        if (mode === "claim-before-void")
          key.current.claim = {
            sessionId: testUuid(102),
            claimedAt: testMoment,
          };
        if (!key.current.claim)
          key.current.voidReceipt = {
            schemaVersion: "quizforge.access-key-void-unused-receipt.v1",
            binding,
            bindingSha256: await voidUnusedAccessKeyBindingSha256(binding),
            revokedAt: testMoment,
            voidedBy: issuerId,
          };
        send({
          schemaVersion: "quizforge.access-key-void-resolution.v1",
          kind: key.current.claim ? "claimed" : "applied",
          binding,
          bindingSha256: await voidUnusedAccessKeyBindingSha256(binding),
          key,
        });
        return;
      }
      send({});
      return;
    }
    if (url.pathname.endsWith("/internal-versions")) {
      send({ ok: true, value: { productId, versions } });
      return;
    }
    if (url.pathname.endsWith("/play-versions")) {
      send({ productId, versions: hasPlay ? [play] : [] });
      return;
    }
    if (url.pathname.endsWith("/access-keys")) {
      send({
        productId,
        keys: [...keys].sort((a, b) =>
          b.issue.binding.keyId.localeCompare(a.issue.binding.keyId),
        ),
        nextCursor: null,
      });
      return;
    }
    if (url.pathname.includes("/access-keys/")) {
      send(keys.find((k) => url.pathname.endsWith(k.issue.binding.keyId)));
      return;
    }
    const file = files.get(url.pathname);
    if (file) {
      res.writeHead(200, { "content-type": file.type });
      res.end(file.body);
      return;
    }
    const data = {
      scope: { origin, instanceId: "a".repeat(32), issuerId, productId },
      renderer: CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1,
    };
    const probe =
      url.pathname === "/studio-navigation-probe" ? "shell-probe" : "probe";
    res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
    res.end(
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${probe}.css"><style>*{box-sizing:border-box}body{margin:0;font:16px/1.75 system-ui;background:#e9eee9;padding:12px}.synthetic{padding:12px;background:#fff4ce}</style><p class="synthetic">合成 Studio HTTP／实际 UI 验证 · 无数据库、实际运营权限或系统剪贴板</p><div id="root"></div><script id="fixture" type="application/json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script src="/${probe}.js"></script></html>`,
    );
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
origin = `http://127.0.0.1:${address.port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [],
  shots: string[] = [];
const observations: unknown[] = [];
async function shot(page: Page, name: string) {
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    rawInDom: /qfk_p4_|qfg_p4_/.test(document.documentElement.outerHTML),
    smallTargets: [
      ...document.querySelectorAll("button,a,select,input"),
    ].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
    }).length,
  }));
  expect(metrics).toEqual({
    overflow: false,
    rawInDom: false,
    smallTargets: 0,
  });
  observations.push({ name, ...metrics });
  await page.screenshot({
    path: path.join(out, name + ".png"),
    fullPage: true,
  });
  shots.push(name + ".png");
}
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Error("NAVIGATION_PROBE_DEADLINE")),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function navigationInvalidations(page: Page) {
  return page.evaluate(() => {
    const read = (
      window as Window & { readNavigationInvalidations?: () => number }
    ).readNavigationInvalidations;
    if (!read) throw Error("NAVIGATION_OBSERVER_MISSING");
    return read();
  });
}
async function pendingDigest(page: Page) {
  return page.evaluate(async () => {
    const values = Object.keys(sessionStorage)
      .sort()
      .map((key) => [key, sessionStorage.getItem(key)]);
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(values)),
    );
    return {
      entries: values.length,
      sha256: [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    };
  });
}
async function activateGlobal(page: Page, kind: "pointer" | "keyboard") {
  const nav = page.getByRole("navigation", {
    name: "Studio 导航",
    exact: true,
  });
  if (!(await nav.isVisible()))
    await page.getByText("Studio 导航", { exact: true }).click();
  const link = nav.getByRole("link", { name: "工作区", exact: true });
  // Only prevent destination navigation, preserving the real React link events
  // and mounted consumer controller from the independent review counterexample.
  await link.evaluate((anchor) =>
    anchor.addEventListener("click", (event) => event.preventDefault(), {
      capture: true,
      once: true,
    }),
  );
  if (kind === "keyboard") {
    await link.focus();
    await link.press("Enter");
  } else await link.click();
  expect(page.url()).toBe(origin + "/studio-navigation-probe");
  await expect(
    page.getByRole("heading", { name: "请重新验证运营身份", exact: true }),
  ).toBeVisible();
}
async function globalNavigationRegression(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
) {
  for (const kind of ["pointer", "keyboard"] as const) {
    const context = await browser.newContext({
      viewport: { width: kind === "pointer" ? 1440 : 390, height: 900 },
    });
    try {
      const page = await context.newPage(),
        other = await context.newPage();
      for (const target of [page, other]) {
        target.on("pageerror", (error) =>
          errors.push(
            error.message.replace(/qf[kg]_p4_[A-Za-z0-9_-]+/g, "[redacted]"),
          ),
        );
        await target.goto(origin + "/studio-navigation-probe");
        await expect(
          target.getByRole("combobox", { name: "已封存的父版本", exact: true }),
        ).toBeEnabled();
      }
      if (kind === "keyboard") {
        const toggle = page.getByText("Studio 导航", { exact: true });
        await toggle.click();
        await toggle.click();
        await expect(
          page.getByRole("combobox", { name: "已封存的父版本", exact: true }),
        ).toBeEnabled();
        expect(await navigationInvalidations(page)).toBe(0);
      }
      const nav = page.getByRole("navigation", {
        name: "Studio 导航",
        exact: true,
      });
      if (!(await nav.isVisible()))
        await page.getByText("Studio 导航", { exact: true }).click();
      const gap = await nav.evaluate((element) => {
        const links = element.querySelectorAll("a"),
          first = links[0]!.getBoundingClientRect(),
          second = links[1]!.getBoundingClientRect();
        const point = { x: first.left + 4, y: (first.bottom + second.top) / 2 };
        const hit = document.elementFromPoint(point.x, point.y);
        if (!hit || !element.contains(hit) || hit.closest("a[href]"))
          throw Error("GLOBAL_NAVIGATION_GAP_REQUIRED");
        return point;
      });
      await page.mouse.click(gap.x, gap.y);
      expect(await navigationInvalidations(page)).toBe(0);
      const before = posts;
      await other.evaluate(() => {
        const channel = new BroadcastChannel(
          "quizforge.navigation-test-barrier.v1",
        );
        channel.onmessage = () => channel.postMessage("ack");
      });
      await activateGlobal(page, kind);
      // A real same-origin cross-tab roundtrip drains queued channel delivery;
      // no sleep or forged visibility event substitutes for the other live tab.
      await page.evaluate(
        () =>
          new Promise<void>((resolve, reject) => {
            const channel = new BroadcastChannel(
              "quizforge.navigation-test-barrier.v1",
            );
            const timer = setTimeout(() => {
              channel.close();
              reject(Error("CHANNEL_BARRIER_DEADLINE"));
            }, 2000);
            channel.onmessage = () => {
              clearTimeout(timer);
              channel.close();
              resolve();
            };
            channel.postMessage("ping");
          }),
      );
      expect(await navigationInvalidations(page)).toBe(1);
      expect(await navigationInvalidations(other)).toBe(0);
      await expect(
        other.getByRole("combobox", { name: "已封存的父版本", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "创建消费者内测版本", exact: true }),
      ).toHaveCount(0);
      expect(posts).toBe(before);
      observations.push({
        name: `global-${kind}`,
        gapPreservesAuthority: true,
        ...(kind === "keyboard" ? { menuPreservesAuthority: true } : {}),
        localRevoked: true,
        otherTabRevoked: false,
        additionalPosts: 0,
      });
    } finally {
      await context.close();
    }
  }
  // Pause before the write's fresh authorization resolves, then navigate away.
  // The old task cannot send a POST when that real HTTP response is released.
  for (const stage of ["authorization", "response"] as const) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    page.on("pageerror", (error) =>
      errors.push(
        error.message.replace(/qf[kg]_p4_[A-Za-z0-9_-]+/g, "[redacted]"),
      ),
    );
    try {
      await page.goto(origin + "/studio-navigation-probe");
      const selector = page.getByRole("combobox", {
        name: "已封存的父版本",
        exact: true,
      });
      await expect(selector).toBeEnabled();
      await selector.selectOption(parent.version.id);
      const before = posts,
        beforeSent = sentPlays;
      if (stage === "authorization") {
        holdAuth = true;
        authReached = new Promise((resolve) => {
          notifyAuth = resolve;
        });
      } else {
        holdPlay = true;
        playReached = new Promise((resolve) => {
          notifyPlay = resolve;
        });
      }
      await page
        .getByRole("button", { name: "创建消费者内测版本", exact: true })
        .click();
      await bounded(stage === "authorization" ? authReached : playReached);
      const pending = await pendingDigest(page);
      if (stage === "response") expect(pending.entries).toBeGreaterThan(0);
      const atNavigation = posts;
      await activateGlobal(page, "pointer");
      if (stage === "authorization") {
        holdAuth = false;
        releaseAuth?.();
      } else {
        holdPlay = false;
        releasePlay?.();
        await expect.poll(() => sentPlays).toBe(beforeSent + 1);
      }
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(
        page.getByRole("heading", { name: "请重新验证运营身份", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "原内测版本已创建", exact: true }),
      ).toHaveCount(0);
      expect(posts - before).toBe(stage === "authorization" ? 0 : 1);
      expect(posts).toBe(atNavigation);
      expect(await pendingDigest(page)).toEqual(pending);
      observations.push({
        name: `global-pending-${stage}`,
        lateTaskRejected: true,
        postsIssuedBeforeNavigation: atNavigation - before,
        postsAfterNavigation: posts - atNavigation,
        originalPendingUnchanged: true,
      });
    } finally {
      holdAuth = holdPlay = false;
      releaseAuth?.();
      releasePlay?.();
      await page.close();
    }
  }
}
async function runExistingConsumerScenarios(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
) {
  for (const width of [320, 375, 390, 430]) {
    const p = await browser.newPage({ viewport: { width, height: 900 } });
    p.on(
      "pageerror",
      (e) => (
        errors.push(
          e.message.replace(/qf[kg]_p4_[A-Za-z0-9_-]+/g, "[redacted]"),
        ),
        console.error(
          e.message.replace(/qf[kg]_p4_[A-Za-z0-9_-]+/g, "[redacted]"),
        )
      ),
    );
    await p.goto(origin + "/studio-probe");
    await expect(
      p.getByRole("button", { name: "创建消费者内测版本", exact: true }),
    ).toBeVisible();
    await expect(p.getByText("当前尚无可选择的已封存父版本。")).toHaveCount(0);
    await expect(
      p.getByRole("combobox", { name: "已封存的父版本" }),
    ).toBeEnabled();
    await shot(p, `ready-${width}`);
    if (width === 320) {
      const workflow = p.getByRole("navigation", {
        name: "商品操作流程",
        exact: true,
      });
      await workflow.scrollIntoViewIfNeeded();
      const gap = await workflow.evaluate((nav) => {
        const links = [...nav.querySelectorAll("a")];
        const first = links[0]!.getBoundingClientRect(),
          second = links[1]!.getBoundingClientRect();
        const point = {
          x: (first.right + second.left) / 2,
          y: Math.max(first.top, second.top) + 4,
        };
        const hit = document.elementFromPoint(point.x, point.y);
        if (!hit || !nav.contains(hit) || hit.closest("a[href]"))
          throw Error("STUDIO_WORKFLOW_TEST_GAP_REQUIRED");
        return point;
      });
      const beforeNavigationPosts = posts;
      await p.mouse.click(gap.x, gap.y);
      await expect(
        p.getByRole("combobox", { name: "已封存的父版本" }),
      ).toBeEnabled();
      await expect(
        p.getByRole("heading", { name: "请重新验证运营身份", exact: true }),
      ).toHaveCount(0);
      expect(posts).toBe(beforeNavigationPosts);
      // Prevent only destination navigation. The actual link activation still
      // reaches the React capture handler and must immediately revoke authority.
      const link = workflow.getByRole("link", {
        name: "商品概览",
        exact: true,
      });
      await link.evaluate((anchor) => {
        anchor.addEventListener("click", (event) => event.preventDefault(), {
          capture: true,
          once: true,
        });
      });
      await link.focus();
      await link.press("Enter");
      await expect(
        p.getByRole("heading", { name: "请重新验证运营身份", exact: true }),
      ).toBeVisible();
      await p.reload();
      await expect(
        p.getByRole("combobox", { name: "已封存的父版本" }),
      ).toBeEnabled();
      const pointerLink = p
        .getByRole("navigation", { name: "商品操作流程", exact: true })
        .getByRole("link", { name: "商品概览", exact: true });
      await pointerLink.evaluate((anchor) => {
        anchor.addEventListener("click", (event) => event.preventDefault(), {
          capture: true,
          once: true,
        });
      });
      await pointerLink.click();
      await expect(
        p.getByRole("heading", { name: "请重新验证运营身份", exact: true }),
      ).toBeVisible();
      expect(posts).toBe(beforeNavigationPosts);
      observations.push({
        name: "workflow-navigation-authority",
        gapPreservesAuthority: true,
        keyboardLinkRevokes: true,
        pointerLinkRevokes: true,
        additionalPosts: 0,
      });
    }
    await p.close();
  }
  const context = await browser.newContext({
    viewport: { width: 320, height: 900 },
  });
  const page = await context.newPage();
  let clipboardCalls = 0;
  await page.exposeFunction("recordSafeDisclosure", () => {
    clipboardCalls++;
  });
  page.on(
    "pageerror",
    (e) => (
      errors.push(e.message.replace(/qf[kg]_p4_[A-Za-z0-9_-]+/g, "[redacted]")),
      console.error(
        e.message.replace(/qf[kg]_p4_[A-Za-z0-9_-]+/g, "[redacted]"),
      )
    ),
  );
  await page.addInitScript(`
  window.__name = (value) => value;
  (() => { let count = 0; Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (link) => { await window.recordSafeDisclosure(); const u = new URL(link); window.clipboardSafe = { count: ++count, origin: u.origin === location.origin,
      path: u.pathname === "/access", noQuery: u.search === "", fragment: /^#key=qfk_p4_[A-Za-z0-9_-]{43}$/.test(u.hash) }; }
  } }); })();
`);
  await page.goto(origin + "/studio-probe");
  await page
    .getByRole("combobox", { name: "已封存的父版本" })
    .selectOption(parent.version.id);
  await page
    .getByRole("button", { name: "创建消费者内测版本", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "原内测版本已创建", exact: true }),
  ).toBeVisible();
  await shot(page, "created-play-320");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认结束并清除本标签记录" }).click();
  await expect(
    page.getByRole("combobox", { name: "固定内测版本", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "固定内测版本", exact: true })
    .selectOption(play.id);
  await page.getByRole("button", { name: "生成并发放一枚访问 Key" }).click();
  await expect(
    page.getByRole("heading", { name: "原 Key 发放已记录" }),
  ).toBeVisible();
  await shot(page, "issued-key-320");
  const downloadWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载私密链接文件" }).click();
  const download = await downloadWait;
  const downloadPath = path.join(out, "private-synthetic-access.txt");
  await download.saveAs(downloadPath);
  await chmod(downloadPath, 0o600);
  let secretLink = new URL((await readFile(downloadPath, "utf8")).trim());
  const secretDigest = await digestConsumerToken(
    secretLink.hash.slice(5),
    "access-key",
  );
  expect(
    secretLink.origin === origin &&
      secretLink.pathname === "/access" &&
      secretLink.search === "" &&
      keys.some((k) => k.issue.binding.credentialDigest === secretDigest),
  ).toBe(true);
  // The raw link stays in this private artifact; assertions return only booleans.
  secretLink = new URL(origin);
  await expect(
    page.getByText("已触发私密链接文件下载，请确认已妥善保存。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "复制私密访问链接" }).click();
  await expect(
    page.getByText("私密访问链接已复制，请勿公开分享。"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { clipboardSafe?: unknown }).clipboardSafe,
    ),
  ).toEqual({
    count: 1,
    origin: true,
    path: true,
    noQuery: true,
    fragment: true,
  });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认结束并清除本标签记录" }).click();
  await expect(
    page.getByRole("combobox", { name: "固定内测版本", exact: true }),
  ).toBeEnabled();
  mode = "unknown";
  await page.getByRole("button", { name: "生成并发放一枚访问 Key" }).click();
  await expect(page.getByRole("button", { name: "核对原请求" })).toBeVisible();
  await shot(page, "unknown-issue-320");
  const before = issueBindings.length;
  await page.reload();
  await expect(page.getByRole("button", { name: "核对原请求" })).toBeVisible();
  expect(issueBindings.length).toBe(before);
  await shot(page, "restored-unknown-320");
  mode = "normal";
  await page.getByRole("button", { name: "核对原请求" }).click();
  await expect(
    page.getByRole("heading", { name: "原 Key 发放已记录" }),
  ).toBeVisible();
  await shot(page, "resolved-issue-320");
  authReached = new Promise<void>((resolve) => {
    notifyAuth = resolve;
  });
  holdAuth = true;
  const beforeHidden = clipboardCalls;
  await page.getByRole("button", { name: "复制私密访问链接" }).click();
  await authReached;
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("heading", { name: "请重新验证运营身份" }),
  ).toBeVisible();
  releaseAuth?.();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("heading", { name: "请重新验证运营身份" }),
  ).toBeVisible();
  expect(clipboardCalls).toBe(beforeHidden);
  await shot(page, "hidden-pending-disclosure-320");
  await page.getByRole("button", { name: "重新读取与核对身份" }).click();
  await page.getByRole("button", { name: "核对原请求" }).click();
  await expect(
    page.getByRole("heading", { name: "原 Key 发放已记录" }),
  ).toBeVisible();
  authReached = new Promise<void>((resolve) => {
    notifyAuth = resolve;
  });
  holdAuth = true;
  await page.getByRole("button", { name: "复制私密访问链接" }).click();
  await authReached;
  await page.evaluate(() =>
    (
      window as Window & { invalidateStudioAuthority?: () => void }
    ).invalidateStudioAuthority?.(),
  );
  await expect(
    page.getByRole("heading", { name: "请重新验证运营身份" }),
  ).toBeVisible();
  holdAuth = false;
  releaseAuth?.();
  expect(
    await page.evaluate(
      () => (window as Window & { clipboardSafe?: unknown }).clipboardSafe,
    ),
  ).toBeUndefined();
  await shot(page, "logout-pending-disclosure-320");
  await page.getByRole("button", { name: "重新读取与核对身份" }).click();
  await page.getByRole("button", { name: "核对原请求" }).click();
  await expect(
    page.getByRole("heading", { name: "原 Key 发放已记录" }),
  ).toBeVisible();
  const other = await page.context().newPage();
  await other.goto(origin + "/studio-probe");
  await expect(
    other.getByRole("button", { name: "创建消费者内测版本", exact: true }),
  ).toBeVisible();
  await other.evaluate(() =>
    (
      window as Window & { invalidateStudioAuthority?: () => void }
    ).invalidateStudioAuthority?.(),
  );
  await expect(
    page.getByRole("heading", { name: "请重新验证运营身份" }),
  ).toBeVisible();
  await shot(page, "other-tab-invalidation-320");
  await other.close();
  await page.getByRole("button", { name: "重新读取与核对身份" }).click();
  await page.getByRole("button", { name: "核对原请求" }).click();
  await expect(
    page.getByRole("heading", { name: "原 Key 发放已记录" }),
  ).toBeVisible();
  authReached = new Promise<void>((resolve) => {
    notifyAuth = resolve;
  });
  holdAuth = true;
  await page.getByRole("button", { name: "复制私密访问链接" }).click();
  await authReached;
  const beforeNavigation = clipboardCalls;
  await page.getByRole("link", { name: "返回测评工作区", exact: true }).click();
  holdAuth = false;
  releaseAuth?.();
  await expect(page.getByRole("button", { name: "核对原请求" })).toBeVisible();
  await page.getByRole("button", { name: "核对原请求" }).click();
  await expect(
    page.getByRole("heading", { name: "原 Key 发放已记录" }),
  ).toBeVisible();
  expect(clipboardCalls).toBe(beforeNavigation);
  mode = "other-issuer";
  await page.getByRole("button", { name: "复制私密访问链接" }).click();
  await expect(
    page.getByRole("heading", { name: "请重新验证运营身份" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { clipboardSafe?: unknown }).clipboardSafe,
    ),
  ).toBeUndefined();
  await shot(page, "issuer-changed-320");
  mode = "normal";
  // Known raw loss preserves only the original digest/binding, never a reconstructed link.
  await page.evaluate(() => {
    for (const key of Object.keys(sessionStorage)) {
      if (!key.startsWith("quizforge:p4:studio-pending:v1:")) continue;
      const value = JSON.parse(sessionStorage.getItem(key)!);
      if (value.operation.kind === "issue") {
        value.operation.raw = null;
        sessionStorage.setItem(key, JSON.stringify(value));
      }
    }
  });
  await page.reload();
  await expect(
    page.getByText(
      "原文已不在本标签，不能恢复私密链接或重放发放。仍可核对原请求。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重放原请求", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "复制私密访问链接", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "下载私密链接文件", exact: true }),
  ).toHaveCount(0);
  await shot(page, "raw-loss-before-resolve-320");
  const beforeRawLoss = issueBindings.length;
  await page.getByRole("button", { name: "核对原请求", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "原 Key 发放已记录", exact: true }),
  ).toBeVisible();
  expect(issueBindings.length).toBe(beforeRawLoss);
  await expect(
    page.getByRole("button", { name: "复制私密访问链接", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "下载私密链接文件", exact: true }),
  ).toHaveCount(0);
  await shot(page, "raw-loss-resolved-320");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "确认结束并清除本标签记录", exact: true })
    .click();
  await page.close();
  mode = "readonly";
  const ro = await browser.newPage({ viewport: { width: 320, height: 900 } });
  await ro.goto(origin + "/studio-probe");
  await expect(
    ro.getByText("当前运营身份为只读", { exact: false }),
  ).toBeVisible();
  await expect(
    ro.getByRole("combobox", { name: "固定内测版本", exact: true }),
  ).toBeDisabled();
  await shot(ro, "readonly-320");
  await ro.close();
  mode = "normal";
  const v = await browser.newPage({ viewport: { width: 320, height: 900 } });
  await v.goto(origin + "/studio-probe");
  await v.getByRole("button", { name: "作废此未领取 Key" }).first().click();
  mode = "claim-before-void";
  await v.getByRole("button", { name: "确认作废未领取 Key" }).click();
  await expect(
    v.getByRole("heading", { name: "未作废：Key 已领取" }),
  ).toBeVisible();
  await shot(v, "claimed-before-void-320");
  await v.getByRole("checkbox").check();
  await v.getByRole("button", { name: "确认结束并清除本标签记录" }).click();
  await v.getByRole("button", { name: "作废此未领取 Key" }).first().click();
  mode = "normal";
  await v.getByRole("button", { name: "确认作废未领取 Key" }).click();
  await expect(
    v.getByRole("heading", { name: "原未领取作废已记录" }),
  ).toBeVisible();
  await shot(v, "voided-unused-320");
  await v.close();
  expect(errors).toEqual([]);
  expect(rawSeenByApi).toBe(false);
}
try {
  browser = await chromium.launch({ headless: true });
  await globalNavigationRegression(browser);
  expect(errors).toEqual([]);
  // Restore the original in-memory starting fixture for the unchanged scenarios.
  hasPlay = false;
  play = f.play.play;
  if (!navigationOnly) await runExistingConsumerScenarios(browser);
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        scope:
          "synthetic in-memory HTTP/clipboard stub and actual UI only; no DB, real permissions or production E2E",
        navigationOnly,
        browser: await browser.version(),
        viewports: navigationOnly ? [390, 1440] : [320, 375, 390, 430, 1440],
        screenshots: shots,
        observations,
        rawSeenByApi,
        posts,
        issuedKeys: keys.length,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      out,
      screenshots: shots.length,
      pageErrors: errors.length,
      rawSeenByApi,
    }),
  );
} finally {
  await browser?.close();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
}
