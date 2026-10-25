import { test, expect, type Page } from "@playwright/test";
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
        !/^qfo_p2a_[A-Za-z0-9_-]{43}$/.test(value.operator) ||
        !/^qfo_p2a_[A-Za-z0-9_-]{43}$/.test(value.readOnly)
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
    throw new Error("AUTH_E2E_INPUT_UNAVAILABLE");
  }
}

async function openSession(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "工作台", exact: true }),
  ).toBeVisible();
  const identity = page.getByRole("link", { name: "身份与退出", exact: true });
  if (!(await identity.isVisible()))
    await page.getByText("Studio 导航", { exact: true }).click();
  await identity.click();
  await expect(
    page.getByRole("heading", { name: "运营会话", exact: true }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  await fixtureCommand("prepare");
  prepared = true;
  fixture = await readFixture();
});
test.afterAll(async () => {
  if (prepared) await fixtureCommand("cleanup");
});

test("real operator login/logout and safe mobile UI captures", async ({
  page,
}, testInfo) => {
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/studio/login");
    await expect(page.getByRole("heading", { name: "运营登录" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Studio 导航", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("运营凭证")).toBeEnabled();
    // Only empty input is captured; credentials are never screenshot artifacts.
    await page.screenshot({
      path: testInfo.outputPath(`studio-login-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .getByLabel("运营凭证")
        .evaluate(
          (element) =>
            parseFloat(getComputedStyle(element).fontSize) >= 16 &&
            element.getBoundingClientRect().height >= 44,
        ),
    ).toBe(true);
    await enterCredential(page, fixture.operator);
    await page.getByRole("button", { name: "登录 Studio" }).click();
    await openSession(page);
    await expect(page.locator('nav[aria-label="Studio 导航"]')).toHaveCount(1);
    const session = page.locator("section").filter({
      has: page.getByRole("heading", { name: "运营会话", exact: true }),
    });
    await expect(
      session.getByText("e2e-operator", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("运营者（operator）", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .getByRole("button", { name: "退出登录" })
        .evaluate((element) => element.getBoundingClientRect().height >= 44),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`studio-session-${width}.png`),
      fullPage: true,
    });
    if (width === 320) {
      // Revoke this synthetic session without the local panel's router.refresh.
      // The next real client navigation must show login even if its layout is retained.
      // Return only a status code; no session/CSRF value enters assertions or output.
      const status = await page.evaluate(async () => {
        try {
          const current = await fetch("/api/studio/auth/session", {
            cache: "no-store",
          });
          if (!current.ok) return 0;
          const session = await current.json();
          const response = await fetch("/api/studio/auth/logout", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            body: "{}",
          });
          return response.status;
        } catch {
          return 0;
        }
      });
      expect(status).toBe(204);
      const link = page.getByRole("link", { name: "测评管理", exact: true });
      if (!(await link.isVisible()))
        await page.getByText("Studio 导航", { exact: true }).click();
      await link.click();
    } else {
      await page.getByRole("button", { name: "退出登录" }).click();
    }
    await expect(page.getByRole("heading", { name: "运营登录" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Studio 导航", exact: true }),
    ).toHaveCount(0);
    await page.goto("/studio");
    await expect(page.getByRole("heading", { name: "运营登录" })).toBeVisible();
  }
});

test("real read-only role is shown and can logout", async ({ page }) => {
  await page.goto("/studio/login");
  await expect(page.getByLabel("运营凭证")).toBeEnabled();
  await enterCredential(page, fixture.readOnly);
  await page.getByRole("button", { name: "登录 Studio" }).click();
  await openSession(page);
  const session = page.locator("section").filter({
    has: page.getByRole("heading", { name: "运营会话", exact: true }),
  });
  await expect(
    session.getByText("e2e-read-only", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("只读（read-only）", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "运营登录" })).toBeVisible();
});

test("empty-input loading capture and real rejected login capture", async ({
  page,
}, testInfo) => {
  let release = () => {};
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const endpoint = "**/api/studio/auth/preauth";
  await page.route(endpoint, async (route) => {
    await paused;
    await route.continue();
  });
  try {
    await page.goto("/studio/login");
    await expect(page.getByRole("status")).toHaveText("正在准备登录验证…");
    await expect(page.getByLabel("运营凭证")).toHaveValue("");
    await expect(page.getByLabel("运营凭证")).toBeDisabled();
    // This is controlled network delay for UI capture, not a network-failure claim.
    await page.screenshot({
      path: testInfo.outputPath("studio-login-loading.png"),
      fullPage: true,
    });
  } finally {
    release();
    // Keep this page-scoped handler installed until the page fixture closes.
    // After release every request continues immediately, without racing unroute.
  }
  await expect(page.getByLabel("运营凭证")).toBeEnabled();
  await enterCredential(page, "invalid-synthetic-input");
  await page.getByRole("button", { name: "登录 Studio" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "登录未成功。请检查运营凭证，或重新准备登录验证。",
  );
  await expect(page.getByLabel("运营凭证")).toHaveValue("");
  await page.screenshot({
    path: testInfo.outputPath("studio-login-error.png"),
    fullPage: true,
  });
});
