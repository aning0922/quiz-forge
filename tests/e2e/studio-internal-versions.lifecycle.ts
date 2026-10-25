import { expect, type Page, type Route, type TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  recordBaselineBindingSchema,
  sealInternalVersionBindingSchema,
} from "../../src/features/product/internal-versions/contracts";
import {
  internalReviewUrl,
  internalVersionsUrl,
  internalReviewPageUrl,
  type InternalRevisionScope,
} from "../../src/features/product/internal-versions/urls";
import {
  checkReviewResult,
  checkSealResult,
} from "../../src/features/studio/internal-versions/client";
import {
  evidenceFromWrite,
  type InternalEvidence,
} from "../../src/features/studio/internal-versions/flow";
import {
  freezeInternalRequest,
  type InternalOperation,
  type InternalRequest,
} from "../../src/features/studio/internal-versions/request";
import {
  captureInternalWidths,
  internalPanel,
  internalPending,
  internalRouteFetch,
  fulfillInternalResponse,
} from "./studio-internal-versions.ui";

async function preparedRequest(
  page: Page,
  operation: InternalOperation,
): Promise<InternalRequest> {
  const text = await page
    .getByRole("region", { name: "确认固定原操作", exact: true })
    .locator("pre")
    .textContent();
  if (!text) throw Error("INTERNAL_VERSION_E2E_CONFIRMATION_MISSING");
  const input: unknown = JSON.parse(text);
  return freezeInternalRequest(
    operation === "review"
      ? { operation, tuple: recordBaselineBindingSchema.parse(input) }
      : { operation, tuple: sealInternalVersionBindingSchema.parse(input) },
  );
}
/** Invoked once per operation by the root's serial persistent-fixture suite, after exact r1 setup.
 * The real server write completes once. Only its transport response is replaced by UNKNOWN.
 * No cleanup, fixture ownership, native process, DB connection or server-exit proof is created here.
 */
export async function exerciseInternalWriteUnknown(
  page: Page,
  scope: InternalRevisionScope,
  operation: InternalOperation,
  info: TestInfo,
): Promise<InternalEvidence> {
  await page.goto(internalReviewPageUrl(scope));
  const write = page.getByRole("region", {
      name: "记录审核依据与固定内容版本",
      exact: true,
    }),
    prepare = write.getByRole("button", {
      name:
        operation === "review"
          ? "准备记录已有审核依据"
          : "准备固定内测内容版本",
      exact: true,
    }),
    refresh = page.getByRole("button", {
      name: "重新读取修订事实与封存容量",
      exact: true,
    });
  if (operation === "seal") {
    const select = write.getByRole("combobox"),
      choices = select.locator("option");
    await expect.poll(() => choices.count()).toBeGreaterThan(1);
    await select.selectOption({ index: 1 });
  }
  await expect(prepare).toBeEnabled();
  await prepare.click();
  const old = await preparedRequest(page, operation);
  expect(await internalPending(page, operation, scope.productId)).toBeNull();
  await captureInternalWidths(page, info, `${operation}-confirmation`);
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(
    write.getByRole("button", { name: "确认并发送此固定请求", exact: true }),
  ).toBeDisabled();
  await expect(prepare).toBeEnabled();
  await prepare.click();
  const original = await preparedRequest(page, operation);
  expect(original.tuple.idempotencyKey).not.toBe(old.tuple.idempotencyKey);
  const path =
    operation === "review"
      ? internalReviewUrl(scope)
      : internalVersionsUrl(scope.productId);
  let proof: InternalEvidence | undefined,
    writes = 0;
  const hideCommittedResponse = async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    writes++;
    const response = await internalRouteFetch(route);
    expect(response.status()).toBe(201);
    const envelope: unknown = await response.json();
    proof =
      original.operation === "review"
        ? evidenceFromWrite({
            operation: "review",
            ...(await checkReviewResult(
              envelope,
              response.status(),
              original.tuple,
            )),
          })
        : evidenceFromWrite({
            operation: "seal",
            ...(await checkSealResult(
              envelope,
              response.status(),
              original.tuple,
            )),
          });
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "WRITE_OUTCOME_UNKNOWN",
        requestId: randomUUID(),
      }),
    });
  };
  await page.route(`**${path}`, hideCommittedResponse);
  try {
    await write
      .getByRole("button", { name: "确认并发送此固定请求", exact: true })
      .click();
    await expect
      .poll(() => internalPending(page, operation, scope.productId))
      .toEqual({ tuple: original.tuple, mayHaveBeenSent: true });
    await expect(
      write.getByText(
        "上次操作结果暂未确认，请先查询处理结果，确认前避免重复提交。原操作记录会保留；如需再次发送，须由你明确选择原操作。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(writes).toBe(1);
    if (!proof) throw Error("INTERNAL_VERSION_E2E_REAL_WRITE_NOT_CONFIRMED");
    await captureInternalWidths(page, info, `${operation}-unknown`);
  } finally {
    await page.unroute(`**${path}`, hideCommittedResponse);
  }
  // Explicit exact replay is a real second POST returning200, not another new write.
  const replayPanel = internalPanel(page, operation),
    label = operation === "review" ? "审核依据记录" : "内容版本固定";
  let replayPosts = 0;
  const replay = async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    replayPosts++;
    const response = await internalRouteFetch(route);
    expect(response.status()).toBe(200);
    const envelope: unknown = await response.json();
    const value =
      original.operation === "review"
        ? await checkReviewResult(envelope, 200, original.tuple)
        : await checkSealResult(envelope, 200, original.tuple);
    expect(value.created).toBe(false);
    await fulfillInternalResponse(route, response);
  };
  await page.route(`**${path}`, replay);
  try {
    await replayPanel
      .getByRole("button", {
        name: `再次发送原${label}请求再次发送原操作`,
        exact: true,
      })
      .click();
    await expect(
      replayPanel.locator(
        `[data-internal-resolution="${operation === "review" ? "recorded" : "sealed"}"]`,
      ),
    ).toBeVisible();
    expect(replayPosts).toBe(1);
    expect(await internalPending(page, operation, scope.productId)).toEqual({
      tuple: original.tuple,
      mayHaveBeenSent: true,
    });
    await captureInternalWidths(page, info, `${operation}-replayed`);
  } finally {
    await page.unroute(`**${path}`, replay);
  }
  // Break only the mutable detail GET. The real original-key resolve must remain usable.
  const breakDetail = async (route: Route) => {
    if (route.request().method() === "GET")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "STUDIO_UNAVAILABLE",
          requestId: randomUUID(),
        }),
      });
    else await route.continue();
  };
  const detailPath = internalReviewUrl(scope);
  await page.route(`**${detailPath}`, breakDetail);
  try {
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    const pending = internalPanel(page, operation),
      kind = operation === "review" ? "recorded" : "sealed";
    await expect(
      pending.getByRole("button", {
        name:
          operation === "review"
            ? "查询审核依据记录结果"
            : "查询内容版本固定结果",
        exact: true,
      }),
    ).toBeEnabled();
    await pending
      .getByRole("button", {
        name:
          operation === "review"
            ? "查询审核依据记录结果"
            : "查询内容版本固定结果",
        exact: true,
      })
      .click();
    await expect(
      pending.locator(`[data-internal-resolution="${kind}"]`),
    ).toBeVisible();
    expect(await internalPending(page, operation, scope.productId)).toEqual({
      tuple: original.tuple,
      mayHaveBeenSent: true,
    });
    await captureInternalWidths(
      page,
      info,
      `${operation}-resolved-detail-error`,
    );
    await pending
      .getByRole("button", {
        name: "确认处理结果并结束此操作记录",
        exact: true,
      })
      .click();
    await expect
      .poll(() => internalPending(page, operation, scope.productId))
      .toBeNull();
    expect(writes).toBe(1);
  } finally {
    await page.unroute(`**${detailPath}`, breakDetail);
  }
  return proof;
}
