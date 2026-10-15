import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { p2b2bFixtureSchema } from "../db/p2b2b-fixture-contract";
import {
  pendingTupleSchema,
  PENDING_STORAGE_KEY,
  type PendingTuple,
} from "../../src/features/studio/validations/pending";
import { checkStart } from "../../src/features/studio/validations/client";
import { startValidationResultSchema } from "../../src/features/quizpack/validation/contracts";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
const runId = randomUUID();
const helper = path.resolve("tests/db/p2b2b-e2e-fixture.ts");
const execute = promisify(execFile);
type Fixture = z.infer<typeof p2b2bFixtureSchema>;
let fixture: Fixture;
const BUSINESS_RESULT_TIMEOUT = 75_000;
let configuration: "known-disabled" | "known-enabled" | "unknown" = "unknown";
const acknowledgedObservationSchema = z
  .object({
    recordObserved: z.literal(true),
    state: z.literal("ready"),
    revision: z.number().int().positive(),
    acknowledged: z.literal(true),
  })
  .strict();
let beforeFetchTuple: PendingTuple | null = null;
async function fixtureCommand(
  mode: "prepare" | "enable" | "disable" | "observe-validation",
  key?: string,
) {
  if (mode === "enable" || mode === "disable") {
    if (configuration === "unknown")
      throw new Error("VALIDATIONS_E2E_CONFIGURATION_UNKNOWN");
    configuration = "unknown";
  } else if (mode === "prepare") configuration = "unknown";
  try {
    const { stdout } = await execute(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        helper,
        mode,
        runId,
        ...(key ? [key] : []),
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: mode === "observe-validation" ? 10_000 : 60_000,
        maxBuffer: 4096,
      },
    );
    if (mode === "prepare" || mode === "disable")
      configuration = "known-disabled";
    else if (mode === "enable") configuration = "known-enabled";
    return stdout;
  } catch {
    throw new Error("VALIDATIONS_E2E_FIXTURE_FAILED");
  }
}
async function readFixture(): Promise<Fixture> {
  try {
    const configFile = process.env.QUIZFORGE_P2A_CONFIG;
    if (!configFile || !path.isAbsolute(configFile)) throw new Error();
    const file = await open(
      path.join(path.dirname(configFile), "validations-e2e-fixture.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.uid !== process.getuid?.() ||
        stat.size > 16384
      )
        throw new Error();
      const buffer = Buffer.alloc(16385);
      let length = 0;
      while (length < buffer.length) {
        const part = await file.read(
          buffer,
          length,
          buffer.length - length,
          length,
        );
        if (!part.bytesRead) break;
        length += part.bytesRead;
      }
      if (length > 16384) throw new Error();
      const value = p2b2bFixtureSchema.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            buffer.subarray(0, length),
          ),
        ),
      );
      if (value.runId !== runId) throw new Error();
      return value;
    } finally {
      await file.close();
    }
  } catch {
    throw new Error("VALIDATIONS_E2E_FIXTURE_UNAVAILABLE");
  }
}
async function signIn(
  page: Page,
  index: number,
  role: "operator" | "readOnly" = "operator",
) {
  await page.goto("/studio/login");
  await expect(page.getByLabel("运营凭证")).toBeEnabled();
  try {
    await page.evaluate((value) => {
      const input = document.getElementById("studio-credential");
      if (!(input instanceof HTMLInputElement) || input.disabled)
        throw new Error("INPUT_UNAVAILABLE");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("INPUT_UNAVAILABLE");
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, fixture[role].secret);
  } catch {
    throw new Error("VALIDATIONS_E2E_INPUT_UNAVAILABLE");
  }
  await page.getByRole("button", { name: "登录 Studio" }).click();
  await expect(page.getByRole("heading", { name: "运营会话" })).toBeVisible();
  const item = fixture.imports[index];
  if (!item) throw new Error("VALIDATIONS_E2E_IMPORT_UNAVAILABLE");
  await page.goto(
    `/studio/products/${fixture.productId}/imports/${item.importId}`,
  );
  await expect(
    page.getByRole("heading", { name: "验证与私有资源归档", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "原包状态", exact: true })
      .getByText("原包已隔离接收", { exact: true }),
  ).toBeVisible();
}
async function mobileChecks(page: Page, testInfo: TestInfo, state: string) {
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const region = page.getByRole("region", {
      name: "验证与私有资源归档",
      exact: true,
    });
    expect(
      await region.evaluate(
        (element) =>
          Number.parseFloat(getComputedStyle(element).fontSize) >= 16,
      ),
    ).toBe(true);
    const targets = region.getByRole("button");
    for (const target of await targets.all()) {
      const box = await target.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // Only synthetic status pages after the credential field has disappeared.
    // Capture from the top: Chromium fullPage capture from a scrolled viewport
    // can paint an off-screen fixed skip link inside the stitched page image.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`validations-${state}-${width}.png`),
      fullPage: true,
    });
  }
}
function api(index: number) {
  const item = fixture.imports[index];
  if (!item) throw new Error("VALIDATIONS_E2E_IMPORT_UNAVAILABLE");
  return `**/api/studio/products/${fixture.productId}/imports/${item.importId}/validations`;
}
async function pending(page: Page): Promise<PendingTuple | null> {
  const entry = await page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const bucket = JSON.parse(raw) as {
      entries?: { tuple?: unknown; mayHaveBeenSent?: boolean }[];
    };
    const first = bucket.entries?.[0];
    if (!first?.mayHaveBeenSent) return null;
    return first.tuple;
  }, PENDING_STORAGE_KEY);
  return entry === null ? null : pendingTupleSchema.parse(entry);
}
test.beforeAll(async () => {
  await fixtureCommand("prepare");
  fixture = await readFixture();
  await fixtureCommand("enable");
});
test.afterAll(async () => {
  if (configuration === "known-enabled") {
    await fixtureCommand("disable");
    // Root runs private cleanup only after Playwright exits and its owned Next process has stopped.
    // Keep the private runId fixture and all attempt/control evidence on any failure.
  }
});

test("real authored v2 validation archives synthetic pixels while receive facts remain independent", async ({
  page,
}, testInfo) => {
  await signIn(page, 0);
  const start = page.getByRole("button", { name: "验证并归档", exact: true });
  await expect(start).toBeEnabled();
  let prepares = 0,
    starts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/validations")) {
      if (request.url().endsWith("/prepare")) prepares++;
      else if (request.url().endsWith("/validations")) starts++;
    }
  });
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/validations"),
      { timeout: BUSINESS_RESULT_TIMEOUT },
    ),
    start.click(),
  ]);
  const result = startValidationResultSchema.parse(await response.json());
  expect(result).toMatchObject({
    outcome: "record",
    validation: {
      status: "ready",
      contentSchemaVersion: "quizpack-content.v2",
      resourceCount: 5,
      archivedResourceCount: 5,
      platformApproval: "unverified",
      publishable: false,
    },
  });
  await expect(
    page.getByRole("heading", {
      name: "归档完成 · 待后续草稿导入",
      exact: true,
    }),
  ).toBeVisible({ timeout: BUSINESS_RESULT_TIMEOUT });
  expect(prepares).toBe(1);
  expect(starts).toBe(1);
  expect(await pending(page)).toBeNull();
  await expect(
    page.getByText(
      "平台授权未审核（unverified） · 不可发布。归档不会自动创建草稿；首次应用须显式确认。本批不提供草稿编辑或发布。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "原包状态", exact: true })
      .getByText("接收事实 · 独立验证状态见验证记录 · 不可发布", {
        exact: true,
      }),
  ).toBeVisible();
  await mobileChecks(page, testInfo, "ready");
});

test("lost acknowledged start response survives reload and empty exact GET without re-sending", async ({
  page,
}, testInfo) => {
  await signIn(page, 1);
  let starts = 0,
    prepares = 0,
    observed = false;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/validations")) {
      if (request.url().endsWith("/prepare")) prepares++;
      else if (request.url().endsWith("/validations")) starts++;
    }
  });
  await page.route(api(1), async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    try {
      const response = await route.fetch({ timeout: BUSINESS_RESULT_TIMEOUT });
      const tuple = await pending(page);
      if (!tuple) throw new Error();
      const result = checkStart(
        await response.json(),
        response.status(),
        tuple,
      );
      if (result.outcome !== "record") throw new Error();
      const output = await fixtureCommand(
        "observe-validation",
        tuple.expectedValidationKey,
      );
      const lines = output.trim().split("\n");
      if (lines.length !== 2 || lines[1] !== "VALIDATIONS_E2E_FIXTURE_READY")
        throw new Error();
      acknowledgedObservationSchema.parse(JSON.parse(lines[0]!));
      observed = true;
      await route.abort("failed");
    } catch {
      throw new Error("VALIDATIONS_E2E_ACKNOWLEDGED_PROOF_FAILED");
    }
  });
  await page.getByRole("button", { name: "验证并归档", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "本标签有待核实请求", exact: true }),
  ).toBeVisible({ timeout: BUSINESS_RESULT_TIMEOUT });
  await expect(
    page.getByRole("button", { name: "读取原请求核实", exact: true }),
  ).toBeEnabled();
  expect(observed).toBe(true);
  const original = await pending(page);
  expect(original).not.toBeNull();
  const exact = `${api(1)}?validationKey=**`;
  // Transport fault hides the already acknowledged row once; empty is never rollback evidence.
  await page.route(exact, (route) =>
    route.fulfill({
      status: 200,
      json: { items: [], page: 1, pageSize: 1, total: 0, hasNext: false },
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "本标签有待核实请求", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "原请求暂未找到；这不证明已回滚。请保留待核实记录，再次读取原请求。",
      { exact: true },
    ),
  ).toBeVisible();
  expect(await pending(page)).toEqual(original);
  expect(starts).toBe(1);
  expect(prepares).toBe(1);
  await expect(
    page.getByRole("button", { name: "验证并归档", exact: true }),
  ).toHaveCount(0);
  await mobileChecks(page, testInfo, "unknown-empty-get");
  await page.unroute(exact);
  await page.unroute(api(1));
  await page
    .getByRole("button", { name: "读取原请求核实", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "本标签有待核实请求", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "归档完成 · 待后续草稿导入",
      exact: true,
    }),
  ).toBeVisible();
  expect(await pending(page)).toBeNull();
  expect(starts).toBe(1);
  expect(prepares).toBe(1);
});

test("persisted true before first fetch survives refresh as read-only unknown", async ({
  page,
}, testInfo) => {
  await signIn(page, 2);
  let starts = 0,
    prepares = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/validations")) {
      if (request.url().endsWith("/prepare")) prepares++;
      else if (request.url().endsWith("/validations")) starts++;
    }
  });
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    const get = Storage.prototype.getItem;
    let interrupt = false;
    Storage.prototype.setItem = function (name, value) {
      set.call(this, name, value);
      if (name === key) {
        const bucket = JSON.parse(value) as {
          entries: { mayHaveBeenSent: boolean }[];
        };
        if (bucket.entries.some((entry) => entry.mayHaveBeenSent))
          interrupt = true;
      }
    };
    Storage.prototype.getItem = function (name) {
      if (name === key && interrupt) {
        interrupt = false;
        return null;
      }
      return get.call(this, name);
    };
  }, PENDING_STORAGE_KEY);
  await page.getByRole("button", { name: "验证并归档", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "本标签有待核实请求", exact: true }),
  ).toBeVisible();
  const original = await pending(page);
  beforeFetchTuple = original;
  expect(original).not.toBeNull();
  expect(starts).toBe(0);
  expect(prepares).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "本标签有待核实请求", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "原请求暂未找到；这不证明已回滚。请保留待核实记录，再次读取原请求。",
      { exact: true },
    ),
  ).toBeVisible();
  expect(await pending(page)).toEqual(original);
  expect(starts).toBe(0);
  expect(prepares).toBe(1);
  await expect(
    page.getByRole("button", { name: "验证并归档", exact: true }),
  ).toHaveCount(0);
  await mobileChecks(page, testInfo, "persisted-before-fetch");
});

test("corrupt pending storage prevents all new validation writes while history remains readable", async ({
  page,
}) => {
  await signIn(page, 0);
  await page.evaluate(
    (key) => sessionStorage.setItem(key, "unreadable-versioned-bucket"),
    PENDING_STORAGE_KEY,
  );
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/validations"))
      posts++;
  });
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "验证与私有资源归档", exact: true })
      .getByRole("alert"),
  ).toHaveText(
    "本标签的待核实记录不可读取或保存，或已有请求。操作结果需核实，请保留记录并读取服务器历史。",
  );
  await expect(
    page.getByRole("button", { name: "验证并归档", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", {
      name: "归档完成 · 待后续草稿导入",
      exact: true,
    }),
  ).toBeVisible();
  expect(posts).toBe(0);
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      PENDING_STORAGE_KEY,
    ),
  ).toBe("unreadable-versioned-bucket");
});

test("read-only access preserves an unknown anchor and makes no validation writes", async ({
  page,
}, testInfo) => {
  if (!beforeFetchTuple) throw new Error("VALIDATIONS_E2E_ANCHOR_UNAVAILABLE");
  await signIn(page, 2, "readOnly");
  await page.evaluate(
    ({ key, tuple }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: "quizforge-validation-pending.v1",
          entries: [{ tuple, mayHaveBeenSent: true }],
        }),
      ),
    { key: PENDING_STORAGE_KEY, tuple: beforeFetchTuple },
  );
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/validations"))
      posts++;
  });
  await page.reload();
  await expect(
    page.getByText("当前身份只读，可读取历史与原请求。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "本标签有待核实请求", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "读取原请求核实", exact: true }),
  ).toBeEnabled();
  expect(await pending(page)).toEqual(beforeFetchTuple);
  expect(posts).toBe(0);
  await mobileChecks(page, testInfo, "read-only-unknown");
});

test("disabled snapshot retains a prepared tuple and blocks continuation while permitting local cancellation", async ({
  page,
}, testInfo) => {
  if (!beforeFetchTuple) throw new Error("VALIDATIONS_E2E_ANCHOR_UNAVAILABLE");
  await signIn(page, 2);
  await page.evaluate(
    ({ key, tuple }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: "quizforge-validation-pending.v1",
          entries: [{ tuple, mayHaveBeenSent: false }],
        }),
      ),
    { key: PENDING_STORAGE_KEY, tuple: beforeFetchTuple },
  );
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/validations"))
      posts++;
  });
  await fixtureCommand("disable");
  try {
    await page.reload();
    await expect(
      page.getByText("验证与归档已关闭，可读取历史与原请求。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "本标签有尚未发送的准备",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "继续验证并归档", exact: true }),
    ).toBeDisabled();
    await mobileChecks(page, testInfo, "disabled-prepared");
    await page
      .getByRole("button", { name: "取消尚未发送的准备", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "本标签有尚未发送的准备",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(posts).toBe(0);
  } finally {
    await fixtureCommand("enable");
  }
});

test("archived workspace keeps the original unknown request available for reads", async ({
  page,
}, testInfo) => {
  if (!beforeFetchTuple) throw new Error("VALIDATIONS_E2E_ANCHOR_UNAVAILABLE");
  await signIn(page, 2);
  await page.evaluate(
    ({ key, tuple }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: "quizforge-validation-pending.v1",
          entries: [{ tuple, mayHaveBeenSent: true }],
        }),
      ),
    { key: PENDING_STORAGE_KEY, tuple: beforeFetchTuple },
  );
  await page.goto(`/studio/products/${fixture.productId}`);
  await page.getByRole("button", { name: "归档工作区", exact: true }).click();
  await page
    .getByRole("button", { name: "确认归档工作区", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "恢复工作区", exact: true }),
  ).toBeVisible();
  try {
    await page.goto(
      `/studio/products/${fixture.productId}/imports/${fixture.imports[2]!.importId}`,
    );
    await expect(
      page.getByText("工作区已归档，可读取历史与原请求。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "本标签有待核实请求", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "读取原请求核实", exact: true }),
    ).toBeEnabled();
    expect(await pending(page)).toEqual(beforeFetchTuple);
    await mobileChecks(page, testInfo, "archived-unknown");
  } finally {
    await page.goto(`/studio/products/${fixture.productId}`);
    await page.getByRole("button", { name: "恢复工作区", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "归档工作区", exact: true }),
    ).toBeVisible();
  }
});

test("a saved false tuple requires an explicit continuation and never re-prepares", async ({
  page,
}) => {
  if (!beforeFetchTuple) throw new Error("VALIDATIONS_E2E_ANCHOR_UNAVAILABLE");
  await signIn(page, 2);
  await page.evaluate(
    ({ key, tuple }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: "quizforge-validation-pending.v1",
          entries: [{ tuple, mayHaveBeenSent: false }],
        }),
      ),
    { key: PENDING_STORAGE_KEY, tuple: beforeFetchTuple },
  );
  let starts = 0,
    prepares = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/validations")) {
      if (request.url().endsWith("/prepare")) prepares++;
      else if (request.url().endsWith("/validations")) starts++;
    }
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "本标签有尚未发送的准备", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "继续验证并归档", exact: true }),
  ).toBeEnabled();
  expect(starts).toBe(0);
  expect(prepares).toBe(0);
  await page
    .getByRole("button", { name: "继续验证并归档", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "归档完成 · 待后续草稿导入",
      exact: true,
    }),
  ).toBeVisible({ timeout: BUSINESS_RESULT_TIMEOUT });
  expect(starts).toBe(1);
  expect(prepares).toBe(0);
  expect(await pending(page)).toBeNull();
});
