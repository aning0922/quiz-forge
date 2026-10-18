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
} from "./studio-internal-versions.ui";

async function preparedRequest(
  page: Page,
  operation: InternalOperation,
): Promise<InternalRequest> {
  const text = await page
    .getByRole("region", { name: "确认固定原请求", exact: true })
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
      name: "记录与封存准备",
      exact: true,
    }),
    prepare = write.getByRole("button", {
      name:
        operation === "review" ? "准备记录既有基线" : "准备封存固定内测版本",
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
    const response = await route.fetch();
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
        "本次提交未收到可确认的成功回执。请保留原 key 和完整目标，以原请求核实区的最新证据为准。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(writes).toBe(1);
    if (!proof) throw Error("INTERNAL_VERSION_E2E_REAL_WRITE_NOT_CONFIRMED");
    await captureInternalWidths(page, info, `${operation}-unknown`);
  } finally {
    await page.unroute(`**${path}`, hideCommittedResponse);
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
          operation === "review" ? "核实基线记录原请求" : "核实内测封存原请求",
        exact: true,
      }),
    ).toBeEnabled();
    await pending
      .getByRole("button", {
        name:
          operation === "review" ? "核实基线记录原请求" : "核实内测封存原请求",
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
      .getByRole("button", { name: "依核实证据解除本原请求锚点", exact: true })
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
