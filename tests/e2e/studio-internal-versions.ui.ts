import { expect, type Page, type TestInfo } from "@playwright/test";
import { sampleStudioLayout, assertStudioLayout } from "./studio-layout";
import { waitForInternalCaptureReady } from "./studio-internal-versions.visual";
import { internalRevisionScopeSchema } from "../../src/features/product/internal-versions/urls";
import {
  INTERNAL_PENDING_KEYS,
  encodeInternalPending,
  readInternalPending,
} from "../../src/features/studio/internal-versions/storage";
import type {
  InternalOperation,
  InternalRequest,
} from "../../src/features/studio/internal-versions/request";

export const internalPanel = (page: Page, operation: InternalOperation) =>
  page.getByRole("region", {
    name:
      operation === "review" ? "审核依据记录操作查询" : "内容版本固定操作查询",
    exact: true,
  });
/** No locator.fill(secret), trace, screenshot, credential-bearing exception or request log. */
export async function signInInternalOperator(page: Page, secret: string) {
  await page.goto("/studio/login");
  await expect(page.getByLabel("运营凭证")).toBeEnabled();
  try {
    await page.evaluate((value) => {
      const input = document.getElementById("studio-credential"),
        setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
      if (!(input instanceof HTMLInputElement) || input.disabled || !setter)
        throw Error();
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, secret);
  } catch {
    throw Error("INTERNAL_VERSION_E2E_INPUT_UNAVAILABLE");
  }
  await page.getByRole("button", { name: "登录 Studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "工作台", exact: true }),
  ).toBeVisible();
}
export {
  internalGet,
  internalPost,
  internalRouteFetch,
  fulfillInternalResponse,
} from "./studio-internal-versions.network";

export async function internalPending(
  page: Page,
  operation: InternalOperation,
  productInput: string,
) {
  const productId =
      internalRevisionScopeSchema.shape.productId.parse(productInput),
    key = INTERNAL_PENDING_KEYS[operation];
  const text = await page.evaluate((key) => sessionStorage.getItem(key), key);
  return (
    readInternalPending(
      {
        getItem: () => text,
        setItem: () => {
          throw Error("INTERNAL_VERSION_E2E_READ_ONLY");
        },
      },
      operation,
    ).find((entry) => entry.tuple.productId === productId) ?? null
  );
}
/** Isolated UI recovery setup only; it never establishes server application evidence. */
export async function installInternalPending(
  page: Page,
  request: InternalRequest,
  mayHaveBeenSent = true,
) {
  const key = INTERNAL_PENDING_KEYS[request.operation],
    text = encodeInternalPending(request.operation, [
      { tuple: request.tuple, mayHaveBeenSent },
    ]);
  await page.evaluate(({ key, text }) => sessionStorage.setItem(key, text), {
    key,
    text,
  });
}
export async function captureInternalWidths(
  page: Page,
  info: TestInfo,
  state: string,
) {
  if (!/^[a-z0-9-]{1,80}$/.test(state))
    throw Error("INTERNAL_VERSION_E2E_SCREENSHOT_SCOPE");
  await waitForInternalCaptureReady(page, state);
  for (const width of [320, 375, 390, 430]) {
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.setViewportSize({ width, height: 900 });
    assertStudioLayout(
      await sampleStudioLayout(page, {
        fontSelector: "main p,main pre,main dd",
        appliedReceipts: false,
      }),
    );
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    const height = await page.evaluate(() =>
      Math.max(innerHeight, document.documentElement.scrollHeight),
    );
    const png = await page.screenshot({
      path: info.outputPath(`p3e-${state}-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    expect(png.readUInt32BE(16)).toBe(width);
    expect(
      await page.evaluate(() =>
        Math.max(innerHeight, document.documentElement.scrollHeight),
      ),
    ).toBe(height);
    expect(png.readUInt32BE(20)).toBe(height);
  }
}
