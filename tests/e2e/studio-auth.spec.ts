import { enterStudioPassword } from "./studio-password-login";
import { test, expect } from "@playwright/test";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });

type PrivateFixture = { operator: string; readOnly: string };
let fixture: PrivateFixture;
let prepared = false;
const runId = randomUUID();
const helper = path.resolve("tests/db/p2a-auth-fixture.ts");
const execute = promisify(execFile);

async function fixtureCommand(mode: "prepare" | "cleanup") {
  try {
    await execute(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", helper, mode, runId],
      { cwd: process.cwd(), env: process.env, timeout: 30000, maxBuffer: 4096 },
    );
  } catch {
    throw new Error("AUTH_E2E_FIXTURE_FAILED");
  }
}

async function readFixture(): Promise<PrivateFixture> {
  try {
    const configFile = process.env.QUIZFORGE_P2A_CONFIG;
    if (!configFile || !path.isAbsolute(configFile)) throw new Error();
    const file = await open(
      path.join(path.dirname(configFile), "auth-e2e-fixture.json"),
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
        !/^[A-Za-z0-9_-]{43}$/.test(value.operator) ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.readOnly)
      )
        throw new Error();
      return { operator: value.operator, readOnly: value.readOnly };
    } finally {
      await file.close();
    }
  } catch {
    throw new Error("AUTH_E2E_FIXTURE_UNAVAILABLE");
  }
}

test.beforeAll(async () => {
  await fixtureCommand("prepare");
  prepared = true;
  fixture = await readFixture();
});
test.afterAll(async () => {
  if (prepared) await fixtureCommand("cleanup");
});

for (const role of ["operator", "readOnly"] as const) {
  test(`current password ${role} login and confirmed logout`, async ({
    page,
  }) => {
    await page.goto("/studio/login");
    await expect(
      page.getByRole("heading", { name: "登录运营管理空间", exact: true }),
    ).toBeVisible();
    await enterStudioPassword(
      page,
      role === "operator" ? "e2e-operator" : "e2e-read-only",
      fixture[role],
    );
    await page
      .getByRole("button", { name: "登录 Studio", exact: true })
      .click();
    await expect(page).not.toHaveURL(/\/studio\/login$/);
    await page.goto("/studio/session");
    await expect(
      page.getByRole("heading", { name: "我的账号", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "本人资料", exact: true }),
    ).toContainText(role === "operator" ? "运营人员" : "只读人员");
    await page.getByRole("button", { name: "退出当前", exact: true }).click();
    await page
      .getByRole("button", { name: "确认退出当前登录", exact: true })
      .click();
    await expect(page).toHaveURL(/\/studio\/login$/);
    await page.goto("/studio");
    await expect(page).toHaveURL(/\/studio\/login$/);
  });
}

test("empty password loading and rejected current login", async ({
  page,
}, testInfo) => {
  let release = () => {};
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/studio/auth/preauth", async (route) => {
    await paused;
    await route.continue();
  });
  try {
    await page.goto("/studio/login");
    await expect(page.getByRole("status")).toHaveText("正在准备登录…");
    await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("密码", { exact: true })).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("studio-password-loading.png"),
      fullPage: true,
    });
  } finally {
    release();
  }
  await enterStudioPassword(
    page,
    "missing.synthetic",
    "invalid synthetic password 2026",
  );
  await page.getByRole("button", { name: "登录 Studio", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "登录未成功。请检查账号与密码，或重新准备登录验证。",
  );
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
});
