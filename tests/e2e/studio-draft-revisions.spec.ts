import { test, expect, type Page } from "@playwright/test";
import { constants } from "node:fs";
import { captureRevisionWidths as screenshot } from "./studio-draft-revisions.visual";
import { open, lstat, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DRAFT_REVISION_FIXTURE_PRIVATE_NAME,
  DRAFT_REVISION_FIXTURE_MAX_BYTES,
  draftRevisionFixtureSchema,
  type DraftRevisionFixture,
} from "../db/p3d-draft-revision-fixture-contract";
import {
  draftReadResultSchema,
  draftApplicationDtoSchema,
  type DraftSummaryDto,
} from "../../src/features/product/drafts/contracts";
import {
  appendDraftResultSchema,
  draftRevisionResolutionSchema,
  type AppendDraftBinding,
  type AppendDraftApplication,
} from "../../src/features/product/draft-revisions/contracts";
import {
  REVISION_PENDING_STORAGE_KEY,
  revisionPendingEntrySchema,
} from "../../src/features/studio/draft-revisions/pending";
import { DRAFT_PENDING_STORAGE_KEY } from "../../src/features/studio/drafts/pending";
import {
  appendRevisionEndpoint,
  resolveRevisionEndpoint,
} from "../../src/features/studio/draft-revisions/urls";
import {
  draftEndpoint,
  draftRevisionEndpoint,
  draftRevisionPath,
  draftWorkspacePath,
  checkDraftRevision,
} from "../../src/features/studio/drafts/client";
import {
  previewEntryResponseSchema,
  previewRevealResponseSchema,
} from "../../src/features/product/preview/contracts";
import {
  previewPagePath,
  previewApiPath,
} from "../../src/features/product/preview/urls";

// Real HTTP/PG, actual pure scoring and private pixels; only fixture media evidence is synthetic.
// Exactly initial/second/third may create revisions. Root alone owns server-exit proof and cleanup.
test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
const execute = promisify(execFile),
  helper = path.resolve("tests/db/p3d-draft-revision-fixture.ts");
let fixture: DraftRevisionFixture,
  prepared = false,
  allPassed = true,
  r2: AppendDraftApplication | undefined,
  r3: AppendDraftApplication | undefined,
  initialScore: string | undefined;
function runId() {
  const value = process.env.QF_DRAFT_REVISION_E2E_RUN_ID;
  if (
    !value ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    throw Error("REVISION_OWNER_RUN_ID_REQUIRED");
  return value;
}
async function command(mode: "prepare" | "finish") {
  try {
    await execute(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", helper, mode, runId()],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: mode === "prepare" ? 90_000 : 60_000,
        maxBuffer: 4096,
      },
    );
  } catch {
    throw Error("REVISIONS_E2E_FIXTURE_FAILED");
  }
}
async function readFixture() {
  try {
    const config = process.env.QUIZFORGE_P2A_CONFIG;
    if (!config || !path.isAbsolute(config)) throw Error();
    const directory = path.dirname(config),
      dirStat = await lstat(directory);
    if (
      path.dirname(directory) !== path.resolve(".cache/p2a") ||
      !/^[a-f0-9]{32}$/.test(path.basename(directory)) ||
      (await realpath(directory)) !== directory ||
      !dirStat.isDirectory() ||
      (dirStat.mode & 0o777) !== 0o700 ||
      dirStat.uid !== process.getuid?.()
    )
      throw Error();
    const file = await open(
      path.join(directory, DRAFT_REVISION_FIXTURE_PRIVATE_NAME),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const st = await file.stat();
      if (
        !st.isFile() ||
        st.nlink !== 1 ||
        (st.mode & 0o777) !== 0o600 ||
        st.uid !== process.getuid?.() ||
        st.size > DRAFT_REVISION_FIXTURE_MAX_BYTES
      )
        throw Error();
      const bytes = Buffer.alloc(DRAFT_REVISION_FIXTURE_MAX_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const part = await file.read(
          bytes,
          length,
          bytes.length - length,
          length,
        );
        if (!part.bytesRead) break;
        length += part.bytesRead;
      }
      const after = await file.stat();
      if (
        length > DRAFT_REVISION_FIXTURE_MAX_BYTES ||
        length !== st.size ||
        after.dev !== st.dev ||
        after.ino !== st.ino ||
        after.size !== st.size ||
        after.mtimeMs !== st.mtimeMs ||
        after.uid !== st.uid ||
        after.nlink !== 1 ||
        (after.mode & 0o777) !== 0o600
      )
        throw Error();
      const value = draftRevisionFixtureSchema.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(0, length),
          ),
        ),
      );
      if (
        value.runId !== runId() ||
        value.instanceId !== path.basename(directory) ||
        !value.prepared ||
        value.completed ||
        !value.initial ||
        !value.draftId ||
        !value.initialIdempotencyKey
      )
        throw Error();
      return value;
    } finally {
      await file.close();
    }
  } catch {
    throw Error("REVISIONS_E2E_FIXTURE_UNAVAILABLE");
  }
}
type Source = DraftRevisionFixture["sources"][number];
const source = (name: Source["name"]) =>
  fixture.sources.find((s) => s.name === name)!;
const detail = (name: Source["name"]) => {
  const s = source(name).scope;
  return `/studio/products/${s.productId}/imports/${s.sourceImportId}/validations/${s.sourceValidationId}`;
};
const appendPanel = (page: Page) =>
  page.getByRole("region", { name: "追加草稿修订", exact: true });
const pendingPanel = (page: Page) =>
  page.getByRole("region", { name: "追加原请求核实", exact: true });
const historyPanel = (page: Page) =>
  page.getByRole("region", { name: "草稿修订历史", exact: true });
function binding(
  s: Source,
  base: DraftSummaryDto,
  key: string = randomUUID(),
): AppendDraftBinding {
  return {
    ...s.scope,
    idempotencyKey: key,
    expectedValidationStateRevision: s.expectedValidationStateRevision,
    expectedCandidateSha256: s.expectedCandidateSha256,
    target: {
      kind: "append-revision",
      draftId: base.draftId,
      expectedRevision: base.revision,
      expectedCanonicalContentSha256: base.canonicalContentSha256,
      expectedAssetSetSha256: base.assetSetSha256,
    },
  };
}
async function signIn(page: Page, role: "operator" | "readOnly" = "operator") {
  await page.goto("/studio/login");
  await expect(page.getByLabel("运营凭证")).toBeEnabled();
  try {
    await page.evaluate((value) => {
      const input = document.getElementById("studio-credential");
      if (!(input instanceof HTMLInputElement) || input.disabled) throw Error();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw Error();
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, fixture[role].secret);
  } catch {
    throw Error("REVISIONS_E2E_INPUT_UNAVAILABLE");
  }
  await page.getByRole("button", { name: "登录 Studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "运营会话", exact: true }),
  ).toBeVisible();
}
async function headers(page: Page) {
  const response = await page.request.get("/api/studio/auth/session");
  if (!response.ok()) throw Error("REVISIONS_SESSION_UNAVAILABLE");
  const value = (await response.json()) as { csrfToken?: unknown };
  if (typeof value.csrfToken !== "string")
    throw Error("REVISIONS_SESSION_UNAVAILABLE");
  return {
    origin: new URL(page.url()).origin,
    "x-csrf-token": value.csrfToken,
  };
}
async function current(page: Page) {
  const response = await page.request.get(draftEndpoint(fixture.productId));
  if (!response.ok()) throw Error("REVISIONS_CURRENT_UNAVAILABLE");
  const value = draftReadResultSchema.parse(await response.json());
  if (value.kind !== "draft") throw Error("REVISIONS_DRAFT_MISSING");
  return value.draft;
}
async function pending(page: Page) {
  const value = await page.evaluate((key) => {
    const text = sessionStorage.getItem(key);
    return text ? (JSON.parse(text).entries?.[0] ?? null) : null;
  }, REVISION_PENDING_STORAGE_KEY);
  return value === null ? null : revisionPendingEntrySchema.parse(value);
}
async function openSource(page: Page, name: Source["name"], revision: number) {
  await page.goto(detail(name));
  await expect(
    appendPanel(page).getByRole("heading", {
      name: `本次读取的当前基准：修订 ${revision}`,
      exact: true,
    }),
  ).toBeVisible();
}
async function confirm(page: Page, revision: number) {
  await appendPanel(page)
    .getByRole("button", { name: `基于修订 ${revision} 准备追加`, exact: true })
    .click();
  await expect(
    appendPanel(page).getByRole("region", {
      name: "确认追加不可变修订",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    appendPanel(page).getByRole("heading", {
      name: `确认基于修订 ${revision} 追加`,
      exact: true,
    }),
  ).toBeVisible();
}
async function resolve(page: Page) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
        resolveRevisionEndpoint(fixture.productId) &&
      r.request().method() === "POST",
  );
  await pendingPanel(page)
    .getByRole("button", { name: "核实追加原请求", exact: true })
    .click();
  const result = draftRevisionResolutionSchema.parse(
    await (await response).json(),
  );
  await expect(
    pendingPanel(page).locator(`[data-revision-resolution="${result.kind}"]`),
  ).toBeVisible();
  return result;
}
async function clearTerminal(page: Page) {
  await pendingPanel(page)
    .getByRole("button", { name: "移除已失效原请求并重新准备", exact: true })
    .click();
  await expect.poll(() => pending(page)).toBeNull();
}
async function preview(
  page: Page,
  revision: number,
  name: "initial" | "second",
) {
  const scope = {
      productId: fixture.productId,
      draftId: fixture.draftId!,
      revision,
    },
    s = source(name),
    response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === previewApiPath(scope) &&
        r.request().method() === "GET",
    );
  await page.goto(previewPagePath(scope));
  const entry = previewEntryResponseSchema.parse(
    await (await response).json(),
  ).value;
  expect(entry.binding.revision).toBe(revision);
  expect(entry.binding.canonicalContentSha256).toBe(s.canonicalContentSha256);
  expect(entry.binding.assetSetSha256).toBe(s.assetSetSha256);
  await expect(page.locator('[data-preview-state="cover"] img')).toBeVisible();
  await page.getByRole("button", { name: "开始预览", exact: true }).click();
  const witness = s.witnesses[0]!;
  for (let i = 0; i < entry.questions.length; i++) {
    const q = entry.questions[i]!,
      chosen = witness.answers.find((a) => a.questionId === q.id)!.optionId;
    await page
      .getByRole("radio")
      .nth(q.options.findIndex((o) => o.id === chosen))
      .check();
    if (i < entry.questions.length - 1)
      await page.getByRole("button", { name: "下一题", exact: true }).click();
  }
  const scored = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === previewApiPath(scope, "score") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "揭晓结果", exact: true }).click();
  const reveal = previewRevealResponseSchema.parse(
    await (await scored).json(),
  ).value;
  expect(reveal.binding).toEqual(entry.binding);
  expect(reveal.selectedResultRef.id).toBe(witness.resultId);
  await expect(page.locator('[data-preview-state="result"] img')).toBeVisible();
  return JSON.stringify({
    answersHash: reveal.answersHash,
    logicHash: reveal.logicHash,
    result: reveal.selectedResultRef,
    report: reveal.report,
    portrait: reveal.result.portrait,
  });
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await command("prepare");
  fixture = await readFixture();
  prepared = true;
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) allPassed = false;
});
test.afterAll(async () => {
  test.setTimeout(90_000);
  if (prepared && allPassed) await command("finish");
});

test("read-only access has no append action, resolves without write capability and executes fixed r1 scoring", async ({
  page,
}, info) => {
  const denied = await page.request.get(draftEndpoint(fixture.productId));
  expect(denied.status()).toBe(401);
  await signIn(page, "readOnly");
  await openSource(page, "second", 1);
  await expect(
    appendPanel(page).getByRole("button", {
      name: "基于修订 1 准备追加",
      exact: true,
    }),
  ).toHaveCount(0);
  await screenshot(page, info, "read-only-r1");
  const tuple = binding(source("second"), fixture.initial!),
    auth = await headers(page),
    body = {
      idempotencyKey: tuple.idempotencyKey,
      expectedValidationStateRevision: tuple.expectedValidationStateRevision,
      expectedCandidateSha256: tuple.expectedCandidateSha256,
      target: tuple.target,
    };
  const append = await page.request.post(appendRevisionEndpoint(tuple), {
    headers: auth,
    data: body,
  });
  expect(append.status()).toBe(403);
  expect((await append.json()).code).toBe("CAPABILITY_DENIED");
  const resolved = await page.request.post(
    resolveRevisionEndpoint(fixture.productId),
    { headers: auth, data: tuple },
  );
  expect(resolved.status()).toBe(200);
  expect(draftRevisionResolutionSchema.parse(await resolved.json()).kind).toBe(
    "unresolved",
  );
  initialScore = await preview(page, 1, "initial");
  await screenshot(page, info, "original-r1-result");
  expect((await current(page)).revision).toBe(1);
});
test("legacy anchors and corrupt revision storage block new preparation while server history remains readable", async ({
  page,
}, info) => {
  await signIn(page);
  const s = source("initial"),
    legacy = {
      ...s.scope,
      idempotencyKey: fixture.initialIdempotencyKey!,
      expectedValidationStateRevision: s.expectedValidationStateRevision,
      expectedCandidateSha256: s.expectedCandidateSha256,
      target: { kind: "new-draft" },
    };
  await page.evaluate(
    ({ key, tuple }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: key,
          entries: [{ tuple, mayHaveBeenSent: true }],
        }),
      ),
    { key: DRAFT_PENDING_STORAGE_KEY, tuple: legacy },
  );
  await openSource(page, "second", 1);
  await expect(
    appendPanel(page).getByRole("button", {
      name: "基于修订 1 准备追加",
      exact: true,
    }),
  ).toHaveCount(0);
  await screenshot(page, info, "legacy-anchor-blocked");
  await page
    .getByRole("region", { name: "首次草稿应用", exact: true })
    .getByRole("button", { name: "核对原 key 回执", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(sessionStorage.getItem(key) ?? '{"entries":[]}').entries
            .length,
        DRAFT_PENDING_STORAGE_KEY,
      ),
    )
    .toBe(0);
  await appendPanel(page)
    .getByRole("button", { name: "重新读取追加基准", exact: true })
    .click();
  await expect(
    appendPanel(page).getByRole("button", {
      name: "基于修订 1 准备追加",
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(
    (key) => sessionStorage.setItem(key, "{broken"),
    REVISION_PENDING_STORAGE_KEY,
  );
  await page.reload();
  await expect(
    page.getByRole("region", { name: "首次草稿应用", exact: true }),
  ).toBeVisible();
  await expect(
    appendPanel(page).getByRole("heading", {
      name: "本次读取的当前基准：修订 1",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    pendingPanel(page).getByText("无法可靠核对请求锚点", { exact: false }),
  ).toBeVisible();
  await expect(
    appendPanel(page).getByRole("button", {
      name: "基于修订 1 准备追加",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto(draftWorkspacePath(fixture.productId));
  await expect(
    historyPanel(page).locator('[data-history-revision="1"]'),
  ).toBeVisible();
  await screenshot(page, info, "corrupt-anchor-history-readable");
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      REVISION_PENDING_STORAGE_KEY,
    ),
  ).toBe("{broken");
  // Controlled test storage recovery only; no sent request is discarded by the application.
  await page.evaluate(
    (key) => sessionStorage.removeItem(key),
    REVISION_PENDING_STORAGE_KEY,
  );
  expect((await current(page)).revision).toBe(1);
  await openSource(page, "second", 1);
  await confirm(page, 1);
  await page
    .getByRole("button", { name: "读取最新验证详情", exact: true })
    .click();
  await expect(
    appendPanel(page).getByRole("region", {
      name: "确认追加不可变修订",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    appendPanel(page).getByRole("button", {
      name: "基于修订 1 准备追加",
      exact: true,
    }),
  ).toBeVisible();
});
test("actual second append survives lost response and source503/404; original key resolves fixed r2", async ({
  page,
}, info) => {
  await signIn(page);
  await openSource(page, "second", 1);
  await confirm(page, 1);
  await screenshot(page, info, "append-r2-confirmation");
  let intercepted = 0;
  await page.route(
    `**${appendRevisionEndpoint(binding(source("second"), fixture.initial!))}`,
    async (route) => {
      intercepted++;
      const response = await route.fetch({ maxRetries: 0 });
      r2 = appendDraftResultSchema.parse(await response.json()).application;
      expect(response.status()).toBe(201);
      await route.abort("failed");
    },
  );
  await appendPanel(page)
    .getByRole("button", { name: "确认追加不可变修订", exact: true })
    .click();
  await expect(
    pendingPanel(page).getByRole("button", {
      name: "核实追加原请求",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    appendPanel(page).getByText("本次提交未收到可确认的成功回执。", {
      exact: false,
    }),
  ).toBeVisible();
  expect(intercepted).toBe(1);
  expect((await pending(page))?.mayHaveBeenSent).toBe(true);
  expect((await current(page)).revision).toBe(2);
  await page.unrouteAll({ behavior: "wait" });
  const mutableSourcePath = `/api/studio/products/${fixture.productId}/imports/${source("second").scope.sourceImportId}/validations/${source("second").scope.sourceValidationId}`;
  await page.route(`**${mutableSourcePath}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "STUDIO_UNAVAILABLE",
        requestId: randomUUID(),
      }),
    }),
  );
  await page.reload();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(
    pendingPanel(page).getByRole("button", {
      name: "核实追加原请求",
      exact: true,
    }),
  ).toBeEnabled();
  expect((await resolve(page)).kind).toBe("applied");
  await screenshot(page, info, "source503-r2-fixed-receipt");
  await page.unrouteAll({ behavior: "wait" });
  const missing = `/studio/products/${fixture.productId}/imports/${source("second").scope.sourceImportId}/validations/${randomUUID()}`;
  await page.goto(missing);
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(
    appendPanel(page).getByRole("button", {
      name: "基于修订 2 准备追加",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    pendingPanel(page).getByRole("button", {
      name: "核实追加原请求",
      exact: true,
    }),
  ).toBeEnabled();
  const result = await resolve(page);
  expect(result.kind).toBe("applied");
  if (result.kind !== "applied") throw Error("EXPECTED_APPLIED_RECEIPT");
  expect(result.application.revision).toBe(2);
  expect(result.application).toEqual(r2);
  expect(await pending(page)).not.toBeNull();
  await screenshot(page, info, "source404-r2-fixed-receipt");
  await pendingPanel(page)
    .getByRole("button", { name: "解除已确认成功的本地锚点", exact: true })
    .click();
  await expect.poll(() => pending(page)).toBeNull();
  await expect(
    appendPanel(page).getByRole("region", {
      name: "已确认的固定追加回执",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    appendPanel(page).getByRole("heading", {
      name: "本次读取的当前基准：修订 2",
      exact: true,
    }),
  ).toBeVisible();
});
test("another tab appends third to r3; old history anchor and original spare request remain fixed until explicit obsolete removal", async ({
  page,
}, info) => {
  if (!r2) throw Error("R2_RECEIPT_REQUIRED");
  await signIn(page);
  await openSource(page, "spare", 2);
  await confirm(page, 2);
  await page.route(
    `**${appendRevisionEndpoint(binding(source("spare"), r2))}`,
    (route) => route.abort("failed"),
  );
  await appendPanel(page)
    .getByRole("button", { name: "确认追加不可变修订", exact: true })
    .click();
  await expect(
    pendingPanel(page).getByRole("button", {
      name: "核实追加原请求",
      exact: true,
    }),
  ).toBeVisible();
  const original = await pending(page);
  if (!original) throw Error("SPARE_ANCHOR_REQUIRED");
  expect(original.tuple.target.expectedRevision).toBe(2);
  await page.unrouteAll({ behavior: "wait" });
  const history = await page.context().newPage();
  await history.goto(draftWorkspacePath(fixture.productId));
  await historyPanel(history).getByLabel("每页条数").selectOption("1");
  await expect(
    historyPanel(history).locator('[data-history-revision="2"]'),
  ).toBeVisible();
  await expect(
    historyPanel(history).locator("[data-history-revision]"),
  ).toHaveCount(1);
  const writer = await page.context().newPage();
  await openSource(writer, "third", 2);
  await confirm(writer, 2);
  const posted = writer.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
        appendRevisionEndpoint(binding(source("third"), r2!)) &&
      r.request().method() === "POST",
  );
  await appendPanel(writer)
    .getByRole("button", { name: "确认追加不可变修订", exact: true })
    .click();
  const response = await posted;
  expect(response.status()).toBe(201);
  r3 = appendDraftResultSchema.parse(await response.json()).application;
  expect(r3.revision).toBe(3);
  await expect(
    appendPanel(writer).getByRole("region", {
      name: "已确认的固定追加回执",
      exact: true,
    }),
  ).toBeVisible();
  // The immutable receipt is independent from the asynchronous current-head refresh.
  await expect(
    appendPanel(writer).getByRole("heading", {
      name: "本次读取的当前基准：修订 3",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    appendPanel(writer).getByText("正在核对当前草稿和工作区状态…", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    pendingPanel(writer).getByText(
      "此浏览器会话没有此工作区的待确认追加请求。",
      { exact: true },
    ),
  ).toBeVisible();
  await screenshot(writer, info, "r3-confirmed-fixed-receipt");
  await history
    .getByRole("button", { name: "读取服务器草稿", exact: true })
    .click();
  await expect(
    historyPanel(history).getByText("当前摘要读到修订 3。", { exact: false }),
  ).toBeVisible();
  await expect(
    historyPanel(history).locator('[data-history-revision="3"]'),
  ).toHaveCount(0);
  await historyPanel(history)
    .getByRole("button", { name: "读取更早修订", exact: true })
    .click();
  await expect(
    historyPanel(history).locator('[data-history-revision="1"]'),
  ).toBeVisible();
  await expect(
    historyPanel(history).locator("[data-history-revision]"),
  ).toHaveCount(2);
  await screenshot(history, info, "stable-anchor2-current3");
  await historyPanel(history)
    .getByRole("button", { name: "重新读取历史（新上界）", exact: true })
    .click();
  await expect(
    historyPanel(history).locator('[data-history-revision="3"]'),
  ).toBeVisible();
  await history.close();
  await writer.close();
  const replay = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === appendRevisionEndpoint(original.tuple) &&
      r.request().method() === "POST",
  );
  await pendingPanel(page)
    .getByRole("button", { name: "明确按原追加请求重放", exact: true })
    .click();
  const refusal = await replay;
  expect(refusal.status()).toBe(409);
  expect((await refusal.json()).code).toBe("DRAFT_BASE_CONFLICT");
  expect((await pending(page))?.tuple).toEqual(original.tuple);
  const result = await resolve(page);
  expect(result.kind).toBe("not-applied-obsolete");
  expect(await pending(page)).not.toBeNull();
  await expect(
    appendPanel(page).getByText(
      "本次提交未收到可确认的成功回执。请保留原 key 和完整基准，并以原请求核实区的最新证据为准。",
      { exact: true },
    ),
  ).toBeVisible();
  await screenshot(page, info, "obsolete-original-base2");
  await clearTerminal(page);
  expect((await current(page)).revision).toBe(3);
});
test("both permanent source-used proofs permit explicit local recovery without creating a fourth revision; old first key stays r1", async ({
  page,
}, info) => {
  await signIn(page);
  for (const [name, reason] of [
    ["third", "source-import"],
    ["alias-initial", "canonical-manifest"],
  ] as const) {
    await openSource(page, name, 3);
    await confirm(page, 3);
    const posted = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          appendRevisionEndpoint(binding(source(name), r3!)) &&
        r.request().method() === "POST",
    );
    await appendPanel(page)
      .getByRole("button", { name: "确认追加不可变修订", exact: true })
      .click();
    const response = await posted;
    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe("DRAFT_SOURCE_ALREADY_APPLIED");
    await expect(
      pendingPanel(page).getByRole("button", {
        name: "核实追加原请求",
        exact: true,
      }),
    ).toBeVisible();
    const result = await resolve(page);
    expect(result.kind).toBe("not-applied-source-used");
    if (result.kind !== "not-applied-source-used")
      throw Error("SOURCE_USED_REQUIRED");
    expect(result.proof.reason).toBe(reason);
    expect(result.proof.consumed.revision).toBe(name === "third" ? 3 : 1);
    expect(await pending(page)).not.toBeNull();
    await screenshot(page, info, `source-used-${reason}`);
    await clearTerminal(page);
    expect((await current(page)).revision).toBe(3);
  }
  const auth = await headers(page),
    initial = source("initial"),
    firstPath = `/api/studio/products/${fixture.productId}/imports/${initial.scope.sourceImportId}/validations/${initial.scope.sourceValidationId}/apply`;
  const old = await page.request.post(firstPath, {
    headers: auth,
    data: {
      idempotencyKey: fixture.initialIdempotencyKey,
      expectedValidationStateRevision: initial.expectedValidationStateRevision,
      expectedCandidateSha256: initial.expectedCandidateSha256,
      target: { kind: "new-draft" },
    },
  });
  expect(old.status()).toBe(200);
  const first = await old.json();
  expect(first.created).toBe(false);
  expect(draftApplicationDtoSchema.parse(first.application).revision).toBe(1);
  const collision = binding(
    source("spare"),
    r3!,
    fixture.initialIdempotencyKey!,
  );
  const conflict = await page.request.post(appendRevisionEndpoint(collision), {
    headers: auth,
    data: {
      idempotencyKey: collision.idempotencyKey,
      expectedValidationStateRevision:
        collision.expectedValidationStateRevision,
      expectedCandidateSha256: collision.expectedCandidateSha256,
      target: collision.target,
    },
  });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).code).toBe("IDEMPOTENCY_CONFLICT");
  expect((await current(page)).revision).toBe(3);
});
test("fixed r1/r2 content, actual scoring and private resources survive two later revisions; read-only history stays usable", async ({
  page,
}, info) => {
  await signIn(page, "readOnly");
  if (!initialScore) throw Error("INITIAL_SCORE_REQUIRED");
  const response = await page.request.get(
    draftRevisionEndpoint(fixture.productId, fixture.draftId!, 1),
  );
  expect(response.status()).toBe(200);
  const original = await checkDraftRevision(await response.json(), {
    productId: fixture.productId,
    draftId: fixture.draftId!,
    revision: 1,
  });
  expect(original.draft).toEqual(fixture.initial);
  expect(await preview(page, 1, "initial")).toBe(initialScore);
  await screenshot(page, info, "retained-r1-result");
  await preview(page, 2, "second");
  await screenshot(page, info, "retained-r2-result");
  await page.goto(draftRevisionPath(fixture.productId, fixture.draftId!, 1));
  await page.getByText("固定修订完整正文与素材集合", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "完整内容正文", exact: true }),
  ).toHaveValue(original.canonicalContentText);
  await page.goto(draftWorkspacePath(fixture.productId));
  await expect(
    historyPanel(page).locator("[data-history-revision]"),
  ).toHaveCount(3);
  await screenshot(page, info, "read-only-final-history");
});
test("late resolve after navigation cannot replace a newer local anchor, and identity failure cannot expose a clear action", async ({
  page,
}) => {
  await signIn(page);
  await openSource(page, "alias-initial", 3);
  await confirm(page, 3);
  await appendPanel(page)
    .getByRole("button", { name: "确认追加不可变修订", exact: true })
    .click();
  await expect(
    pendingPanel(page).getByRole("button", {
      name: "核实追加原请求",
      exact: true,
    }),
  ).toBeVisible();
  const original = await pending(page);
  if (!original) throw Error("ALIAS_ANCHOR_REQUIRED");
  let release: (() => void) | undefined, seen: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await page.route(
    `**${resolveRevisionEndpoint(fixture.productId)}`,
    async (route) => {
      const response = await route.fetch({ maxRetries: 0 });
      seen!();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await route.fulfill({ response });
      } catch {
        /* Abort is not evidence of server non-execution. */
      }
    },
  );
  await pendingPanel(page)
    .getByRole("button", { name: "核实追加原请求", exact: true })
    .click();
  await received;
  // Controlled storage change models another local intent while the old component is gone.
  await page.goto(draftWorkspacePath(fixture.productId));
  const newer = { ...original.tuple, idempotencyKey: randomUUID() };
  await page.evaluate(
    ({ key, tuple }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: key,
          entries: [{ tuple, mayHaveBeenSent: true }],
        }),
      ),
    { key: REVISION_PENDING_STORAGE_KEY, tuple: newer },
  );
  await pendingPanel(page)
    .getByRole("button", { name: "重新读取追加锚点", exact: true })
    .click();
  release!();
  await page.unrouteAll({ behavior: "wait" });
  expect((await pending(page))?.tuple).toEqual(newer);
  await expect(
    pendingPanel(page).locator("[data-revision-resolution]"),
  ).toHaveCount(0);
  await page.context().clearCookies();
  const failed = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === resolveRevisionEndpoint(fixture.productId),
  );
  await pendingPanel(page)
    .getByRole("button", { name: "核实追加原请求", exact: true })
    .click();
  expect((await failed).status()).toBe(401);
  await expect(
    pendingPanel(page).getByRole("button", {
      name: "移除已失效原请求并重新准备",
      exact: true,
    }),
  ).toHaveCount(0);
  expect((await pending(page))?.tuple).toEqual(newer);
});
