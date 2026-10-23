import { test, expect, type Page } from "@playwright/test";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

type PrivateFixture = { operator: string; readOnly: string };
let fixture: PrivateFixture;
let prepared = false;
const runId = randomUUID();
const helper = path.resolve("tests/db/p2b2-e2e-fixture.ts");
const execute = promisify(execFile);

async function fixtureCommand(
  mode:
    | "prepare"
    | "cleanup"
    | "enable"
    | "disable"
    | "observe-intent"
    | "seed-recovery",
  key?: string,
) {
  try {
    await execute(
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
      { cwd: process.cwd(), env: process.env, timeout: 30000, maxBuffer: 4096 },
    );
  } catch {
    throw new Error("IMPORTS_E2E_FIXTURE_FAILED");
  }
}

async function readFixture(): Promise<PrivateFixture> {
  try {
    const configFile = process.env.QUIZFORGE_P2A_CONFIG;
    if (!configFile || !path.isAbsolute(configFile)) throw new Error();
    const file = await open(
      path.join(path.dirname(configFile), "imports-e2e-fixture.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        (info.mode & 0o777) !== 0o600 ||
        info.uid !== process.getuid?.() ||
        info.size > 4096
      )
        throw new Error();
      const bytes = Buffer.alloc(4097);
      let length = 0;
      while (length < bytes.length) {
        const part = await file.read(
          bytes,
          length,
          bytes.length - length,
          length,
        );
        if (part.bytesRead === 0) break;
        length += part.bytesRead;
      }
      if (length > 4096) throw new Error();
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, length),
        ),
      );
      if (
        !value ||
        typeof value !== "object" ||
        Object.keys(value).length !== 4 ||
        !("version" in value) ||
        value.version !== 1 ||
        !("runId" in value) ||
        value.runId !== runId ||
        !("operator" in value) ||
        !("readOnly" in value) ||
        typeof value.operator !== "string" ||
        typeof value.readOnly !== "string" ||
        !/^qfo_p2a_[A-Za-z0-9_-]{43}$/.test(value.operator) ||
        !/^qfo_p2a_[A-Za-z0-9_-]{43}$/.test(value.readOnly)
      )
        throw new Error();
      return { operator: value.operator, readOnly: value.readOnly };
    } finally {
      await file.close();
    }
  } catch {
    throw new Error("IMPORTS_E2E_FIXTURE_UNAVAILABLE");
  }
}

// Avoid locator.fill(secret): its failure call log can print the value even with tracing off.
async function enterCredential(page: Page, credential: string): Promise<void> {
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
    }, credential);
  } catch {
    throw new Error("IMPORTS_E2E_INPUT_UNAVAILABLE");
  }
}

test.beforeAll(async () => {
  await fixtureCommand("prepare");
  prepared = true;
  fixture = await readFixture();
  await fixtureCommand("disable");
});
test.afterAll(async () => {
  if (prepared) {
    await fixtureCommand("disable");
    await fixtureCommand("cleanup");
  }
});

async function signIn(page: Page, role: "operator" | "readOnly" = "operator") {
  await page.goto("/studio/login");
  await expect(page.getByLabel("运营凭证")).toBeEnabled();
  await enterCredential(page, fixture[role]);
  await page.getByRole("button", { name: "登录 Studio" }).click();
  await expect(page.getByRole("heading", { name: "运营会话" })).toBeVisible();
  await page.goto("/studio/products/e2e-imports/imports");
  await expect(
    page.getByRole("heading", { name: "原包接收", exact: true }),
  ).toBeVisible();
}

async function mobileEvidence(
  page: Page,
  testInfo: { outputPath: (name: string) => string },
  state: string,
) {
  // Explicit captures only after credential input is gone; no trace/video.
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`imports-${state}-${width}.png`),
      fullPage: true,
    });
  }
}

test("disabled snapshot, empty history, and read-only mobile state", async ({
  page,
}, testInfo) => {
  await signIn(page, "readOnly");
  await expect(
    page.getByText("原包接收已关闭（只读配置快照）", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "尚无接收记录。此列表不执行恢复，也不推断未提交请求的结果。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByLabel("原包文件", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "创建原包接收意图", exact: true }),
  ).toHaveCount(0);
  await mobileEvidence(page, testInfo, "disabled-read-only-empty");
});

test("real intent and raw received state remains unvalidated", async ({
  page,
}, testInfo) => {
  await fixtureCommand("enable");
  await signIn(page);
  const workflow = page.getByRole("navigation", {
    name: "商品操作流程",
    exact: true,
  });
  await expect(
    workflow.getByRole("link", { name: "导入与验证", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    workflow.getByRole("link", { name: "预览 · 先选修订", exact: true }),
  ).toHaveAttribute("href", "/studio/products/e2e-imports/draft");
  await expect(
    page.getByText("原包接收已启用（只读配置快照）", { exact: true }),
  ).toBeVisible();
  const fileInput = page.getByLabel("原包文件", { exact: true });
  const syntheticFile = {
    name: "synthetic.quizpack",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("synthetic raw bytes, intentionally not a ZIP"),
  };
  await fileInput.setInputFiles(syntheticFile);
  await expect(
    page.getByRole("button", { name: "创建原包接收意图", exact: true }),
  ).toBeEnabled();
  await expect(fileInput).toHaveValue(/synthetic\.quizpack$/);
  const declaration = page.getByText("所选原包校验摘要", { exact: true });
  await declaration.click();
  await expect(fileInput).toHaveValue(/synthetic\.quizpack$/);
  await declaration.click();
  await expect(fileInput).toHaveValue(/synthetic\.quizpack$/);
  await expect(
    page.getByRole("button", { name: "创建原包接收意图", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "重新选择文件", exact: true }).click();
  await expect(fileInput).toHaveValue("");
  await expect(fileInput).toBeEnabled();
  await fileInput.setInputFiles(syntheticFile);
  await expect(
    page.getByRole("button", { name: "创建原包接收意图", exact: true }),
  ).toBeEnabled();
  await expect(fileInput).toHaveValue(/synthetic\.quizpack$/);
  await page
    .getByRole("button", { name: "创建原包接收意图", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "上传所选原包", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "上传所选原包", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "原包状态", exact: true })
      .getByText("原包已隔离接收", { exact: true }),
  ).toBeVisible();
  const receivedCard = page
    .getByRole("listitem")
    .filter({ hasText: "原包已隔离接收" });
  await expect(receivedCard).toHaveCount(1);
  await expect(
    receivedCard.getByText(String(syntheticFile.buffer.length), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(receivedCard.getByText("已对账", { exact: true })).toBeVisible();
  await expect(
    receivedCard.getByText("尚无独立验证记录 · 不可发布", { exact: true }),
  ).toBeVisible();
  await expect(
    receivedCard.getByText("声明 SHA-256", { exact: true }),
  ).toHaveCount(0);
  await receivedCard.getByRole("link", { name: /查看接收记录/ }).click();
  await expect(page).toHaveURL(
    /\/studio\/products\/e2e-imports\/imports\/[0-9a-f-]{36}$/,
  );
  await expect(
    page.getByRole("heading", { name: "原包接收状态", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "原包状态", exact: true })
      .getByText("接收事实 · 独立验证状态见验证记录 · 不可发布", {
        exact: true,
      }),
  ).toBeVisible();
  const detailPanel = page.getByRole("region", {
    name: "原包状态",
    exact: true,
  });
  const checksum = detailPanel.getByText("原包校验摘要", { exact: true });
  await expect(
    detailPanel.getByText("声明 SHA-256", { exact: true }),
  ).toBeHidden();
  await checksum.click();
  await expect(
    detailPanel.getByText("声明 SHA-256", { exact: true }),
  ).toBeVisible();
  await expect(
    detailPanel.getByText("服务器确认 SHA-256", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /验证原包|应用草稿|发布/ }),
  ).toHaveCount(0);
  await mobileEvidence(page, testInfo, "received");
});

test("actual hash rejection is read before another explicit action", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const expected = Buffer.from("synthetic original declaration bytes");
  await page.getByLabel("原包文件", { exact: true }).setInputFiles({
    name: "rejected.quizpack",
    mimeType: "application/octet-stream",
    buffer: expected,
  });
  await page
    .getByRole("button", { name: "创建原包接收意图", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "上传所选原包", exact: true }),
  ).toBeEnabled();
  const endpoint = "**/api/studio/products/e2e-imports/imports/*/archive";
  await page.route(endpoint, (route) =>
    route.continue({ postData: Buffer.alloc(expected.length, 120) }),
  );
  await page.getByRole("button", { name: "上传所选原包", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "原包状态", exact: true })
      .getByText("当前操作已暂停，必须读取最新状态后才能再次显式操作。", {
        exact: true,
      }),
  ).toBeVisible();
  await page.unroute(endpoint);
  await page
    .getByRole("button", { name: "读取最新接收状态", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "原包状态", exact: true })
      .getByText("原包已拒绝 · 不可修改声明重传", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "上传所选原包", exact: true }),
  ).toHaveCount(0);
  await mobileEvidence(page, testInfo, "rejected");
});

test("a separately observed committed intent survives a lost POST response", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const endpoint = "**/api/studio/products/e2e-imports/imports";
  let observed = false;
  let posts = 0;
  let puts = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/imports/"))
      puts += 1;
  });
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    posts += 1;
    const key = route.request().headers()["idempotency-key"];
    try {
      const response = await route.fetch();
      if (response.status() !== 201 || !key) throw new Error();
      await fixtureCommand("observe-intent", key);
      observed = true;
      await route.abort("failed");
    } catch {
      throw new Error("IMPORTS_E2E_COMMITTED_RESPONSE_PROOF_FAILED");
    }
  });
  await page.getByLabel("原包文件", { exact: true }).setInputFiles({
    name: "lost.quizpack",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("synthetic lost response bytes"),
  });
  await page
    .getByRole("button", { name: "创建原包接收意图", exact: true })
    .click();
  await expect(
    page.getByText(
      "意图提交结果尚未确认。原文件、原 key 与完整输入已保留在此页，请先精确核实。",
      { exact: true },
    ),
  ).toBeVisible();
  expect(observed).toBe(true);
  expect(puts).toBe(0);
  await mobileEvidence(page, testInfo, "intent-unknown");
  await page
    .getByRole("button", { name: "按原请求标识精确核实", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "上传所选原包", exact: true }),
  ).toBeEnabled();
  expect(posts).toBe(1);
  expect(puts).toBe(0);
  await page.unroute(endpoint);
  await page.getByRole("button", { name: "上传所选原包", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "原包状态", exact: true })
      .getByText("原包已隔离接收", { exact: true }),
  ).toBeVisible();
  expect(puts).toBe(1);
});

test("explicit recovery of a stopped claim enables choosing the original file on the same page", async ({
  page,
}, testInfo) => {
  await fixtureCommand("seed-recovery");
  await signIn(page);
  const card = page
    .getByRole("listitem")
    .filter({ hasText: "接收中 · 尚未确认完成" });
  await expect(card).toHaveCount(1);
  await card.getByRole("link", { name: /查看接收记录/ }).click();
  await expect(
    page.getByRole("heading", { name: "原包接收状态", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("与原声明一致的文件", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "显式恢复接收", exact: true }).click();
  await expect(
    page.getByLabel("与原声明一致的文件", { exact: true }),
  ).toBeEnabled();
  await mobileEvidence(page, testInfo, "recovered-awaiting-upload");
  await page.getByLabel("与原声明一致的文件", { exact: true }).setInputFiles({
    name: "recovered.quizpack",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("synthetic recover original bytes"),
  });
  await expect(
    page.getByRole("button", { name: "上传所选原包", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "上传所选原包", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "原包状态", exact: true })
      .getByText("原包已隔离接收", { exact: true }),
  ).toBeVisible();
});

test("empty exact lookup retains unknown and explicit resubmit uses the same full input", async ({
  page,
}) => {
  await signIn(page);
  const endpoint = "**/api/studio/products/e2e-imports/imports";
  const attempts: { key: string; body: string }[] = [];
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const key = route.request().headers()["idempotency-key"];
    const body = route.request().postData();
    if (!key || !body) throw new Error("IMPORTS_E2E_INPUT_UNAVAILABLE");
    attempts.push({ key, body });
    // This is a before-submit loss case, not claimed as evidence of committed state.
    if (attempts.length === 1) await route.abort("failed");
    else await route.continue();
  });
  await page.getByLabel("原包文件", { exact: true }).setInputFiles({
    name: "zero.quizpack",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("synthetic zero lookup bytes"),
  });
  await page
    .getByRole("button", { name: "创建原包接收意图", exact: true })
    .click();
  const repeat = page.getByRole("button", {
    name: "以原请求标识和原输入重提",
    exact: true,
  });
  await expect(repeat).toBeDisabled();
  await page
    .getByRole("button", { name: "按原请求标识精确核实", exact: true })
    .click();
  await expect(
    page.getByText(
      "精确查询暂未返回记录。0 条不证明原请求未提交；可以显式用原 key 与完整原输入重提。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "意图提交结果尚未确认。原文件、原 key 与完整输入已保留在此页，请先精确核实。",
      { exact: true },
    ),
  ).toBeVisible();
  await repeat.click();
  await expect(
    page.getByRole("button", { name: "上传所选原包", exact: true }),
  ).toBeEnabled();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.unroute(endpoint);
});

test("a later CSRF refusal cannot erase an earlier unknown intent", async ({
  page,
}) => {
  await signIn(page);
  const endpoint = "**/api/studio/products/e2e-imports/imports";
  const attempts: { key: string; body: string }[] = [];
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const key = route.request().headers()["idempotency-key"];
    const body = route.request().postData();
    if (!key || !body) throw new Error("IMPORTS_E2E_INPUT_UNAVAILABLE");
    attempts.push({ key, body });
    if (attempts.length === 1) await route.abort("failed");
    else
      await route.fulfill({
        status: 403,
        json: {
          code: "CSRF_REJECTED",
          requestId: "00000000-0000-0000-0000-000000000001",
        },
      });
  });
  await page.getByLabel("原包文件", { exact: true }).setInputFiles({
    name: "uncertain.quizpack",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("synthetic cumulative unknown bytes"),
  });
  await page
    .getByRole("button", { name: "创建原包接收意图", exact: true })
    .click();
  await page
    .getByRole("button", { name: "按原请求标识精确核实", exact: true })
    .click();
  const repeat = page.getByRole("button", {
    name: "以原请求标识和原输入重提",
    exact: true,
  });
  await expect(repeat).toBeEnabled();
  await repeat.click();
  await expect(
    page.getByText(
      "意图提交结果尚未确认。原文件、原 key 与完整输入已保留在此页，请先精确核实。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新选择文件", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("原包文件", { exact: true })).toBeDisabled();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(repeat).toBeDisabled();
  await page.unroute(endpoint);
  await page
    .getByRole("button", { name: "按原请求标识精确核实", exact: true })
    .click();
  await repeat.click();
  await expect(
    page.getByRole("button", { name: "上传所选原包", exact: true }),
  ).toBeEnabled();
});

test("malformed successful POST and malformed exact read preserve the original pending request", async ({
  page,
}) => {
  await signIn(page);
  const endpoint = "**/api/studio/products/e2e-imports/imports";
  let observed = false;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    try {
      const response = await route.fetch();
      const key = route.request().headers()["idempotency-key"];
      if (response.status() !== 201 || !key) throw new Error();
      await fixtureCommand("observe-intent", key);
      observed = true;
      await route.fulfill({ status: 201, json: {} });
    } catch {
      throw new Error("IMPORTS_E2E_COMMITTED_RESPONSE_PROOF_FAILED");
    }
  });
  await page.getByLabel("原包文件", { exact: true }).setInputFiles({
    name: "malformed.quizpack",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("synthetic malformed response bytes"),
  });
  await page
    .getByRole("button", { name: "创建原包接收意图", exact: true })
    .click();
  await expect(
    page.getByText(
      "意图提交结果尚未确认。原文件、原 key 与完整输入已保留在此页，请先精确核实。",
      { exact: true },
    ),
  ).toBeVisible();
  expect(observed).toBe(true);
  await page.route(`${endpoint}?**`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        items: [{ productId: "wrong-workspace" }],
        page: 1,
        pageSize: 1,
        total: 1,
        hasNext: false,
      },
    }),
  );
  await page
    .getByRole("button", { name: "按原请求标识精确核实", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "以原请求标识和原输入重提", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "重新选择文件", exact: true }),
  ).toHaveCount(0);
  await page.unroute(`${endpoint}?**`);
  await page.unroute(endpoint);
  await page
    .getByRole("button", { name: "按原请求标识精确核实", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "上传所选原包", exact: true }),
  ).toBeEnabled();
});
