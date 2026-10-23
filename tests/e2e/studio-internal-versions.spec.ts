import { test, expect, type Page } from "@playwright/test";
import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  INTERNAL_VERSION_FIXTURE_PRIVATE_NAME,
  INTERNAL_VERSION_FIXTURE_MAX_BYTES,
  internalVersionFixtureSchema,
  type InternalVersionFixture,
} from "../db/p3e-internal-version-fixture-contract";
import {
  internalReviewUrl,
  internalReviewResolveUrl,
  internalVersionResolveUrl,
  internalVersionsUrl,
  internalVersionUrl,
  internalReviewPageUrl,
} from "../../src/features/product/internal-versions/urls";
import {
  internalVersionListResponseSchema,
  internalVersionDetailResponseSchema,
  internalReviewStateResponseSchema,
  internalReviewResolutionResponseSchema,
  internalVersionResolutionResponseSchema,
  type InternalReviewReceipt,
  type InternalVersionReceipt,
} from "../../src/features/product/internal-versions/contracts";
import { verifyInternalVersionDetail } from "../../src/features/product/internal-versions/integrity";
import {
  internalVersionsPageUrl,
  internalVersionPageUrl,
} from "../../src/features/studio/internal-versions/paths";
import { type InternalRequest } from "../../src/features/studio/internal-versions/request";
import { appendRevisionEndpoint } from "../../src/features/studio/draft-revisions/urls";
import {
  appendDraftResultSchema,
  type AppendDraftBinding,
} from "../../src/features/product/draft-revisions/contracts";
import {
  signInInternalOperator,
  internalGet,
  internalPost,
  internalRouteFetch,
  fulfillInternalResponse,
  internalPanel,
  internalPending,
  installInternalPending,
  captureInternalWidths,
} from "./studio-internal-versions.ui";
import { InternalSuiteCompletion } from "./studio-internal-versions.completion";
import {
  checkReviewResolution,
  checkVersionResolution,
} from "../../src/features/studio/internal-versions/client";
import { exerciseInternalWriteUnknown } from "./studio-internal-versions.lifecycle";

const CASES = [
  "record exact synthetic r1 once, retain UNKNOWN anchor and resolve after detail GET error",
  "seal exact r1 once, retain UNKNOWN anchor and verify actual fixed snapshot/list",
  "read-only actor resolves original receipts and clears only local anchors while write replay is403",
  "unregistered r2 append creates no baseline approval; original r1 receipts and historical metadata survive",
  "late real resolve cannot accept old evidence or delete a replacement original key",
  "shared Product authority rejects late proof after GET401, cross-panel403 or CSRF; ordinary404 preserves recovery",
] as const;
const completion = new InternalSuiteCompletion(CASES);

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
let fixture: InternalVersionFixture,
  prepared = false,
  review: InternalReviewReceipt | undefined,
  version: InternalVersionReceipt | undefined;
const execute = promisify(execFile),
  helper = path.resolve("tests/db/p3e-internal-version-fixture.ts");
function runId() {
  const value = process.env.QF_INTERNAL_VERSION_E2E_RUN_ID;
  if (
    !value ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    throw Error("INTERNAL_VERSION_OWNER_RUN_ID_REQUIRED");
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
        timeout: 90_000,
        maxBuffer: 4096,
      },
    );
  } catch {
    throw Error("INTERNAL_VERSION_E2E_FIXTURE_FAILED");
  }
}
async function readFixture() {
  try {
    const configFile = process.env.QUIZFORGE_P2A_CONFIG;
    if (!configFile || !path.isAbsolute(configFile)) throw Error();
    const directory = path.dirname(configFile),
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
      path.join(directory, INTERNAL_VERSION_FIXTURE_PRIVATE_NAME),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const st = await file.stat();
      if (
        !st.isFile() ||
        st.nlink !== 1 ||
        (st.mode & 0o777) !== 0o600 ||
        st.uid !== process.getuid?.() ||
        st.size > INTERNAL_VERSION_FIXTURE_MAX_BYTES
      )
        throw Error();
      const bytes = Buffer.alloc(INTERNAL_VERSION_FIXTURE_MAX_BYTES + 1);
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
        length > INTERNAL_VERSION_FIXTURE_MAX_BYTES ||
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
      const value = internalVersionFixtureSchema.parse(
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
        !value.target ||
        !value.initial ||
        !value.draftId ||
        !value.baseline ||
        !value.renderer ||
        !value.engine ||
        value.review ||
        value.versionDetail
      )
        throw Error();
      return value;
    } finally {
      await file.close();
    }
  } catch {
    throw Error("INTERNAL_VERSION_E2E_FIXTURE_UNAVAILABLE");
  }
}
const scope = () => ({
  productId: fixture.productId,
  draftId: fixture.draftId!,
  revision: 1,
});
async function signIn(page: Page, role: "operator" | "readOnly" = "operator") {
  await signInInternalOperator(page, fixture[role].secret);
}
function original(operation: "review" | "seal"): InternalRequest {
  if (operation === "review" && review)
    return { operation, tuple: review.binding };
  if (operation === "seal" && version)
    return { operation, tuple: version.binding };
  throw Error("INTERNAL_VERSION_E2E_ORIGINAL_RECEIPT_REQUIRED");
}
test.beforeAll(async () => {
  // Auth-budget coordination may legitimately wait61s before preparing any business data.
  test.setTimeout(120_000);
  await command("prepare"); // execFile resolves only after the actual child exits.
  prepared = true;
  fixture = await readFixture();
});
test.afterEach(async ({}, info) => {
  completion.observe(info);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  if (prepared) {
    if (!completion.canFinish())
      throw Error("INTERNAL_VERSION_E2E_FULL_SUITE_REQUIRED");
    await command("finish");
  }
}); // Actual exit/cleanup belongs exclusively to root.

test(CASES[0], async ({ page }, info) => {
  await signIn(page);
  const result = await exerciseInternalWriteUnknown(
    page,
    scope(),
    "review",
    info,
  );
  if (result.operation !== "review" || result.value.kind !== "recorded")
    throw Error("INTERNAL_VERSION_E2E_REVIEW_REQUIRED");
  review = result.value.review;
  expect(review.binding.target).toEqual(fixture.target);
  expect(review.binding.baseline).toEqual(fixture.baseline);
  expect(review.recordedBy).toBe(fixture.operator.identifier);
  expect(review.facts.approval.kind).toBe("synthetic-test");
  await page.goto(internalReviewPageUrl(scope()));
  await expect(
    page.getByRole("heading", {
      name: "合成测试证据（非作者批准）",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("不适用：合成测试不表示作者批准", { exact: true }),
  ).toBeVisible();
  await captureInternalWidths(page, info, "review-recorded");
});
test(CASES[1], async ({ page }, info) => {
  await signIn(page);
  const result = await exerciseInternalWriteUnknown(
    page,
    scope(),
    "seal",
    info,
  );
  if (result.operation !== "seal" || result.value.kind !== "sealed")
    throw Error("INTERNAL_VERSION_E2E_SEAL_REQUIRED");
  version = result.value.version;
  expect(version.binding.renderer).toEqual(fixture.renderer);
  expect(version.binding.engine).toEqual(fixture.engine);
  expect(version.binding.reviewId).toBe(review!.id);
  expect(version.publicationApproved).toBe(false);
  const response = await internalGet(
    page,
    internalVersionUrl(fixture.productId, version.id),
  );
  expect(response.status()).toBe(200);
  const detail = await verifyInternalVersionDetail(
    internalVersionDetailResponseSchema.parse(await response.json()).value,
  );
  expect(detail.version).toEqual(version);
  expect(detail.snapshot.target).toEqual(fixture.target);
  const listResponse = await internalGet(
    page,
    internalVersionsUrl(fixture.productId),
  );
  const list = internalVersionListResponseSchema.parse(
    await listResponse.json(),
  ).value;
  expect(list.versions).toHaveLength(1);
  expect(list.versions[0]!.snapshotSha256).toBe(version.snapshotSha256);
  expect(Object.keys(list.versions[0]!)).not.toContain("binding");
  await page.goto(internalVersionPageUrl(fixture.productId, version.id));
  await expect(
    page.locator(`[data-internal-version="${version.id}"]`),
  ).toBeVisible();
  await captureInternalWidths(page, info, "sealed-detail");
});
test(CASES[2], async ({ page }, info) => {
  await signIn(page, "readOnly");
  await page.goto(internalVersionsPageUrl(fixture.productId));
  for (const operation of ["review", "seal"] as const) {
    const request = original(operation);
    await installInternalPending(page, request);
    await page.reload();
    const panel = internalPanel(page, operation),
      label = operation === "review" ? "审核依据记录" : "内容版本固定";
    await expect(
      panel.getByRole("button", { name: `核实${label}原操作`, exact: true }),
    ).toBeEnabled();
    await expect(
      panel.getByRole("button", {
        name: `再次发送原${label}请求再次发送原操作`,
        exact: true,
      }),
    ).toHaveCount(0);
    await panel
      .getByRole("button", { name: `核实${label}原操作`, exact: true })
      .click();
    await expect(
      panel.locator(
        `[data-internal-resolution="${operation === "review" ? "recorded" : "sealed"}"]`,
      ),
    ).toBeVisible();
    expect(
      (await internalPending(page, operation, fixture.productId))?.tuple,
    ).toEqual(request.tuple);
    const { productId, ...input } = request.tuple;
    expect(productId).toBe(fixture.productId);
    const denied = await internalPost(
      page,
      operation === "review"
        ? internalReviewUrl(scope())
        : internalVersionsUrl(fixture.productId),
      input,
    );
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "CAPABILITY_DENIED" });
    await captureInternalWidths(page, info, `readonly-${operation}-resolved`);
    await panel
      .getByRole("button", {
        name: "确认处理结果并结束此操作记录",
        exact: true,
      })
      .click();
    await expect
      .poll(() => internalPending(page, operation, fixture.productId))
      .toBeNull();
  }
});
test(CASES[3], async ({ page }, info) => {
  await signIn(page);
  const next = fixture.sources.find((s) => s.name === "next")!;
  const binding: AppendDraftBinding = {
    ...next.scope,
    idempotencyKey: randomUUID(),
    expectedValidationStateRevision: next.expectedValidationStateRevision,
    expectedCandidateSha256: next.expectedCandidateSha256,
    target: {
      kind: "append-revision",
      draftId: fixture.draftId!,
      expectedRevision: 1,
      expectedCanonicalContentSha256: fixture.target!.canonicalContentSha256,
      expectedAssetSetSha256: fixture.target!.assetSetSha256,
    },
  };
  const { productId, sourceImportId, sourceValidationId, ...input } = binding;
  expect(productId).toBe(fixture.productId);
  expect(sourceImportId).toBe(next.scope.sourceImportId);
  expect(sourceValidationId).toBe(next.scope.sourceValidationId);
  const response = await internalPost(
    page,
    appendRevisionEndpoint(binding),
    input,
  );
  expect(response.status()).toBe(201);
  expect(
    appendDraftResultSchema.parse(await response.json()).application.revision,
  ).toBe(2);
  const r2 = { ...scope(), revision: 2 },
    stateResponse = await internalGet(page, internalReviewUrl(r2));
  const state = internalReviewStateResponseSchema.parse(
    await stateResponse.json(),
  ).value;
  expect(state.baseline).toBeNull();
  expect(state.review).toBeNull();
  await page.goto(internalReviewPageUrl(r2));
  await expect(
    page.getByText(
      "此修订尚无匹配的已登记审核依据，暂不能记录。请先完成所需的内容与素材审核；此页面不能代为批准。",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await captureInternalWidths(page, info, "unregistered-r2");
  for (const operation of ["review", "seal"] as const) {
    const request = original(operation),
      resolve =
        operation === "review"
          ? internalReviewResolveUrl
          : internalVersionResolveUrl;
    const old = await internalPost(
      page,
      resolve(fixture.productId),
      request.tuple,
    );
    expect(old.status()).toBe(200);
    const value =
      operation === "review"
        ? internalReviewResolutionResponseSchema.parse(await old.json()).value
        : internalVersionResolutionResponseSchema.parse(await old.json()).value;
    expect(value.kind).toBe(operation === "review" ? "recorded" : "sealed");
    const absent: InternalRequest =
      request.operation === "review"
        ? {
            operation: "review",
            tuple: { ...request.tuple, idempotencyKey: randomUUID() },
          }
        : {
            operation: "seal",
            tuple: { ...request.tuple, idempotencyKey: randomUUID() },
          };
    await installInternalPending(page, absent);
    await page.reload();
    const panel = internalPanel(page, operation);
    await panel
      .getByRole("button", {
        name:
          operation === "review"
            ? "查询审核依据记录结果"
            : "查询内容版本固定结果",
        exact: true,
      })
      .click();
    await expect(
      panel.locator(
        `[data-internal-resolution="${operation === "review" ? "not-recorded-obsolete" : "not-sealed-obsolete"}"]`,
      ),
    ).toBeVisible();
    expect(
      (await internalPending(page, operation, fixture.productId))?.tuple,
    ).toEqual(absent.tuple);
    await captureInternalWidths(page, info, `${operation}-obsolete`);
    await panel
      .getByRole("button", {
        name: "确认处理结果并结束此操作记录",
        exact: true,
      })
      .click();
    await expect
      .poll(() => internalPending(page, operation, fixture.productId))
      .toBeNull();
  }
  await page.goto(internalVersionsPageUrl(fixture.productId));
  await expect(
    page.getByText("历史修订的固定内测内容版本", { exact: true }),
  ).toBeVisible();
  await captureInternalWidths(page, info, "historical-list");
  const detail = await internalGet(
    page,
    internalVersionUrl(fixture.productId, version!.id),
  );
  expect(
    (
      await verifyInternalVersionDetail(
        internalVersionDetailResponseSchema.parse(await detail.json()).value,
      )
    ).version.snapshotSha256,
  ).toBe(version!.snapshotSha256);
});
test(CASES[4], async ({ page }) => {
  await signIn(page, "readOnly");
  await page.goto(internalVersionsPageUrl(fixture.productId));
  const request = original("review");
  if (request.operation !== "review")
    throw Error("INTERNAL_VERSION_E2E_REVIEW_REQUIRED");
  await installInternalPending(page, request);
  await page.reload();
  let release!: () => void,
    captured = false,
    delivered = false,
    intercepted = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const resolvePath = internalReviewResolveUrl(fixture.productId);
  await page.route(
    `**${resolvePath}`,
    async (route) => {
      intercepted++;
      expect(intercepted).toBe(1);
      const actual = await internalRouteFetch(route);
      expect(actual.status()).toBe(200);
      await checkReviewResolution(
        internalReviewResolutionResponseSchema.parse(await actual.json()).value,
        request.tuple,
      );
      captured = true;
      await gate;
      await fulfillInternalResponse(route, actual);
      delivered = true;
    },
    { times: 1 },
  ); // Only the original response is held/checked against the old binding.
  try {
    const panel = internalPanel(page, "review");
    await panel
      .getByRole("button", { name: "查询审核依据记录结果", exact: true })
      .click();
    await expect.poll(() => captured).toBe(true);
    const replacement = {
      operation: "review" as const,
      tuple: { ...request.tuple, idempotencyKey: randomUUID() },
    };
    await installInternalPending(page, replacement);
    release();
    await expect.poll(() => delivered).toBe(true);
    await expect(
      panel.getByText("正在核实或处理原操作…", { exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", {
        name: "重新检查审核依据操作记录",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      panel.locator('[data-internal-resolution="recorded"]'),
    ).toHaveCount(0);
    expect(
      (await internalPending(page, "review", fixture.productId))?.tuple,
    ).toEqual(replacement.tuple);
    await panel
      .getByRole("button", {
        name: "重新检查审核依据操作记录",
        exact: true,
      })
      .click();
    await panel
      .getByRole("button", { name: "查询审核依据记录结果", exact: true })
      .click();
    await expect(
      panel.locator('[data-internal-resolution="not-recorded-obsolete"]'),
    ).toBeVisible();
    await panel
      .getByRole("button", {
        name: "确认处理结果并结束此操作记录",
        exact: true,
      })
      .click();
    await expect
      .poll(() => internalPending(page, "review", fixture.productId))
      .toBeNull();
    expect(intercepted).toBe(1); // Replacement went to the real service with its own binding.
  } finally {
    release();
    await page.unroute(`**${resolvePath}`);
  }
});

test(CASES[5], async ({ page }, info) => {
  await signIn(page);
  for (const scenario of [
    "get401",
    "other-panel403",
    "csrf403",
    "get404",
  ] as const) {
    await page.goto(internalReviewPageUrl(scope()));
    for (const operation of ["review", "seal"] as const)
      await installInternalPending(page, original(operation));
    await page.reload();
    const reviewPanel = internalPanel(page, "review"),
      sealPanel = internalPanel(page, "seal");
    let release!: () => void,
      captured = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holdSeal = async (route: import("@playwright/test").Route) => {
      const actual = await internalRouteFetch(route);
      expect(actual.status()).toBe(200);
      await checkVersionResolution(
        internalVersionResolutionResponseSchema.parse(await actual.json())
          .value,
        version!.binding,
      );
      captured = true;
      await gate;
      await fulfillInternalResponse(route, actual);
    };
    await page.route(
      `**${internalVersionResolveUrl(fixture.productId)}`,
      holdSeal,
    );
    try {
      await sealPanel
        .getByRole("button", { name: "查询内容版本固定结果", exact: true })
        .click();
      await expect.poll(() => captured).toBe(true);
      if (scenario === "other-panel403" || scenario === "csrf403") {
        await page.route(
          `**${internalReviewResolveUrl(fixture.productId)}`,
          (route) =>
            route.fulfill({
              status: 403,
              contentType: "application/json",
              body: JSON.stringify({
                code:
                  scenario === "csrf403"
                    ? "CSRF_REJECTED"
                    : "CAPABILITY_DENIED",
                requestId: randomUUID(),
              }),
            }),
        );
        await reviewPanel
          .getByRole("button", { name: "查询审核依据记录结果", exact: true })
          .click();
      } else {
        const readFailure = async (route: import("@playwright/test").Route) => {
          if (route.request().method() !== "GET") {
            await route.continue();
            return;
          }
          await route.fulfill({
            status: scenario === "get401" ? 401 : 404,
            contentType: "application/json",
            body: JSON.stringify({
              code:
                scenario === "get401"
                  ? "UNAUTHENTICATED"
                  : "DRAFT_REVISION_NOT_FOUND",
              requestId: randomUUID(),
            }),
          });
        };
        await page.route(`**${internalReviewUrl(scope())}`, readFailure);
        await page.route(
          `**${internalVersionsUrl(fixture.productId)}`,
          readFailure,
        );
        await page
          .getByRole("button", {
            name: "重新读取修订事实与封存容量",
            exact: true,
          })
          .click();
      }
      await expect(page.getByRole("alert").first()).toBeVisible();
      release();
      // Wait until the delayed real200 has actually been processed; absence before arrival is not a regression proof.
      await expect(
        sealPanel.getByText("正在核实或处理原操作…", { exact: true }),
      ).toHaveCount(0);
      if (scenario === "get404") {
        await expect(
          sealPanel.locator('[data-internal-resolution="sealed"]'),
        ).toBeVisible();
        await expect(
          sealPanel.getByRole("button", {
            name: "确认处理结果并结束此操作记录",
            exact: true,
          }),
        ).toBeEnabled();
      } else {
        await expect(
          sealPanel.getByRole("button", {
            name: "查询内容版本固定结果",
            exact: true,
          }),
        ).toBeDisabled();
        await expect(
          reviewPanel.getByRole("button", {
            name: "查询审核依据记录结果",
            exact: true,
          }),
        ).toBeDisabled();
        await expect(
          sealPanel.locator('[data-internal-resolution="sealed"]'),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: "确认处理结果并结束此操作记录",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: /再次发送原.*请求再次发送原操作/ }),
        ).toHaveCount(0);
      }
      // The old valid response grants no local delete authority after any other component revokes the page.
      for (const operation of ["review", "seal"] as const)
        expect(
          (await internalPending(page, operation, fixture.productId))?.tuple,
        ).toEqual(original(operation).tuple);
      await captureInternalWidths(page, info, `authority-${scenario}`);
    } finally {
      release();
      await page.unroute(`**${internalVersionResolveUrl(fixture.productId)}`);
      await page.unroute(`**${internalReviewResolveUrl(fixture.productId)}`);
      await page.unroute(`**${internalReviewUrl(scope())}`);
      await page.unroute(`**${internalVersionsUrl(fixture.productId)}`);
    }
  }
});
