import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  internalPlayFixture,
  testMoment,
  testUuid,
} from "@/features/product/internal-play/contracts.test-support";
import {
  issueAccessKeyBindingSchema,
  issueAccessKeyBindingSha256,
  type AccessKeyDetail,
} from "@/features/fulfillment/access/contracts";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY } from "@/features/product/internal-play/implementation-catalog";
import {
  fixture,
  binding,
  renderer,
  engine,
  target,
} from "@/features/studio/internal-versions/fixtures.test-support";

/** Actual retained React owners + synthetic HTTP. No DB, live users or system clipboard. */
const out = path.resolve(".cache/studio-release-tasks", String(Date.now()));
await mkdir(out, { recursive: true, mode: 0o700 });
const consumer = await internalPlayFixture();
const review = await fixture();
const parity = process.argv.includes("--parity-main");
const receiptsOnly = process.argv.includes("--receipts-only");
const productId = consumer.content.product.productId;
const issuerId = testUuid(7);
const session = {
  operator: { id: issuerId, label: "Synthetic operator", role: "operator" },
  csrfToken: "A".repeat(43),
  idleExpiresAt: "2026-10-24T23:00:00.000Z",
  absoluteExpiresAt: "2026-10-25T23:00:00.000Z",
};
const parent = consumer.parent;
const version = {
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
};
const esbuild = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
)("esbuild");
await esbuild.build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client'; import {useState} from 'react';
import {StudioConsumerAccessPageV1} from '@/features/studio/consumer-access/page';
import {InternalAuthorityProvider,useInternalAuthority} from '@/features/studio/internal-versions/authority';
import {ProductTaskSurfaces,useWorkspaceSurfaces} from '@/features/studio/product-workspace/task-surfaces';
import {ReviewWorkbench} from '@/features/studio/product-workspace/review-workbench';
import {StudioClientError} from '@/features/studio/client';
import {VersionReceiptFacts} from '@/features/studio/internal-versions/facts';
import {InternalEvidenceFacts} from '@/features/studio/internal-versions/pending-panel';
const input=JSON.parse(document.querySelector('#fixture').textContent);
function Body(){const authority=useInternalAuthority();const surfaces=useWorkspaceSurfaces();const [current,setCurrent]=useState(input.target);const [visible,setVisible]=useState(true);
if(input.receipts){const actions={onOpenVersion:id=>{document.querySelector('#result').textContent='version:'+id},onGoToTesting:()=>{document.querySelector('#result').textContent='testing'}};return <><output id="result"/>{input.receipts.map((item,index)=><section data-receipt-case={index} key={index}>{index===0?<VersionReceiptFacts version={item} actions={actions}/>:<InternalEvidenceFacts evidence={item} receiptActions={actions}/>}</section>)}</>}
window.revokeWorkspace=()=>authority.observe(new StudioClientError('UNAUTHENTICATED'));
if(input.revoked&&!authority.isRevoked) window.revokeWorkspace();
return <><div hidden={input.parity}><button onClick={()=>{if(surfaces.canSwitch())setVisible(!visible)}}>切换主区域</button><button onClick={()=>setCurrent(input.nextTarget)}>模拟新摘要</button></div>
{input.review?<ReviewWorkbench productId={input.productId} session={input.session} currentTarget={current} visible={visible} onChanged={()=>{}}/>:<StudioConsumerAccessPageV1 scope={input.scope} renderer={input.renderer} embedded visible={visible} workspaceAuthority={authority}/>}</>}
createRoot(document.getElementById('root')).render(<InternalAuthorityProvider productId={input.productId}><ProductTaskSurfaces><Body/></ProductTaskSurfaces></InternalAuthorityProvider>);
`,
    resolveDir: process.cwd(),
    loader: "tsx",
    sourcefile: "release-tasks-probe.tsx",
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
      name: "unused-node-policy-branch",
      setup(build: {
        onResolve: (o: { filter: RegExp }, cb: () => unknown) => void;
        onLoad: (
          o: { filter: RegExp; namespace: string },
          cb: () => unknown,
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
const js = await readFile(path.join(out, "probe.js")),
  css = await readFile(path.join(out, "probe.css"));
let origin = "",
  issuePosts = 0,
  rawAtApi = false,
  mode = "normal",
  unresolved = false,
  authReads = 0,
  releaseIssue: (() => void) | undefined;
let issueReached = () => {};
const keys: AccessKeyDetail[] = [];
if (parity) {
  for (const index of [0, 1]) {
    const issueBinding = issueAccessKeyBindingSchema.parse({
      schemaVersion: "quizforge.access-key-issue.v1",
      operationKey: testUuid(200 + index),
      keyId: testUuid(300 + index),
      play: {
        productId,
        playVersionId: consumer.play.play.id,
        playSnapshotSha256: consumer.play.play.snapshotSha256,
      },
      credentialDigest: "a".repeat(64),
      validForSeconds: 604800,
    });
    keys.push({
      issue: {
        schemaVersion: "quizforge.access-key-issue-receipt.v1",
        binding: issueBinding,
        bindingSha256: await issueAccessKeyBindingSha256(issueBinding),
        issuedBy: issuerId,
        issuedAt: testMoment,
        expiresAt: new Date(Date.parse(testMoment) + 604800000).toISOString(),
      },
      current: {
        observedAt: testMoment,
        claim: index
          ? { sessionId: testUuid(400), claimedAt: testMoment }
          : null,
        completion: null,
        voidReceipt: null,
      },
    });
  }
}
const reviewVersion = {
  id: review.version.id,
  productId: binding.productId,
  slot: review.version.slot,
  target: review.snapshot.target,
  reviewId: review.snapshot.reviewId,
  reviewSha256: review.snapshot.reviewSha256,
  snapshotSha256: review.version.snapshotSha256,
  renderer: review.snapshot.renderer,
  rendererCapability: review.snapshot.rendererCapability,
  engine: review.snapshot.engine,
  purpose: review.version.purpose,
  publicationApproved: review.version.publicationApproved,
  createdAt: review.version.createdAt,
  createdBy: review.version.createdBy,
};
const revisionReads: number[] = [];
const nextTarget = {
  ...target,
  revision: 3,
  canonicalContentSha256: "f".repeat(64),
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const send = (value: unknown, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  try {
    if (url.pathname === "/api/studio/auth/session") {
      authReads++;
      send(session);
      return;
    }
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const part of req) chunks.push(Buffer.from(part));
      const bodyText = Buffer.concat(chunks).toString("utf8");
      rawAtApi ||= /qfk_p4_|qfg_p4_/.test(bodyText);
      const request = issueAccessKeyBindingSchema.parse(JSON.parse(bodyText));
      if (url.pathname.endsWith("/access-keys")) {
        issuePosts++;
        const key: AccessKeyDetail = {
          issue: {
            schemaVersion: "quizforge.access-key-issue-receipt.v1",
            binding: request,
            bindingSha256: await issueAccessKeyBindingSha256(request),
            issuedBy: issuerId,
            issuedAt: testMoment,
            expiresAt: new Date(
              Date.parse(testMoment) + request.validForSeconds * 1000,
            ).toISOString(),
          },
          current: {
            observedAt: testMoment,
            claim: null,
            completion: null,
            voidReceipt: null,
          },
        };
        if (mode === "expired" || mode === "before-expiry")
          key.current.observedAt = new Date(
            Date.parse(key.issue.expiresAt) -
              (mode === "before-expiry" ? 1 : 0),
          ).toISOString();
        keys.unshift(key);
        if (mode === "held") {
          issueReached();
          await new Promise<void>((resolve) => {
            releaseIssue = resolve;
          });
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
        const key = keys.find((k) => k.issue.binding.keyId === request.keyId);
        send({
          schemaVersion: "quizforge.access-key-issue-resolution.v1",
          kind: unresolved ? "unresolved" : "applied",
          binding: request,
          bindingSha256: await issueAccessKeyBindingSha256(request),
          ...(!unresolved ? { key } : {}),
        });
        return;
      }
      throw Error("UNEXPECTED_WRITE");
    }
    const match = url.pathname.match(/\/revisions\/(\d+)\/internal-review$/);
    if (match) {
      const rev = Number(match[1]);
      revisionReads.push(rev);
      send({
        ok: true,
        value: {
          productId: binding.productId,
          target: rev === 3 ? nextTarget : target,
          observedCurrentRevision: rev === 3 ? 3 : 2,
          review: rev === 3 ? null : review.review,
          baseline: rev === 3 ? null : binding.baseline,
          rendererChoices:
            rev === 3
              ? []
              : [{ renderer, capability: "studio-internal-preview" }],
          engine: rev === 3 ? null : engine,
        },
      });
      return;
    }
    if (url.pathname.endsWith("/internal-versions")) {
      send({
        ok: true,
        value: {
          productId: url.pathname.includes(binding.productId)
            ? binding.productId
            : productId,
          versions: url.pathname.includes(binding.productId)
            ? parity
              ? [reviewVersion]
              : []
            : [version],
        },
      });
      return;
    }
    if (url.pathname.endsWith("/play-versions")) {
      send({ productId, versions: [consumer.play.play] });
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
      send(keys.find((key) => url.pathname.endsWith(key.issue.binding.keyId)));
      return;
    }
    if (url.pathname === "/probe.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(js);
      return;
    }
    if (url.pathname === "/probe.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(css);
      return;
    }
    const isReview = url.searchParams.has("review");
    const input = {
      review: isReview,
      revoked: url.searchParams.has("revoked"),
      productId: isReview ? binding.productId : productId,
      target: parity && isReview ? nextTarget : target,
      nextTarget,
      parity,
      receipts: url.searchParams.has("receipts")
        ? [
            review.version,
            {
              operation: "seal",
              value: { kind: "sealed", version: review.version },
            },
            {
              operation: "seal",
              value: {
                kind: "not-sealed-target-used",
                consumed: review.version,
              },
            },
          ]
        : undefined,
      session,
      scope: { origin, instanceId: "a".repeat(32), issuerId, productId },
      renderer: CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1_2,
    };
    res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>*{box-sizing:border-box}body{font:16px/1.6 system-ui;margin:16px auto;max-width:1160px;padding:0 12px;background:#f5f6fa}button{font:inherit;min-height:44px}</style><div id="root"></div><script id="fixture" type="application/json">${JSON.stringify(input).replaceAll("<", "\\u003c")}</script><script src="/probe.js"></script>`,
    );
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw Error("OWN_PORT_REQUIRED");
origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const results: string[] = [];
try {
  if (process.argv.includes("--terminal-only")) {
    for (const terminalMode of ["expired", "before-expiry"]) {
      mode = terminalMode;
      const page = await browser.newPage({
        viewport: { width: 390, height: 900 },
      });
      page.setDefaultTimeout(7000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin);
      await page
        .getByRole("button", { name: "发放访问码", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("combobox", { name: /^答题版本/ })
        .selectOption(consumer.play.play.id);
      await page
        .getByRole("button", { name: "确认生成并发放一枚访问码" })
        .click();
      await expect(
        page.getByRole("heading", { name: "上次访问码发放已记录" }),
      ).toBeVisible();
      await page.getByRole("checkbox").check();
      const finish = page.getByRole("button", {
        name: "确认结束并清除当前标签页记录",
      });
      if (terminalMode === "expired") {
        await expect(
          page.getByText(
            "已核实此访问码已过期且未完成，原协议不允许披露私密链接。请核对后明确结束本地记录。",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "复制私密访问链接" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "下载私密链接文件" }),
        ).toHaveCount(0);
        await page.getByRole("button", { name: "关闭当前浮层" }).click();
        await expect(page.getByRole("alert")).toContainText("核对后明确结束");
        await expect(finish).toBeEnabled();
        await finish.click();
        await expect(page.getByRole("dialog")).toBeHidden();
        results.push(
          "expired-at-exact-boundary applied Key with local raw can explicitly finish without impossible disclosure",
        );
      } else {
        await expect(
          page.getByRole("button", { name: "复制私密访问链接" }),
        ).toBeEnabled();
        await expect(finish).toBeDisabled();
        results.push(
          "one millisecond before expiry still requires saving usable raw before finish",
        );
      }
      await page.close();
    }
  }
  if (
    !parity &&
    !receiptsOnly &&
    !process.argv.includes("--review-only") &&
    !process.argv.includes("--terminal-only")
  ) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    page.setDefaultTimeout(7000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      `Object.defineProperty(navigator, 'clipboard', {value: {writeText: async () => {window.copies=(window.copies||0)+1;}}});`,
    );
    await page.goto(origin);
    await expect(
      page.getByRole("button", { name: "发放访问码", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "创建答题版本", exact: true })
      .click();
    const select = page.getByRole("dialog").getByRole("combobox");
    await select.selectOption(version.id);
    await select.evaluate((element) => {
      (window as Window & { originalSelect?: Element }).originalSelect =
        element;
    });
    await page.getByRole("button", { name: "关闭当前浮层" }).click();
    await page
      .getByRole("button", { name: "创建答题版本", exact: true })
      .click();
    await expect(select).toHaveValue(version.id);
    expect(
      await select.evaluate(
        (element) =>
          element ===
          (window as Window & { originalSelect?: Element }).originalSelect,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "关闭当前浮层" }).click();
    results.push("play selection and DOM survive close/open");
    mode = "held";
    let reached = new Promise<void>((resolve) => {
      issueReached = resolve;
    });
    await page.getByRole("button", { name: "发放访问码", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("combobox", { name: /^答题版本/ })
      .selectOption(consumer.play.play.id);
    await page.screenshot({
      path: path.join(out, "issue-form-1440.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({
      path: path.join(out, "issue-form-390.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole("button", { name: "确认生成并发放一枚访问码" })
      .click();
    await reached;
    await page.screenshot({
      path: path.join(out, "issue-busy-1440.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "关闭当前浮层" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    releaseIssue?.();
    await expect(
      page.getByRole("button", { name: "复制私密访问链接" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "关闭当前浮层" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: path.join(out, "issue-result-1440.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({
      path: path.join(out, "issue-result-390.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("checkbox").check();
    await expect(
      page.getByRole("button", { name: "确认结束并清除当前标签页记录" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "复制私密访问链接" }).click();
    await expect(
      page.getByText("私密链接已复制，请妥善保存。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "确认结束并清除当前标签页记录" }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "确认结束并清除当前标签页记录" })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(issuePosts).toBe(1);
    results.push(
      "busy/raw close blocked; fresh copy + explicit finish returns to records",
    );
    mode = "unknown";
    unresolved = true;
    await page.getByRole("button", { name: "发放访问码", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("combobox", { name: /^答题版本/ })
      .selectOption(consumer.play.play.id);
    await page
      .getByRole("button", { name: "确认生成并发放一枚访问码" })
      .click();
    await expect(
      page.getByRole("button", { name: "查询上次操作结果" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "查询上次操作结果" }).click();
    await expect(
      page.getByRole("heading", { name: "原操作仍未确认" }),
    ).toBeVisible();
    expect(issuePosts).toBe(2);
    await page.getByRole("button", { name: "关闭当前浮层" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    unresolved = false;
    await page.getByRole("button", { name: "查询上次操作结果" }).click();
    await expect(
      page.getByRole("button", { name: "复制私密访问链接" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "复制私密访问链接" }).click();
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "确认结束并清除当前标签页记录" })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(issuePosts).toBe(2);
    results.push(
      "UNKNOWN unresolved preserves original issue and never sends replacement",
    );
    await page.setViewportSize({ width: 390, height: 900 });
    await page
      .getByRole("button", { name: "查看详情", exact: true })
      .first()
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.locator("body").innerText()).not.toMatch(
      /qfk_p4_|qfg_p4_/,
    );
    await page.screenshot({
      path: path.join(out, "safe-key-390.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: path.join(out, "safe-key-1440.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "作废此未领取访问码" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "确认作废未领取访问码", exact: true }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({
      path: path.join(out, "void-task-390.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "关闭当前浮层" }).click();
    results.push(
      "safe Key drawer switches to a single void task with no nested dialog",
    );
    const late = await browser.newPage();
    late.on("pageerror", (error) => errors.push(error.message));
    await late.goto(origin);
    await expect(
      late.getByRole("button", { name: "发放访问码", exact: true }),
    ).toBeEnabled();
    mode = "held";
    reached = new Promise<void>((resolve) => {
      issueReached = resolve;
    });
    await late.getByRole("button", { name: "发放访问码", exact: true }).click();
    await late
      .getByRole("dialog")
      .getByRole("combobox", { name: /^答题版本/ })
      .selectOption(consumer.play.play.id);
    await late
      .getByRole("button", { name: "确认生成并发放一枚访问码" })
      .click();
    await reached;
    await late.evaluate(() => {
      const revoke = (window as Window & { revokeWorkspace?: () => void })
        .revokeWorkspace;
      if (!revoke) throw Error("WORKSPACE_AUTHORITY_OBSERVER_MISSING");
      revoke();
    });
    releaseIssue?.();
    await expect(
      late.getByRole("heading", { name: "请重新验证运营身份" }),
    ).toBeVisible();
    await expect(
      late.getByRole("button", { name: "复制私密访问链接" }),
    ).toHaveCount(0);
    results.push(
      "shared authority revokes consumer during held issue; no late disclosure",
    );
    await late.close();
    const initial = await browser.newPage();
    const beforeAuth = authReads;
    await initial.goto(origin + "/?revoked");
    await expect(
      initial.getByRole("heading", { name: "请重新验证运营身份" }),
    ).toBeVisible();
    expect(authReads).toBe(beforeAuth);
    results.push("initial shared revocation performs no controller refresh");
    await initial.close();
  }
  if (
    !parity &&
    !receiptsOnly &&
    !process.argv.includes("--consumer-only") &&
    !process.argv.includes("--terminal-only")
  ) {
    const reviewPage = await browser.newPage();
    reviewPage.setDefaultTimeout(7000);
    reviewPage.on("pageerror", (error) => errors.push(error.message));
    await reviewPage.goto(origin + "/?review");
    await expect(
      reviewPage.getByText("精确匹配的合成测试依据，不表示作者批准。", {
        exact: true,
      }),
    ).toBeVisible();
    await reviewPage
      .getByRole("button", { name: "固定内测内容版本", exact: true })
      .click();
    const rendererSelect = reviewPage.locator(
      '[data-task-surface="review"] select',
    );
    await rendererSelect.selectOption(renderer.entrySha256);
    await reviewPage.screenshot({
      path: path.join(out, "review-task-1440.png"),
      fullPage: true,
    });
    await reviewPage.setViewportSize({ width: 390, height: 900 });
    await reviewPage.screenshot({
      path: path.join(out, "review-task-390.png"),
      fullPage: true,
    });
    await reviewPage.setViewportSize({ width: 1280, height: 720 });
    await rendererSelect.evaluate((element) => {
      (window as Window & { rendererSelect?: Element }).rendererSelect =
        element;
    });
    await reviewPage
      .getByRole("button", { name: "准备固定内测内容版本" })
      .click();
    await expect(
      reviewPage.getByRole("button", { name: "确认并发送此固定请求" }),
    ).toBeEnabled();
    await reviewPage.getByRole("button", { name: "关闭当前浮层" }).click();
    await reviewPage.getByRole("button", { name: "模拟新摘要" }).click();
    await expect(
      reviewPage.getByText("后台摘要已是 r3，本任务仍绑定 r2。"),
    ).toBeVisible();
    expect(revisionReads).not.toContain(3);
    await reviewPage
      .getByRole("button", { name: "继续原审核与封存任务", exact: true })
      .click();
    expect(
      await rendererSelect.evaluate(
        (element) =>
          element ===
          (window as Window & { rendererSelect?: Element }).rendererSelect,
      ),
    ).toBe(true);
    await expect(
      reviewPage.getByRole("button", { name: "确认并发送此固定请求" }),
    ).toBeEnabled();
    await reviewPage
      .getByRole("button", { name: "取消尚未发送的确认" })
      .click();
    await reviewPage.getByRole("button", { name: "关闭当前浮层" }).click();
    await reviewPage.getByRole("button", { name: "明确改为核对 r3" }).click();
    await expect(
      reviewPage.getByText("r3 没有可直接使用的匹配依据，历史批准不能沿用。", {
        exact: false,
      }),
    ).toBeVisible();
    expect(revisionReads).toContain(3);
    results.push(
      "review confirmation/DOM remains r2 across summary r3; only explicit target switch reads r3",
    );
  }
  if (receiptsOnly) {
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/?receipts");
    for (let index = 0; index < 3; index++) {
      const card = page.locator(`[data-receipt-case="${index}"]`);
      await expect(card.locator("a")).toHaveCount(0);
      await card.getByRole("button", { name: "阅读固定内测内容版本" }).click();
      await expect(page.locator("#result")).toHaveText(
        "version:" + review.version.id,
      );
      await card.getByRole("button", { name: "创建答题版本与发码" }).click();
      await expect(page.locator("#result")).toHaveText("testing");
    }
    results.push(
      "new seal / resolved seal / target-used receipt buttons invoke local version and testing callbacks with no legacy anchors",
    );
    await page.close();
  }
  if (parity) {
    for (const view of ["review", "testing"]) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin + (view === "review" ? "/?review" : "/"));
      await expect(
        page.getByRole("button", {
          name: view === "review" ? "历史固定版本" : "发放访问码",
          exact: true,
        }),
      ).toBeEnabled();
      if (view === "review")
        await expect(
          page.getByText("内测内容版本 #1", { exact: true }),
        ).toBeVisible();
      else await expect(page.getByRole("table")).toBeVisible();
      await page.screenshot({
        path: path.join(out, view + "-main-1440.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 900 });
      await page.screenshot({
        path: path.join(out, view + "-main-390.png"),
        fullPage: true,
      });
      results.push(
        view + " actual main components captured at desktop and mobile",
      );
      await page.close();
    }
  }
  expect(rawAtApi).toBe(false);
  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify({ results, issuePosts, rawAtApi, errors }, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ out, results, issuePosts, rawAtApi, errors }));
} finally {
  releaseIssue?.();
  await browser.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
