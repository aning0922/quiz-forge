import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { constants } from "node:fs";
import { open, readFile, lstat, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import {
  PREVIEW_FIXTURE_PRIVATE_NAME,
  previewFixtureSchema,
  type PreviewFixture,
} from "../db/p3c-preview-fixture-contract";
import {
  previewEntryResponseSchema,
  previewRevealResponseSchema,
  type PreviewEntry,
  type PreviewReveal,
} from "../../src/features/product/preview/contracts";
import {
  previewPagePath,
  previewApiPath,
  parsePreviewResourceQuery,
} from "../../src/features/product/preview/urls";
// Real HTTP/PG/private PNG reads and the actual pure scorer; media pixels remain explicitly synthetic.
// Root owns launch/stop/proof/cleanup. This spec cannot clean a possibly live reader's files.
test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
const execute = promisify(execFile),
  helper = path.resolve("tests/db/p3c-preview-fixture.ts");
let fixture: PreviewFixture,
  allPassed = true,
  prepared = false;
function runId() {
  const value = process.env.QF_PREVIEW_E2E_RUN_ID;
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw Error("PREVIEW_OWNER_RUN_ID_REQUIRED");
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
        timeout: 60_000,
        maxBuffer: 4096,
      },
    );
  } catch {
    throw Error("PREVIEW_E2E_FIXTURE_FAILED");
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
    const handle = await open(
      path.join(directory, PREVIEW_FIXTURE_PRIVATE_NAME),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const st = await handle.stat();
      if (
        !st.isFile() ||
        st.nlink !== 1 ||
        (st.mode & 0o777) !== 0o600 ||
        st.uid !== process.getuid?.() ||
        st.size > 16384
      )
        throw Error();
      const bytes = Buffer.alloc(16385);
      let length = 0;
      while (length < bytes.length) {
        const part = await handle.read(
          bytes,
          length,
          bytes.length - length,
          length,
        );
        if (!part.bytesRead) break;
        length += part.bytesRead;
      }
      const after = await handle.stat();
      if (
        length > 16384 ||
        length !== st.size ||
        after.dev !== st.dev ||
        after.ino !== st.ino ||
        after.size !== st.size ||
        after.mtimeMs !== st.mtimeMs ||
        after.nlink !== 1 ||
        (after.mode & 0o777) !== 0o600 ||
        after.uid !== st.uid
      )
        throw Error();
      const value = previewFixtureSchema.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(0, length),
          ),
        ),
      );
      if (
        value.runId !== runId() ||
        !value.prepared ||
        value.completed ||
        value.sources.length !== 2 ||
        path.basename(path.dirname(config)) !== value.instanceId
      )
        throw Error();
      return value;
    } finally {
      await handle.close();
    }
  } catch {
    throw Error("PREVIEW_E2E_FIXTURE_UNAVAILABLE");
  }
}
const source = (engine: "archetype" | "dimensions" = "archetype") =>
  fixture.sources.find((s) => s.engine === engine)!;
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
    throw Error("PREVIEW_E2E_INPUT_UNAVAILABLE");
  }
  await page.getByRole("button", { name: "登录 Studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "运营会话", exact: true }),
  ).toBeVisible();
}
async function enter(
  page: Page,
  engine: "archetype" | "dimensions" = "archetype",
) {
  const s = source(engine),
    response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === previewApiPath(s.scope) &&
        r.request().method() === "GET",
    );
  await page.goto(previewPagePath(s.scope));
  const entry = previewEntryResponseSchema.parse(
    await (await response).json(),
  ).value;
  await expect(page.locator('[data-preview-state="cover"]')).toBeVisible();
  await expect(page.locator('[data-preview-state="cover"] img')).toBeVisible();
  return entry;
}
async function answer(
  page: Page,
  entry: PreviewEntry,
  choices: { questionId: string; optionId: string }[],
) {
  for (let i = 0; i < entry.questions.length; i++) {
    const q = entry.questions[i]!,
      option = choices.find((a) => a.questionId === q.id)!.optionId;
    const optionIndex = q.options.findIndex((o) => o.id === option);
    if (optionIndex < 0) throw Error("PREVIEW_OPTION_NOT_FOUND");
    await page.getByRole("radio").nth(optionIndex).check();
    if (i < entry.questions.length - 1)
      await page.getByRole("button", { name: "下一题", exact: true }).click();
  }
}
async function score(page: Page, entry: PreviewEntry): Promise<PreviewReveal> {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === previewApiPath(entry.binding, "score") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "揭晓结果", exact: true }).click();
  const reveal = previewRevealResponseSchema.parse(
    await (await response).json(),
  ).value;
  await expect(page.locator('[data-preview-state="result"]')).toBeVisible();
  await expect(
    page.getByRole("heading", { name: reveal.result.displayName, exact: true }),
  ).toBeVisible();
  return reveal;
}
async function mobile(page: Page, info: TestInfo, state: string) {
  if (state !== "resume")
    await expect(page.locator("[data-preview-state] img")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    if (state === "question") {
      const badge = await page.locator("[data-preview-approval]").boundingBox();
      const caption = await page
        .locator("[data-preview-scene-caption]")
        .boundingBox();
      if (!badge || !caption) throw Error("PREVIEW_SCENE_BOUNDS_MISSING");
      expect(badge.y + badge.height).toBeLessThanOrEqual(caption.y);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const button of await page.getByRole("button").all()) {
      const box = await button.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
    for (const p of await page.locator("[data-preview-state] p").all()) {
      if (await p.isVisible())
        expect(
          await p.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
        ).toBeGreaterThanOrEqual(16);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    const png = await page.screenshot({
      path: info.outputPath(`preview-${state}-${width}.png`),
      fullPage: true,
    });
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(
      await page.evaluate(() =>
        Math.max(innerHeight, document.documentElement.scrollHeight),
      ),
    );
  }
}
test.beforeAll(async () => {
  await command("prepare");
  fixture = await readFixture();
  prepared = true;
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) allPassed = false;
});
test.afterAll(async () => {
  if (prepared && allPassed) await command("finish");
});

test("fixed preview requires a current studio identity", async ({ page }) => {
  const scope = source().scope;
  await page.goto(previewPagePath(scope));
  await expect(page).toHaveURL(/\/studio\/login$/);
  const response = await page.request.get(previewApiPath(scope));
  expect(response.status()).toBe(401);
  expect((await response.json()).code).toBe("UNAUTHENTICATED");
});
test("actual six-state flow has neutral pre-reveal transfer, full report and a real PNG at four mobile widths", async ({
  page,
}, info) => {
  await signIn(page);
  const resources: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/preview/resource"))
      resources.push(parsePreviewResourceQuery(url).resourceRef.id);
  });
  const entry = await enter(page),
    s = source(),
    witness = s.witnesses[0]!;
  const raw = JSON.stringify(entry);
  for (const forbidden of [
    "resultCards",
    "baseline",
    "contributions",
    "targets",
    "witnesses",
    "portraitRef",
  ])
    expect(raw.includes(`"${forbidden}"`)).toBe(false);
  await mobile(page, info, "cover");
  await page.getByRole("button", { name: "开始预览", exact: true }).click();
  await expect(
    page.locator('[data-preview-state="question"] img'),
  ).toBeVisible();
  await mobile(page, info, "question");
  // Native radio keys retain the browser's accessible group behavior.
  const first = page.getByRole("radio").first();
  await first.focus();
  await page.keyboard.press("Space");
  await expect(first).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio").nth(1)).toBeChecked();
  await page
    .getByRole("button", { name: "暂歇，查看当前进度", exact: true })
    .click();
  await expect(page.locator('[data-preview-state="resume"]')).toBeVisible();
  await mobile(page, info, "resume");
  await page.getByRole("button", { name: "继续答题", exact: true }).click();
  await answer(page, entry, witness.answers);
  expect(
    resources.every((id) => entry.assets.some((a) => a.resourceRef.id === id)),
  ).toBe(true);
  const reveal = await score(page, entry);
  expect(reveal.selectedResultRef.id).toBe(witness.resultId);
  await expect(page.locator('[data-preview-state="result"] img')).toBeVisible();
  await mobile(page, info, "result");
  await page.getByRole("button", { name: "展开报告", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: reveal.report.baseline.title,
      exact: true,
    }),
  ).toBeVisible();
  for (const text of [
    reveal.report.baseline.summary,
    ...reveal.report.baseline.strengths,
    ...reveal.report.baseline.tensions,
    reveal.report.baseline.reflection,
    reveal.report.baseline.disclaimer,
  ])
    await expect(
      page
        .locator('[data-preview-state="report"]')
        .getByText(text, { exact: true }),
    ).toBeVisible();
  expect(await page.locator('[data-preview-state="report"] dt').count()).toBe(
    reveal.dimensions.length,
  );
  await mobile(page, info, "report");
  await page.getByRole("button", { name: "查看海报", exact: true }).click();
  await expect(page.locator('[data-preview-state="poster"] img')).toBeVisible();
  await mobile(page, info, "poster");
  expect(reveal.poster.kind).toBe("ready");
  await page.getByRole("button", { name: "生成完整 PNG", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "下载 PNG", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载 PNG", exact: true }).click();
  const file = await (await downloadEvent).path();
  if (!file) throw Error("PREVIEW_PNG_MISSING");
  const bytes = await readFile(file),
    metadata = await sharp(bytes).metadata();
  expect([metadata.width, metadata.height, metadata.format]).toEqual([
    1080,
    1920,
    "png",
  ]);
  await info.attach("actual-preview-poster.png", {
    body: bytes,
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "返回报告", exact: true }).click();
  await page.getByRole("button", { name: "返回检查答案", exact: true }).click();
  await page.getByRole("radio").first().check();
  await expect(
    page.getByRole("link", { name: "下载 PNG", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-preview-state="cover"]')).toBeVisible();
  await page.getByRole("button", { name: "开始预览", exact: true }).click();
  await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0);
});
test("read-only operator can calculate every actual witness in both engines without writing a formal report", async ({
  page,
}) => {
  await signIn(page, "readOnly");
  for (const engine of ["archetype", "dimensions"] as const) {
    for (const witness of source(engine).witnesses) {
      const entry = await enter(page, engine);
      await page.getByRole("button", { name: "开始预览", exact: true }).click();
      await answer(page, entry, witness.answers);
      const reveal = await score(page, entry);
      expect(reveal.selectedResultRef.id).toBe(witness.resultId);
      expect(reveal.report.mode).toBe("DETERMINISTIC");
    }
  }
});
test("editing answers rejects a delayed actual score response and clears the old reveal", async ({
  page,
}) => {
  await signIn(page);
  const entry = await enter(page);
  await page.getByRole("button", { name: "开始预览", exact: true }).click();
  await answer(page, entry, source().witnesses[0]!.answers);
  let release: (() => void) | undefined, seen: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await page.route(
    `**${previewApiPath(entry.binding, "score")}`,
    async (route) => {
      const response = await route.fetch();
      seen!();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await route.fulfill({ response });
      } catch {
        /* Browser abort does not prove the server skipped scoring. */
      }
    },
  );
  await page.getByRole("button", { name: "揭晓结果", exact: true }).click();
  await received;
  await page.getByRole("radio").nth(1).check();
  release!();
  await expect(page.locator('[data-preview-state="question"]')).toBeVisible();
  await expect(page.locator('[data-preview-state="result"]')).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "下载 PNG", exact: true }),
  ).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
});
test("corrupt private bytes and unavailable fonts show honest failures without a successful download", async ({
  page,
}) => {
  await signIn(page);
  const s = source();
  await page.route("**/preview/resource?*", async (route) => {
    const response = await route.fetch(),
      body = await response.body();
    body[0] = body[0]! ^ 1;
    await route.fulfill({ response, body });
  });
  await page.goto(previewPagePath(s.scope));
  await expect(
    page.getByText("当前素材无法核验或读取。请由维护者检查后重试。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('[data-preview-state="cover"] img')).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  const entry = await enter(page);
  await page.getByRole("button", { name: "开始预览", exact: true }).click();
  await answer(page, entry, s.witnesses[0]!.answers);
  await score(page, entry);
  await page.getByRole("button", { name: "查看海报", exact: true }).click();
  await page.route("**/assets/fonts/preview-v1/serif-600.woff2", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.getByRole("button", { name: "生成完整 PNG", exact: true }).click();
  await expect(
    page.getByText("导出字体未完成核验，暂时无法生成 PNG。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "下载 PNG", exact: true }),
  ).toHaveCount(0);
});
test("wrong binding and foreign choices fail at the real score endpoint; current identity is rechecked", async ({
  page,
}) => {
  await signIn(page);
  const entry = await enter(page),
    s = source();
  // Use the current session DTO in memory; never write or attach it to artifacts.
  const sessionResponse = await page.request.get("/api/studio/auth/session");
  if (!sessionResponse.ok()) throw Error("PREVIEW_SESSION_UNAVAILABLE");
  const session = (await sessionResponse.json()) as { csrfToken: string };
  const request = {
    binding: entry.binding,
    requestId: randomUUID(),
    answers: s.witnesses[0]!.answers,
  };
  const send = (body: unknown) =>
    page.request.post(previewApiPath(s.scope, "score"), {
      headers: {
        "x-csrf-token": session.csrfToken,
        origin: new URL(page.url()).origin,
      },
      data: body,
    });
  const mismatch = await send({
    ...request,
    binding: {
      ...request.binding,
      canonicalContentSha256: createHash("sha256")
        .update("wrong")
        .digest("hex"),
    },
  });
  expect(mismatch.status()).toBe(409);
  expect((await mismatch.json()).code).toBe("PREVIEW_BINDING_MISMATCH");
  const invalid = await send({
    ...request,
    answers: [{ questionId: s.questionIds[0], optionId: "foreign-option" }],
  });
  expect(invalid.status()).toBe(422);
  expect((await invalid.json()).code).toBe("PREVIEW_INVALID_ANSWERS");
  await page.context().clearCookies();
  const denied = await send(request);
  expect(denied.status()).toBe(401);
  expect((await denied.json()).code).toBe("UNAUTHENTICATED");
});
