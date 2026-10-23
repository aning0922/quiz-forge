import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect, type Page, type TestInfo } from "@playwright/test";
import { draftSummarySchema } from "@/features/product/drafts/contracts";
import { captureDraftMobile } from "../e2e/studio-drafts.visual";
import { validationDtoSchema } from "@/features/quizpack/validation/contracts";
import { dto } from "@/features/studio/validations/fixtures.test-support";
import { DRAFT_PENDING_STORAGE_KEY } from "@/features/studio/drafts/pending";

import {
  captureRevisionWidths,
  waitForRevisionCaptureReady,
} from "../e2e/studio-draft-revisions.visual";
import { REVISION_PENDING_STORAGE_KEY } from "@/features/studio/draft-revisions/pending";
import { receipt as revisionReceipt } from "@/features/studio/draft-revisions/fixtures.test-support";
import type { AppendDraftBinding } from "@/features/product/draft-revisions/contracts";

// Actual DraftWorkspacePage + history/read clients, controlled synthetic HTTP only.
// No DB, native media, credentials, 3100 or production Next server.
const out = path.resolve(".cache/p4-drafts-capture", String(Date.now()));
await mkdir(out, { recursive: true });
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = draftSummarySchema.parse({
  productId: "capture-fixture",
  draftId: id(2),
  revision: 1,
  applicationId: id(3),
  sourceImportId: id(4),
  sourceValidationId: id(5),
  canonicalContentSha256: "a".repeat(64),
  assetSetSha256: "b".repeat(64),
  canonicalManifestSha256: "c".repeat(64),
  candidateSha256: "d".repeat(64),
  containerSchemaVersion: "quizpack.v1",
  contentSchemaVersion: "quizpack-content.v1",
  contentKind: "synthetic",
  packId: "capture-fixture-pack",
  packVersion: "1.0.0",
  versions: {
    contentVersion: "1.0.0",
    visualVersion: "1.0.0",
    reportVersion: "1.0.0",
    resourceVersion: "1.0.0",
    componentVersion: "1.0.0",
    engine: { id: "archetype", version: "1.0.0" },
  },
  resourceCount: 4,
  createdAt: "2026-10-19T00:00:00.000Z",
  createdBy: id(1),
  platformApproval: "unverified",
  publishable: false,
});
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
const validation = validationDtoSchema.parse({
  ...dto,
  productId: draft.productId,
  importId: id(4),
  id: id(6),
  status: "ready",
  stateRevision: 5,
  storageCondition: "clean",
  maintenanceRequired: false,
  packId: "e2e-drafts-synthetic-0",
  packVersion: "1.0.0",
  containerSchemaVersion: "quizpack.v1",
  contentSchemaVersion: "quizpack-content.v1",
  identityKind: "canonical",
  canonicalValidationId: id(6),
  candidateSha256: "d".repeat(64),
  assetSetSha256: "b".repeat(64),
  resourceCount: 4,
  archivedResourceCount: 4,
  validatedAt: dto.updatedAt,
  readyAt: dto.updatedAt,
});
const revisionProbe = process.argv.includes("--revision-probe");
let validationFailure = 0;
const revisionTuple: AppendDraftBinding = {
  productId: draft.productId,
  sourceImportId: id(4),
  sourceValidationId: id(6),
  idempotencyKey: id(7),
  expectedValidationStateRevision: 5,
  expectedCandidateSha256: validation.candidateSha256!,
  target: {
    kind: "append-revision",
    draftId: draft.draftId,
    expectedRevision: 1,
    expectedCanonicalContentSha256: draft.canonicalContentSha256,
    expectedAssetSetSha256: draft.assetSetSha256,
  },
};
const application = await revisionReceipt(revisionTuple);
const emptyProbe = process.argv.includes("--empty-probe");
let serveEmpty = emptyProbe;
let posts = 0;
let gateTarget = "",
  draftReads = 0,
  productReads = 0;
let failedRead = "";
let releaseRead: (() => void) | undefined,
  notifyRead: (() => void) | undefined,
  readRequested = Promise.resolve();
function holdRead(target: string) {
  gateTarget = target;
  draftReads = productReads = 0;
  readRequested = new Promise<void>((r) => {
    notifyRead = r;
  });
}
async function readGate(key: string) {
  if (key === gateTarget) {
    notifyRead?.();
    await new Promise<void>((r) => {
      releaseRead = r;
    });
  }
}
await fromTsx("esbuild").build({
  entryPoints: [path.resolve("tests/browser/studio-drafts-capture.client.tsx")],
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
const oldSource = execFileSync(
  "git",
  ["show", "7ebfca5:tests/e2e/studio-drafts.spec.ts"],
  { encoding: "utf8" },
);
const oldFunction = oldSource.slice(
  oldSource.indexOf("async function mobile("),
  oldSource.indexOf("test.beforeAll"),
);
await writeFile(
  path.join(out, "old-mobile.ts"),
  'import {expect,type Page,type TestInfo} from "@playwright/test";\nexport ' +
    oldFunction,
);
const old = (await import(
  pathToFileURL(path.join(out, "old-mobile.ts")).href
)) as { mobile: typeof captureDraftMobile };
await writeFile(
  path.join(out, "before-empty.visual.ts"),
  execFileSync("git", ["show", "903a462:tests/e2e/studio-drafts.visual.ts"], {
    encoding: "utf8",
  }),
);
const beforeEmpty = (await import(
  pathToFileURL(path.join(out, "before-empty.visual.ts")).href
)) as { captureDraftMobile: typeof captureDraftMobile };
const files = new Map([
  [
    "/probe.js",
    {
      bytes: await readFile(path.join(out, "probe.js")),
      type: "text/javascript",
    },
  ],
  [
    "/probe.css",
    { bytes: await readFile(path.join(out, "probe.css")), type: "text/css" },
  ],
]);
let releaseHistory: (() => void) | undefined,
  notifyHistory: (() => void) | undefined,
  failure = false;
let historyRequested = Promise.resolve();
function hold() {
  historyRequested = new Promise<void>((r) => {
    notifyHistory = r;
  });
}
const server = createServer(async (req, res) => {
  if (req.method === "POST") posts++;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const json = (value: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (url.pathname.endsWith("/revision-applications/resolve")) {
    json({
      kind: "applied",
      binding: revisionTuple,
      fingerprint: application.fingerprint,
      application,
    });
    return;
  }
  if (url.pathname.endsWith("/draft")) {
    const key = "draft-" + ++draftReads;
    await readGate(key);
    if (failedRead === key) {
      json({ code: "STUDIO_UNAVAILABLE", requestId: id(6) }, 503);
      return;
    }
    json(
      serveEmpty
        ? { kind: "empty", productId: draft.productId }
        : { kind: "draft", draft },
    );
    return;
  }
  if (url.pathname === "/api/studio/products/capture-fixture") {
    const key = "product-" + ++productReads;
    await readGate(key);
    if (failedRead === key) {
      json({ code: "STUDIO_UNAVAILABLE", requestId: id(6) }, 503);
      return;
    }
    json({ id: draft.productId, archivedAt: null });
    return;
  }
  if (url.pathname.endsWith("/validations/" + id(6))) {
    if (validationFailure)
      json(
        {
          code:
            validationFailure === 404
              ? "VALIDATION_NOT_FOUND"
              : "STUDIO_UNAVAILABLE",
          requestId: id(9),
        },
        validationFailure,
      );
    else json(validation);
    return;
  }
  if (url.pathname.endsWith("/revisions")) {
    notifyHistory?.();
    await new Promise<void>((r) => {
      releaseHistory = r;
    });
    json(
      failure
        ? { code: "STUDIO_UNAVAILABLE", requestId: id(6) }
        : {
            productId: draft.productId,
            draftId: draft.draftId,
            pageSize: 20,
            anchorRevision: 1,
            beforeRevision: 2,
            items: [draft],
            nextBeforeRevision: null,
          },
      failure ? 503 : 200,
    );
    return;
  }
  const file = files.get(url.pathname);
  if (file) {
    res.writeHead(200, { "content-type": file.type });
    res.end(file.bytes);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}h1,h2,h3,p{margin:0}button,select{font:inherit}' +
      (emptyProbe || revisionProbe
        ? "h1,h2,h3{font-size:inherit;font-weight:inherit}"
        : "") +
      '</style><div id="root"></div><script src="/probe.js"></script></html>',
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const facts: Record<string, unknown> = {
  qualification:
    "actual React workspace/history clients with held synthetic HTTP, no DB/3100/production server",
};
try {
  if (revisionProbe) {
    const oldText = execFileSync(
      "git",
      ["show", "8426f13:tests/e2e/studio-draft-revisions.spec.ts"],
      { encoding: "utf8" },
    );
    await writeFile(
      path.join(out, "old-revision.ts"),
      'import {expect,type Page,type TestInfo} from "@playwright/test";\nimport {sampleStudioLayout,assertStudioLayout} from ' +
        JSON.stringify(path.resolve("tests/e2e/studio-layout.ts")) +
        ";\nexport " +
        oldText.slice(
          oldText.indexOf("async function screenshot("),
          oldText.indexOf("async function openSource("),
        ),
    );
    const oldRevision = (await import(
      pathToFileURL(path.join(out, "old-revision.ts")).href
    )) as { screenshot: typeof captureRevisionWidths };
    const newPage = async () =>
      browser.newPage({ viewport: { width: 320, height: 900 } });
    holdRead("draft-2");
    const p = await newPage();
    await p.goto(origin + "/read-only-empty");
    await readRequested;
    await expect(
      p.getByRole("heading", {
        name: "本次更新所依据的草稿：修订 1",
        exact: true,
      }),
    ).toBeVisible();
    const measure = () =>
      p.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        sections: [...document.querySelectorAll("section[aria-label]")].map(
          (e) => ({
            label: e.getAttribute("aria-label"),
            height: e.getBoundingClientRect().height,
            statuses: [...e.querySelectorAll('[role="status"]')].map(
              (s) => s.textContent,
            ),
          }),
        ),
        fonts: document.fonts.status,
        animations: document.getAnimations().length,
      }));
    const before = await measure();
    const shot = p.screenshot.bind(p);
    let png = 0,
      after: Awaited<ReturnType<typeof measure>> | undefined;
    p.screenshot = async (...args: Parameters<Page["screenshot"]>) => {
      const bytes = await shot(...args);
      png = bytes.readUInt32BE(20);
      releaseRead?.();
      await waitForRevisionCaptureReady(p, "read-only-r1");
      after = await measure();
      return bytes;
    };
    let oldError = "";
    try {
      await oldRevision.screenshot(
        p,
        {
          outputPath: (file) => path.join(out, "revision-negative-" + file),
        } as TestInfo,
        "read-only-r1",
      );
    } catch (e) {
      oldError = String(e);
    }
    expect(oldError).toContain("Received:");
    expect(png).toBe(before.height);
    expect(after!.height).not.toBe(png);
    facts.revisionNegative = { before, png, after, oldError };
    await p.close();
    const fixes = [];
    for (const target of ["draft-1", "draft-2", "product-1", "product-2"]) {
      holdRead(target);
      const fixed = await newPage();
      await fixed.goto(origin + "/read-only-empty");
      await readRequested;
      let shots = 0;
      const original = fixed.screenshot.bind(fixed);
      fixed.screenshot = async (...args: Parameters<Page["screenshot"]>) => {
        shots++;
        return original(...args);
      };
      const work = captureRevisionWidths(
        fixed,
        {
          outputPath: (file) =>
            path.join(out, `revision-fixed-${target}-${file}`),
        } as TestInfo,
        "read-only-r1",
      );
      await fixed.evaluate(() => document.readyState);
      expect(shots).toBe(0);
      releaseRead?.();
      await work;
      expect(shots).toBe(4);
      fixes.push({ target, shots });
      await fixed.close();
    }
    facts.revisionFixes = fixes;
    const bad = [];
    for (const target of ["draft-2", "product-1"]) {
      holdRead(target);
      failedRead = target;
      const failed = await newPage();
      await failed.goto(origin + "/read-only-empty");
      await readRequested;
      releaseRead?.();
      let shots = 0;
      let rejected = false;
      try {
        await captureRevisionWidths(
          failed,
          {
            outputPath: (file) => {
              shots++;
              return path.join(out, "unexpected-" + file);
            },
          } as TestInfo,
          "read-only-r1",
        );
      } catch {
        rejected = true;
      }
      expect(rejected && shots === 0).toBe(true);
      bad.push({ target, rejected, shots });
      failedRead = "";
      await failed.close();
    }
    facts.revisionReadErrors = bad;
    gateTarget = "";
    const sourceErrors = [];
    for (const status of [503, 404]) {
      validationFailure = status;
      const failed = await newPage();
      const anchor = JSON.stringify({
        schemaVersion: REVISION_PENDING_STORAGE_KEY,
        entries: [{ tuple: revisionTuple, mayHaveBeenSent: true }],
      });
      await failed.addInitScript(
        ({ key, text }) => sessionStorage.setItem(key, text),
        { key: REVISION_PENDING_STORAGE_KEY, text: anchor },
      );
      await failed.goto(origin + "/read-only-empty");
      await failed
        .getByRole("button", { name: "查询上次草稿更新结果", exact: true })
        .click();
      await expect(
        failed.locator('[data-revision-resolution="applied"]'),
      ).toBeVisible();
      await captureRevisionWidths(
        failed,
        {
          outputPath: (file) =>
            path.join(out, `revision-source${status}-${file}`),
        } as TestInfo,
        `source${status}-r2-fixed-receipt`,
      );
      expect(
        await failed.evaluate(
          ({ key, text }) => sessionStorage.getItem(key) === text,
          { key: REVISION_PENDING_STORAGE_KEY, text: anchor },
        ),
      ).toBe(true);
      sourceErrors.push({
        status,
        shots: 4,
        anchorUnchanged: true,
        applyPanelAbsent:
          (await failed
            .getByRole("region", { name: "建立第一版草稿", exact: true })
            .count()) === 0,
      });
      await failed.close();
    }
    facts.revisionSourceErrors = sourceErrors;
    validationFailure = 0;
    hold();
    const corrupt = await newPage();
    await corrupt.addInitScript(
      (key) => sessionStorage.setItem(key, "{broken"),
      REVISION_PENDING_STORAGE_KEY,
    );
    await corrupt.goto(origin + "/?role=read-only");
    await historyRequested;
    const corruptWork = captureRevisionWidths(
      corrupt,
      {
        outputPath: (file) => path.join(out, "revision-corrupt-" + file),
      } as TestInfo,
      "corrupt-anchor-history-readable",
    );
    releaseHistory?.();
    await corruptWork;
    expect(
      await corrupt.evaluate(
        (key) => sessionStorage.getItem(key),
        REVISION_PENDING_STORAGE_KEY,
      ),
    ).toBe("{broken");
    facts.revisionCorrupt = { shots: 4, anchorUnchanged: true };
    await corrupt.close();
  } else if (emptyProbe) {
    const traces = [],
      fixes = [];
    for (const target of ["draft-1", "draft-2", "product-1", "product-2"]) {
      holdRead(target);
      const p = await browser.newPage({
        viewport: { width: 320, height: 900 },
      });
      await p.goto(origin + "/read-only-empty");
      await readRequested;
      await expect(
        p
          .getByRole("region", { name: "建立第一版草稿", exact: true })
          .getByText("当前身份为只读", { exact: false }),
      ).toBeVisible();
      await expect(p.getByRole("status")).toHaveCount(1);
      await expect(
        p.getByText("此浏览器会话没有此工作区的待确认追加请求。", {
          exact: true,
        }),
      ).toBeAttached();
      await expect(
        p.getByText(
          "此工作区有原操作待核实，或本地操作记录存储不可用。新准备保持关闭。",
          { exact: true },
        ),
      ).toHaveCount(0);
      const measure = () =>
        p.evaluate(() => ({
          height: document.documentElement.scrollHeight,
          innerWidth,
          clientWidth: document.documentElement.clientWidth,
          fonts: { status: document.fonts.status, count: document.fonts.size },
          animations: document.getAnimations().length,
          sections: [...document.querySelectorAll("section[aria-label]")].map(
            (e) => ({
              label: e.getAttribute("aria-label"),
              height: e.getBoundingClientRect().height,
              statuses: [...e.querySelectorAll('[role="status"]')].map(
                (s) => s.textContent,
              ),
            }),
          ),
        }));
      const before = await measure();
      const shot = p.screenshot.bind(p);
      let heldAfterShot: Awaited<ReturnType<typeof measure>> | undefined,
        after: Awaited<ReturnType<typeof measure>> | undefined,
        png = 0;
      p.screenshot = async (...args: Parameters<Page["screenshot"]>) => {
        const image = await shot(...args);
        png = image.readUInt32BE(20);
        heldAfterShot = await measure();
        // Complete only the held independent read after PNG capture, before
        // the old helper's after-height check: the second production failure window.
        releaseRead?.();
        await expect(p.getByRole("status")).toHaveCount(0);
        after = await measure();
        return image;
      };
      let rejected = false;
      try {
        await beforeEmpty.captureDraftMobile(
          p,
          {
            outputPath: (name) =>
              path.join(out, `empty-negative-${target}-${name}`),
          },
          "read-only-empty",
        );
      } catch {
        rejected = true;
      }
      expect(
        rejected &&
          before.height === png &&
          heldAfterShot?.height === png &&
          after?.height !== before.height,
      ).toBe(true);
      traces.push({ target, before, png, heldAfterShot, after, rejected });
      await p.close();
      holdRead(target);
      const fixed = await browser.newPage({
        viewport: { width: 320, height: 900 },
      });
      await fixed.goto(origin + "/read-only-empty");
      await readRequested;
      let captures = 0;
      const fixedShot = fixed.screenshot.bind(fixed);
      fixed.screenshot = async (...args: Parameters<Page["screenshot"]>) => {
        captures++;
        return fixedShot(...args);
      };
      const work = captureDraftMobile(
        fixed,
        {
          outputPath: (name) => path.join(out, `empty-fixed-${target}-${name}`),
        },
        "read-only-empty",
      );
      await fixed.evaluate(() => document.readyState);
      expect(captures).toBe(0);
      releaseRead?.();
      await work;
      expect(captures).toBe(4);
      fixes.push({ target, captures, widths: [320, 375, 390, 430] });
      await fixed.close();
    }
    facts.emptyTraces = traces;
    facts.emptyFixes = fixes;
    const errorCases = [];
    for (const target of ["draft-2", "product-1"]) {
      holdRead(target);
      failedRead = target;
      const p = await browser.newPage({
        viewport: { width: 320, height: 900 },
      });
      await p.goto(origin + "/read-only-empty");
      await readRequested;
      releaseRead?.();
      let captures = 0;
      const shot = p.screenshot.bind(p);
      p.screenshot = async (...args: Parameters<Page["screenshot"]>) => {
        captures++;
        return shot(...args);
      };
      let rejected = false;
      try {
        await captureDraftMobile(
          p,
          {
            outputPath: (name) =>
              path.join(out, `empty-error-${target}-${name}`),
          },
          "read-only-empty",
        );
      } catch {
        rejected = true;
      }
      expect(rejected && captures === 0).toBe(true);
      errorCases.push({ target, rejected, captures });
      await p.close();
      failedRead = "";
    }
    facts.emptyErrors = errorCases;
    serveEmpty = false;
    hold();
    const pendingPage = await browser.newPage({
      viewport: { width: 320, height: 900 },
    });
    const anchor = JSON.stringify({
      schemaVersion: DRAFT_PENDING_STORAGE_KEY,
      entries: [
        {
          tuple: {
            productId: draft.productId,
            sourceImportId: draft.sourceImportId,
            sourceValidationId: draft.sourceValidationId,
            idempotencyKey: id(9),
            expectedValidationStateRevision: 5,
            expectedCandidateSha256: draft.candidateSha256,
            target: { kind: "new-draft" },
          },
          mayHaveBeenSent: true,
        },
      ],
    });
    await pendingPage.addInitScript(
      ({ key, text }) => sessionStorage.setItem(key, text),
      { key: DRAFT_PENDING_STORAGE_KEY, text: anchor },
    );
    await pendingPage.goto(origin + "/?role=read-only");
    await historyRequested;
    await expect(
      pendingPage.getByRole("button", {
        name: "查询上次草稿创建结果",
        exact: true,
      }),
    ).toBeEnabled();
    const work = captureDraftMobile(
      pendingPage,
      { outputPath: (name) => path.join(out, "preserved-pending-" + name) },
      "read-only-unknown",
    );
    releaseHistory?.();
    await work;
    const anchorUnchanged = await pendingPage.evaluate(
      ({ key, text }) => sessionStorage.getItem(key) === text,
      { key: DRAFT_PENDING_STORAGE_KEY, text: anchor },
    );
    expect(anchorUnchanged && posts === 0).toBe(true);
    await expect(
      pendingPage.getByRole("button", {
        name: "查询上次草稿创建结果",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      pendingPage.getByRole("button", {
        name: "再次发送原草稿创建操作",
        exact: true,
      }),
    ).toHaveCount(0);
    facts.preservedPending = {
      anchorUnchanged,
      posts,
      widths: [320, 375, 390, 430],
    };
    await pendingPage.close();
  } else {
    hold();
    const page = await browser.newPage({
      viewport: { width: 320, height: 900 },
    });
    await page.goto(origin);
    await historyRequested;
    await expect(
      page.getByRole("link", { name: "查看此修订内容", exact: true }),
    ).toBeVisible();
    const screenshot = page.screenshot.bind(page);
    let before = 0,
      png = 0;
    page.screenshot = async (...args: Parameters<Page["screenshot"]>) => {
      before = await page.evaluate(() =>
        Math.max(innerHeight, document.documentElement.scrollHeight),
      );
      releaseHistory?.();
      await expect(page.locator('[data-history-revision="1"]')).toBeVisible();
      const bytes = await screenshot(...args);
      png = bytes.readUInt32BE(20);
      return bytes;
    };
    let oldRejected = false;
    try {
      await old.mobile(
        page,
        { outputPath: (file) => path.join(out, "negative-" + file) },
        "draft-summary",
      );
    } catch {
      oldRejected = true;
    }
    expect(oldRejected && png > before).toBe(true);
    facts.negative = {
      oldRejected,
      before,
      png,
      historyArrival: "after old height measurement and before actual capture",
    };
    await page.close();
    hold();
    const fixed = await browser.newPage({
      viewport: { width: 320, height: 900 },
    });
    await fixed.goto(origin);
    await historyRequested;
    let captures = 0;
    const fixedShot = fixed.screenshot.bind(fixed);
    fixed.screenshot = async (...args: Parameters<Page["screenshot"]>) => {
      captures++;
      return fixedShot(...args);
    };
    const capture = captureDraftMobile(
      fixed,
      { outputPath: (file) => path.join(out, "fixed-" + file) },
      "draft-summary",
    );
    expect(captures).toBe(0);
    releaseHistory?.();
    await capture;
    expect(captures).toBe(4);
    facts.fixed = {
      captures,
      widths: [320, 375, 390, 430],
      fullHeightAssertions: "before === after === PNG; width === PNG",
    };
    await fixed.close();
    hold();
    failure = true;
    const failed = await browser.newPage({
      viewport: { width: 320, height: 900 },
    });
    await failed.goto(origin);
    await historyRequested;
    releaseHistory?.();
    let failureCaptures = 0;
    const failedShot = failed.screenshot.bind(failed);
    failed.screenshot = async (...args: Parameters<Page["screenshot"]>) => {
      failureCaptures++;
      return failedShot(...args);
    };
    let failureRejected = false;
    try {
      await captureDraftMobile(
        failed,
        { outputPath: (file) => path.join(out, "error-" + file) },
        "draft-summary",
      );
    } catch {
      failureRejected = true;
    }
    expect(failureRejected && failureCaptures === 0).toBe(true);
    facts.historyFailure = {
      rejected: failureRejected,
      captures: failureCaptures,
    };
    await failed.close();
  }
  facts.browser = await browser.version();
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(facts, null, 2),
  );
  console.log(
    JSON.stringify({
      out,
      emptyProbe,
    }),
  );
} finally {
  releaseRead?.();
  releaseHistory?.();
  await browser.close();
  await new Promise<void>((r, reject) =>
    server.close((e) => (e ? reject(e) : r())),
  );
  facts.browserClosed = true;
  facts.serverClosed = true;
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(facts, null, 2),
  );
}
