import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import {
  consumerHostFixtureV1,
  consumerAppliedFixtureV1,
} from "@/features/theme/consumer-v1/host.test-support";
import { persistedReportFixture } from "@/features/report/persisted/contracts.test-support";
import {
  consumerSaveBindingSha256,
  verifyConsumerSaveInput,
} from "@/lib/consumer-contract/v1/state";
import { PREVIEW_FONT_ASSET } from "@/features/product/preview/descriptor";
import { consumerEntryFactsSha256 } from "@/features/fulfillment/consumer-flow/display-contract";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { persistedReportDisplaySha256 } from "@/features/report/persisted/view-contracts";
import { persistedReportSnapshotSha256 } from "@/features/report/persisted/snapshot-contract";
import { internalPlayFixture } from "@/features/product/internal-play/contracts.test-support";
import {
  internalPlayBindingSha256,
  internalPlaySnapshotSha256,
} from "@/features/product/internal-play/contracts";
import { sourceBinding } from "@/features/theme/preview/fixtures.test-support";
import {
  contentScoreSchema,
  prepareContentForScoring,
  scorePreparedContent,
} from "@/features/quizpack/content/scoring-adapter";
import {
  projectConsumerEntryV1,
  projectConsumerResultV1,
} from "@/features/theme/consumer-v1/projection";
import {
  consumerCanonicalText,
  consumerTextSha256,
} from "@/lib/consumer-contract/v1/integrity";
import { consumerCompleteBindingSha256 } from "@/features/report/persisted/view-contracts";
import {
  CONSUMER_IMPLEMENTATION_DESCRIPTORS,
  consumerImplementationIdentity,
} from "@/features/product/internal-play/implementation-catalog";

import { captureConsumerWidths } from "../e2e/consumer-flow.ui";
import type { TestInfo } from "@playwright/test";

/** Actual browser host against a synthetic in-memory HTTP fixture; no business owner/DB/3100. */
const out = path.resolve(".cache/p4-consumer-host", String(Date.now()));
await mkdir(out, { recursive: true });
const f = structuredClone(await consumerHostFixtureV1()),
  stored = structuredClone(await persistedReportFixture());
const neutral = await readFile(
  "tests/fixtures/p3e-baseline/assets/neutral-cover.png",
);
const portrait = await readFile(
  "tests/fixtures/p3e-baseline/assets/portrait-1.png",
);
// Rebuild synthetic source/play/report hashes together from actual test pixels.
// This is transport fixture construction, not a registered runtime or database report.
const rebuilt = structuredClone(await internalPlayFixture());
for (const resource of rebuilt.content.resources) {
  const bytes = resource.purpose === "portrait" ? portrait : neutral;
  resource.path = resource.path.replace(/\.[^.]+$/, ".png");
  Object.assign(resource, {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "image/png",
    width: 48,
    height: 48,
  });
}
const source = sourceBinding(rebuilt.content);
const prepared = prepareContentForScoring(rebuilt.content);
if (!prepared.ok) {
  throw Error("SYNTHETIC_SOURCE_INVALID");
}
const scored = scorePreparedContent(prepared.value, rebuilt.answers);
if (!scored.ok) throw Error("SYNTHETIC_SCORING_INVALID");
const play = rebuilt.play;
const registered = CONSUMER_IMPLEMENTATION_DESCRIPTORS[0]!,
  identity = consumerImplementationIdentity(registered),
  font = registered.descriptor.font;
const fontIdentity = {
  id: font.id,
  version: font.version,
  weight: font.weight,
  fileSha256: font.fileSha256,
  coverageSha256: font.coverageSha256,
  licenseSha256: font.licenseSha256,
};
play.snapshot.parentSnapshot.font = fontIdentity;
play.snapshot.renderer = identity;
play.play.binding.renderer = identity;
play.snapshot.mapping = structuredClone(registered.descriptor.mapping);
play.snapshot.mappingSha256 = registered.descriptor.mappingSha256;
f.entry.facts.renderer = identity;
f.entry.facts.font = fontIdentity;
f.entry.facts.mapping = structuredClone(play.snapshot.mapping);
f.entry.facts.mappingSha256 = play.snapshot.mappingSha256;
stored.view.renderer = identity;
stored.view.font = fontIdentity;
stored.view.mapping = structuredClone(play.snapshot.mapping);
stored.view.mappingSha256 = play.snapshot.mappingSha256;

Object.assign(play.snapshot.parentSnapshot.target, {
  canonicalContentSha256: source.canonicalContentSha256,
  assetSetSha256: source.assetSetSha256,
});
for (const r of play.snapshot.resources.resources) {
  const asset = rebuilt.content.resources.find(
    (a) => a.id === r.resourceId && a.version === r.resourceVersion,
  )!;
  r.blobSha256 = asset.sha256;
  r.declarationSha256 = await consumerTextSha256(
    consumerCanonicalText(asset, 65536),
  );
}
const parentHash = await consumerTextSha256(
  consumerCanonicalText(play.snapshot.parentSnapshot, 65536),
);
play.snapshot.parent.snapshotSha256 = parentHash;
play.play.binding.parent.snapshotSha256 = parentHash;
play.play.bindingSha256 = await internalPlayBindingSha256(play.play.binding);
play.play.snapshotSha256 = await internalPlaySnapshotSha256(play.snapshot);
for (const session of [
  f.session,
  f.initial.session,
  f.view.grant.session,
  f.entry.facts.session,
  stored.snapshot.binding.session,
  stored.view.session,
  stored.receipt.binding.session,
])
  session.playSnapshotSha256 = play.play.snapshotSha256;
const entryProjection = projectConsumerEntryV1(
  rebuilt.content,
  source.canonicalContentSha256,
);
const resultProjection = projectConsumerResultV1(
  rebuilt.content,
  scored.value,
  source.canonicalContentSha256,
);
if (!entryProjection.ok || !resultProjection.ok)
  throw Error("SYNTHETIC_PROJECTION_INVALID");
f.entry.facts.entry = entryProjection.value;
f.entry.facts.parent = play.snapshot.parent;
f.entry.factsSha256 = await consumerEntryFactsSha256(f.entry.facts);
stored.snapshot.play = play;
stored.snapshot.score = contentScoreSchema.parse(scored.value);
stored.view.parent = play.snapshot.parent;
stored.view.display = resultProjection.value;
stored.view.completionBindingSha256 = await consumerCompleteBindingSha256(
  stored.receipt.binding,
);
stored.receipt.bindingSha256 = stored.view.completionBindingSha256;
stored.snapshot.view = stored.view;
stored.receipt.displaySha256 = await persistedReportDisplaySha256(stored.view);
stored.receipt.reportSnapshotSha256 = await persistedReportSnapshotSha256(
  stored.snapshot,
);
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
const esbuild = fromTsx("esbuild") as {
  build(options: Record<string, unknown>): Promise<unknown>;
};
await esbuild.build({
  entryPoints: [path.resolve("tests/browser/consumer-host.client.tsx")],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  external: ["/assets/*"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "silent",
});
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>*{box-sizing:border-box}body{margin:0;font:16px/1.75 system-ui}header{padding:12px 20px;background:#fff4ce;font-size:16px}</style><header>合成 HTTP／浏览器 host 验证 · 无数据库或实际授权事务</header><div id="root"></div><script id="fixture" type="application/json">${JSON.stringify({ sessionId: f.session.sessionId, font: PREVIEW_FONT_ASSET }).replaceAll("<", "\\u003c")}</script><script src="/probe.js"></script></html>`;
const files = new Map<string, { body: string | Uint8Array; type: string }>([
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
for (const file of [PREVIEW_FONT_ASSET.file, PREVIEW_FONT_ASSET.coverage])
  files.set(file, {
    body: await readFile(path.join("public", file)),
    type: file.endsWith("woff2") ? "font/woff2" : "text/plain",
  });
let state = f.initial,
  mode = "normal",
  savePosts = 0;
let last: Awaited<ReturnType<typeof consumerAppliedFixtureV1>> | null = null;
const requests: string[] = [];
const saveBindings: string[] = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const send = (value: unknown, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    });
    res.end(JSON.stringify(value));
  };
  try {
    if (url.pathname.endsWith("/api/session")) {
      send({
        ...f.view,
        ...(mode === "expired-pending"
          ? { keyExpiresAt: "2026-10-17T00:00:00.000Z" }
          : mode === "expiring-pending"
            ? {
                keyExpiresAt: new Date(
                  Date.parse(f.view.observedAt) + 800,
                ).toISOString(),
              }
            : {}),
        outcome:
          mode === "completed"
            ? { kind: "completed", report: stored.receipt }
            : {
                kind: mode === "expired-pending" ? "expired" : "editable",
                state,
              },
      });
      return;
    }
    if (url.pathname.endsWith("/api/entry")) {
      if (mode === "entry-unavailable") {
        send(
          {
            schemaVersion: "quizforge.consumer-error.v1",
            code: "UNAVAILABLE",
            requestId: f.session.sessionId,
          },
          503,
        );
        return;
      }
      send(f.entry);
      return;
    }
    if (url.pathname.endsWith("/api/report")) {
      send({ receipt: stored.receipt, view: stored.view });
      return;
    }
    if (url.pathname.endsWith("/api/resources")) {
      if (mode === "deny-resource") {
        send(
          {
            schemaVersion: "quizforge.consumer-error.v1",
            code: "ACCESS_DENIED",
            requestId: f.session.sessionId,
          },
          401,
        );
        return;
      }
      res.writeHead(200, { "content-type": "image/png" });
      res.end(
        url.searchParams.get("resourceId") ===
          stored.view.display.result.portrait.resourceRef.id
          ? portrait
          : neutral,
      );
      return;
    }
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(url.pathname);
      if (url.pathname.endsWith("/complete/resolve")) {
        send({
          schemaVersion: "quizforge.consumer-complete-resolution.v1",
          kind: "unresolved",
          binding: body,
          bindingSha256: await consumerCompleteBindingSha256(body),
          state,
        });
        return;
      }
      if (url.pathname.endsWith("/save/resolve")) {
        send(
          last && (await consumerSaveBindingSha256(body)) === last.bindingSha256
            ? last
            : {
                schemaVersion: "quizforge.consumer-save-resolution.v1",
                kind: "unresolved",
                binding: body,
                bindingSha256: await consumerSaveBindingSha256(body),
                state,
              },
        );
        return;
      }
      if (url.pathname.endsWith("/save")) {
        savePosts++;
        const input = await verifyConsumerSaveInput(body);
        saveBindings.push(await consumerSaveBindingSha256(input.binding));
        last = await consumerAppliedFixtureV1(input);
        state = last.state;
        if (mode === "unknown") {
          req.socket.destroy();
          return;
        }
        send(last);
        return;
      }
      if (url.pathname.endsWith("/logout")) {
        res.writeHead(204);
        res.end();
        return;
      }
      send({});
      return;
    }
    const file = files.get(url.pathname);
    if (file) {
      res.writeHead(200, { "content-type": file.type });
      res.end(file.body);
      return;
    }
    if (
      url.pathname === "/access" ||
      url.pathname === `/play/${f.session.sessionId}`
    ) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end();
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
const base = `http://127.0.0.1:${address.port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const screenshots: string[] = [],
  errors: string[] = [],
  observations: unknown[] = [];
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    smallTargets: [...document.querySelectorAll("button,a")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
    }).length,
  }));
  expect(metrics).toEqual({ overflow: false, smallTargets: 0 });
  observations.push({ name, ...metrics });
  await page.screenshot({
    path: path.join(out, name + ".png"),
    fullPage: true,
  });
  screenshots.push(name + ".png");
}
try {
  browser = await chromium.launch({ headless: true });
  let networkAttemptsDuringLoss = 0,
    sameOriginalBindingDuringLoss = true;
  if (process.argv.includes("--capture-readiness-only")) {
    state = f.initial;
    mode = "normal";
    last = null;
    const page = await browser.newPage({
      viewport: { width: 320, height: 900 },
    });
    let release!: () => void, requested!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      resourceRequested = new Promise<void>((r) => {
        requested = r;
      });
    await page.route(/\/api\/resources\?/, async (route) => {
      requested();
      await gate;
      await route.continue();
    });
    await page.goto(`${base}/play/${f.session.sessionId}`);
    await resourceRequested;
    await expect(
      page.locator(
        '[data-consumer-state="cover"] [data-consumer-media="loading"]',
      ),
    ).toBeVisible();
    let captures = 0;
    const capture = captureConsumerWidths(
      page,
      {
        outputPath: (file) => {
          captures++;
          screenshots.push(file);
          return path.join(out, file);
        },
      } as TestInfo,
      "consumer-cover",
    );
    await page.evaluate(() => document.readyState);
    expect(captures).toBe(0);
    release();
    await capture;
    expect(captures).toBe(4);
    observations.push({
      captureReadiness: "held actual VerifiedMedia resource",
      shots: captures,
    });
    await page.unroute(/\/api\/resources\?/);
    await page.getByRole("button", { name: "开始答题", exact: true }).click();
    await page.getByRole("radio").first().click();
    mode = "unknown";
    await page.getByRole("button", { name: "暂歇，查看进度" }).click();
    await expect(
      page.getByRole("heading", { name: "核对上一次操作", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-consumer-state="resume"]')).toBeVisible();
    const pendingKey = `quizforge:p4:consumer-pending:v1:${f.session.sessionId}`,
      anchor = await page.evaluate(
        (key) => sessionStorage.getItem(key),
        pendingKey,
      ),
      beforePosts = savePosts;
    expect(anchor).not.toBeNull();
    await captureConsumerWidths(
      page,
      {
        outputPath: (file) => {
          screenshots.push(file);
          return path.join(out, file);
        },
      } as TestInfo,
      "save-unknown-restored",
    );
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), pendingKey),
    ).toBe(anchor);
    expect(savePosts).toBe(beforePosts);
    observations.push({
      captureReadiness:
        "actual UNKNOWN reload restores resume without VerifiedMedia",
      shots: 4,
      anchorUnchanged: true,
      noAdditionalPost: true,
    });
    await page.close();
    mode = "completed";
    const completed = await browser.newPage({
      viewport: { width: 320, height: 900 },
    });
    await completed.goto(`${base}/play/${f.session.sessionId}`);
    const info = {
      outputPath: (file: string) => {
        screenshots.push(file);
        return path.join(out, file);
      },
    } as TestInfo;
    await captureConsumerWidths(completed, info, "completed-result");
    await completed
      .getByRole("button", { name: "展开报告", exact: true })
      .click();
    await captureConsumerWidths(completed, info, "readonly-report");
    await completed
      .getByRole("button", { name: "查看海报", exact: true })
      .click();
    await captureConsumerWidths(completed, info, "readonly-poster");
    await completed.close();
    observations.push({
      captureReadiness: "actual completed report/result/poster screen media",
      shots: 12,
    });
  }
  if (
    !process.argv.includes("--capture-readiness-only") &&
    !process.argv.some((a) =>
      ["--expired-pending-only", "--live-expired-pending-only"].includes(a),
    )
  ) {
    for (const width of process.argv.includes("--registered-only")
      ? [320]
      : [320, 375, 390, 430]) {
      state = f.initial;
      mode = "normal";
      last = null;
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/play/${f.session.sessionId}`);
      await expect(page.locator("[data-consumer-state=cover]")).toBeVisible();
      await shot(page, `cover-${width}`);
      await page.getByRole("button", { name: "开始答题", exact: true }).click();
      await expect(
        page.locator("[data-consumer-state=question]"),
      ).toBeVisible();
      await page.getByRole("radio").first().click();
      await shot(page, `question-unsaved-${width}`);
      await page.getByRole("button", { name: "暂歇，查看进度" }).click();
      await expect(page.locator("[data-consumer-state=resume]")).toBeVisible();
      await page.reload();
      await expect(page.locator("[data-consumer-state=resume]")).toBeVisible();
      await shot(page, `resume-reloaded-${width}`);
      await page.close();
    }
    if (!process.argv.includes("--registered-only")) {
      state = f.initial;
      last = null;
      mode = "normal";
      const page = await browser.newPage({
        viewport: { width: 320, height: 900 },
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/play/${f.session.sessionId}`);
      await page.getByRole("button", { name: "开始答题", exact: true }).click();
      await page.getByRole("radio").first().click();
      mode = "unknown";
      const before = savePosts;
      await page.getByRole("button", { name: "暂歇，查看进度" }).click();
      await expect(
        page.getByRole("heading", { name: "核对上一次操作" }),
      ).toBeVisible();
      expect(await page.locator("input:enabled").count()).toBe(0);
      expect(savePosts).toBeGreaterThan(before);
      const afterLoss = savePosts;
      networkAttemptsDuringLoss = afterLoss - before;
      sameOriginalBindingDuringLoss =
        new Set(saveBindings.slice(before, afterLoss)).size === 1;
      expect(sameOriginalBindingDuringLoss).toBe(true);
      await shot(page, "unknown-320");
      mode = "entry-unavailable";
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "核对上一次操作" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "暂时无法读取体验" }),
      ).toBeVisible();
      await shot(page, "pending-entry-unavailable-320");
      mode = "normal";
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "核对上一次操作" }),
      ).toBeVisible();
      expect(savePosts).toBe(afterLoss);
      await shot(page, "pending-restored-320");
      mode = "normal";
      await page.getByRole("button", { name: "核对原操作" }).click();
      await expect(
        page.getByRole("button", { name: "采用已核对结果" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "采用已核对结果" }).click();
      await expect(page.locator("[data-consumer-state=resume]")).toBeVisible();
      expect(savePosts).toBe(afterLoss);
      await page.getByRole("button", { name: "继续答题", exact: true }).click();
      for (let i = 0; i < f.entry.facts.entry.questions.length; i++) {
        if (i > 0) {
          await page
            .getByRole("button", { name: new RegExp(`第 ${i + 1} 题`) })
            .click();
        }
        await page.getByRole("radio").first().click();
        await page.getByRole("button", { name: "暂歇，查看进度" }).click();
        await expect(
          page.locator("[data-consumer-state=resume]"),
        ).toBeVisible();
      }
      await page
        .getByRole("button", { name: "检查并完成", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "确认完成本次测评" }),
      ).toBeVisible();
      await shot(page, "completion-review-320");
      mode = "deny-resource";
      await page.reload();
      await page.getByRole("button", { name: "继续答题", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "请重新验证访问" }),
      ).toBeVisible();
      await shot(page, "authority-lost-320");
      await page.close();
      mode = "completed";
      const completed = await browser.newPage({
        viewport: { width: 320, height: 900 },
      });
      completed.on("pageerror", (e) => errors.push(e.message));
      await completed.goto(`${base}/play/${f.session.sessionId}`);
      await expect(
        completed.locator("[data-consumer-state=result]"),
      ).toBeVisible();
      await expect(completed.locator("img")).toBeVisible();
      await shot(completed, "completed-result-320");
      await completed.getByRole("button", { name: "展开报告" }).click();
      await expect(
        completed.locator("[data-consumer-state=report]"),
      ).toBeVisible();
      await shot(completed, "completed-report-320");
      await completed
        .getByRole("button", { name: "查看海报", exact: true })
        .click();
      await completed.getByRole("button", { name: "生成报告海报" }).click();
      await expect(
        completed.getByRole("button", { name: "下载 PNG 海报" }),
      ).toBeVisible();
      await shot(completed, "completed-poster-ready-320");
      const downloadPromise = completed.waitForEvent("download");
      await completed.getByRole("button", { name: "下载 PNG 海报" }).click();
      await (
        await downloadPromise
      ).saveAs(path.join(out, "host-export-1080x1920.png"));
      const png = await sharp(
        path.join(out, "host-export-1080x1920.png"),
      ).metadata();
      expect([png.width, png.height]).toEqual([1080, 1920]);
      await completed.close();
      const access = await browser.newPage({
        viewport: { width: 320, height: 900 },
      });
      await access.goto(`${base}/access#key=malformed`);
      await expect(
        access.getByRole("heading", { name: "进入你的测评" }),
      ).toBeVisible();
      expect(new URL(access.url()).hash).toBe("");
      await shot(access, "access-invalid-320");
      await access.close();
    }
  }
  mode = process.argv.includes("--live-expired-pending-only")
    ? "expiring-pending"
    : "expired-pending";
  const complete = stored.receipt.binding;
  state = (
    await consumerAppliedFixtureV1({
      binding: {
        schemaVersion: "quizforge.consumer-save.v1",
        session: f.session,
        expectedStateRevision: 0,
        consumerStateAnswersSha256: complete.consumerStateAnswersSha256,
        progressSha256: complete.progressSha256,
      },
      answers: rebuilt.answers,
      progress: { questionId: null },
    })
  ).state;
  const expired = await browser.newPage({
    viewport: { width: 320, height: 900 },
  });
  expired.on("pageerror", (e) => errors.push(e.message));
  await expired.addInitScript(
    ({ id, binding }) =>
      sessionStorage.setItem(
        `quizforge:p4:consumer-pending:v1:${id}`,
        JSON.stringify({
          schemaVersion: "quizforge.consumer-client-pending.v1",
          operation: "complete",
          mayHaveBeenSent: true,
          binding,
        }),
      ),
    { id: f.session.sessionId, binding: complete },
  );
  await expired.goto(`${base}/play/${f.session.sessionId}`);
  if (mode === "expiring-pending")
    await expect(
      expired.getByRole("button", { name: "重放原操作" }),
    ).toBeVisible();
  await expect(
    expired.getByText("本次答题期限已到，可查询原提交结果。", { exact: false }),
  ).toBeVisible();
  await expect(expired.getByRole("button", { name: "重放原操作" })).toHaveCount(
    0,
  );
  await shot(expired, "expired-complete-pending-320");
  const beforeResolve = requests.length;
  await expired.getByRole("button", { name: "核对原操作" }).click();
  await expect(
    expired.getByRole("button", { name: "核对原操作" }),
  ).toBeVisible();
  await expect(expired.getByRole("button", { name: "重放原操作" })).toHaveCount(
    0,
  );
  expect(requests.slice(beforeResolve)).toEqual([
    `/play/${f.session.sessionId}/api/complete/resolve`,
  ]);
  expect(
    await expired.evaluate(
      (id) =>
        sessionStorage.getItem(`quizforge:p4:consumer-pending:v1:${id}`) !==
        null,
      f.session.sessionId,
    ),
  ).toBe(true);
  await shot(expired, "expired-complete-unresolved-320");
  await expired.close();
  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        scope:
          "synthetic in-memory HTTP + actual host; no business owner/database/native/3100; not P4/P5 acceptance",
        browser: await browser.version(),
        viewports: screenshots.length <= 5 ? [320] : [320, 375, 390, 430],
        actualRegistryIdentity: identity,
        composition:
          "Actual app ConsumerSessionExperienceV1 projects renderer/mapping/font from full host facts",
        expiryCase: mode === "expiring-pending" ? "live" : "already-expired",
        screenshots,
        observations,
        savePosts,
        networkAttemptsDuringLoss,
        sameOriginalBindingDuringLoss,
        requestPaths: requests,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      out,
      screenshots: screenshots.length,
      pageErrors: errors.length,
    }),
  );
} finally {
  await browser?.close();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
}
