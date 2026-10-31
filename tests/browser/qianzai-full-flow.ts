import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {
  chromium,
  expect as playwrightExpect,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import sharp from "sharp";

const expect = playwrightExpect.configure({ timeout: 15_000 });

// Explicit, private, newly issued test credentials only. No browser/HTTP mocks.
const args = process.argv.slice(2);
assert.equal(args.length, 2);
assert.equal(args[0], "--input");
const input = z
  .strictObject({
    origin: z.string().regex(/^http:\/\/127\.0\.0\.1:\d+$/),
    rawKey: z.string().min(20).max(256),
    contentFile: z.string(),
    preference: z.enum(["female", "male", "any"]),
    answerIndices: z.array(z.number().int().min(0).max(3)).length(24),
    expectedResultId: z.string().min(1),
    resumeKnownSavedPrefix: z.number().int().min(1).max(23).optional(),
  })
  .parse(JSON.parse(await readFile(args[1]!, "utf8")));
const source = JSON.parse(await readFile(input.contentFile, "utf8"));
const core = source.core ?? source;
assert.equal(core.questions.length, 24);
const out = path.resolve(
  ".cache/qztx-prototype-rebuild/browser",
  String(Date.now()),
);
await mkdir(out, { recursive: true, mode: 0o700 });
const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const record = {
  scope:
    "actual Next/HTTP/isolated PostgreSQL; candidate content and private reference artwork",
  buildId: (await readFile(".next/BUILD_ID", "utf8")).trim(),
  browser: "",
  viewport: { width: 390, height: 844 },
  cases: [] as string[],
  screenshots: [] as string[],
  completePosts: 0,
  savePosts: 0,
  pageErrorCount: 0,
  reportSha256: "",
  resultId: "",
  exports: [] as {
    kind: string;
    width: number;
    height: number;
    bytes: number;
    sha256: string;
  }[],
  stage: "starting",
  failure: "",
  passed: false,
};
const browser = await chromium.launch();
record.browser = browser.version();
const context = await browser.newContext({
  viewport: record.viewport,
  acceptDownloads: true,
});
let completedOk: boolean | null = null;
context.on("response", (r) => {
  if (
    new URL(r.url()).pathname.endsWith("/api/complete") &&
    r.request().method() === "POST"
  )
    completedOk = r.ok();
});
context.on("request", (request) => {
  if (request.method() !== "POST") return;
  const pathname = new URL(request.url()).pathname;
  if (pathname.endsWith("/api/complete")) record.completePosts++;
  if (pathname.endsWith("/api/save")) record.savePosts++;
});
const openPage = async () => {
  const page = await context.newPage();
  page.on("pageerror", () => {
    record.pageErrorCount++;
  });
  page.setDefaultTimeout(15_000);
  return page;
};
let page = await openPage();
const screen = (name: string) =>
  page.locator(`[data-qianzai-screen="${name}"]:visible`);
const screenshot = async (name: string) => {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() =>
    Array.from(document.images)
      .filter((img) => img.getClientRects().length > 0)
      .every((img) => img.complete && img.naturalWidth > 0),
  );
  await page.screenshot({ path: path.join(out, name + ".png") });
  record.screenshots.push(name + ".png");
};
const readReport = async (target: Page, sessionPath: string) => {
  const value = await target.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw Error("REPORT_READ_FAILED");
    return response.json();
  }, sessionPath + "/api/report");
  assert.equal(value.view.display.selectedResultRef.id, input.expectedResultId);
  assert.equal(value.view.display.body.volumes.length, 6);
  return { hash: value.receipt.reportSnapshotSha256 as string, value };
};
try {
  record.stage = "access";
  await page.goto(input.origin + "/access#key=" + input.rawKey);
  await expect(
    page.getByRole("button", { name: "验证访问", exact: true }),
  ).toBeEnabled();
  assert.equal(new URL(page.url()).hash, "");
  await page.getByRole("button", { name: "验证访问", exact: true }).click();
  await page.waitForURL(/\/play\/[a-f0-9-]+$/);
  const sessionPath = new URL(page.url()).pathname;
  if (input.resumeKnownSavedPrefix) {
    const session = await page.evaluate(
      async (url) => (await fetch(url)).json(),
      sessionPath + "/api/session",
    );
    assert.equal(session.outcome.kind, "editable");
    const state = session.outcome.state;
    assert.equal(state.answers.length, input.resumeKnownSavedPrefix);
    assert.equal(state.matchingContext.preference, input.preference);
    for (let i = 0; i < input.resumeKnownSavedPrefix; i++) {
      const answer = state.answers.find(
        (a: { questionId: string }) =>
          a.questionId === core.questions[i].ref.id,
      );
      assert.equal(
        answer?.optionId,
        core.questions[i].options[input.answerIndices[i]!].ref.id,
      );
    }
    assert.equal(
      state.progress.questionId,
      core.questions[input.resumeKnownSavedPrefix].ref.id,
    );

    record.cases.push(
      `verified-known-saved-prefix-${input.resumeKnownSavedPrefix}-without-replay`,
    );
  }
  if (!input.resumeKnownSavedPrefix) {
    await expect(
      page.getByRole("button", { name: "开启穿越之旅", exact: true }),
    ).toBeEnabled();
    await expect(screen("cover").locator("img").first()).toBeVisible();
    await screenshot("cover-390");
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    const preference = {
      female: "女，只匹配女性历史人物",
      male: "男，只匹配男性历史人物",
      any: "不选，不限制人物性别",
    }[input.preference];
    await page
      .getByRole("radio", { name: preference, exact: true })
      .locator("..")
      .click();
  }
  for (let i = input.resumeKnownSavedPrefix ?? 0; i < 24; i++) {
    record.stage = `question-${i + 1}`;
    const question = screen("question");
    await expect(
      question.getByRole("heading", {
        name: core.questions[i].prompt,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator('[data-qianzai-transition][data-active="true"]'),
    ).toHaveCount(0);
    const option = question.getByRole("radio").nth(input.answerIndices[i]!);
    await expect(option).toBeEnabled();
    if (i === (input.resumeKnownSavedPrefix ?? 0) || i === 8 || i === 16) {
      await expect(question).toHaveAttribute("data-qianzai-composite", "true");
      await screenshot(`act-${1 + Math.floor(i / 8)}-390`);
    }
    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname.endsWith("/api/save") &&
          r.request().method() === "POST",
      ),
      option.locator("..").click(),
    ]);
    assert.equal(saved.ok(), true);
    if (i === 7) {
      await expect(
        screen("question").getByRole("heading", {
          name: core.questions[8].prompt,
          exact: true,
        }),
      ).toBeVisible();
      await page.reload();
      await expect(
        screen("question").getByRole("heading", {
          name: core.questions[8].prompt,
          exact: true,
        }),
      ).toBeVisible();
      await page.close();
      page = await openPage();
      await page.goto(input.origin + sessionPath);
      await expect(
        screen("question").getByRole("heading", {
          name: core.questions[8].prompt,
          exact: true,
        }),
      ).toBeVisible();
      record.cases.push("reload-and-new-tab-resume-question-nine");
    }
  }
  record.stage = "complete";
  await expect(
    page.getByRole("button", { name: "下滑查看人物报告", exact: true }),
  ).toBeEnabled();
  await expect(screen("result").locator("img")).toHaveCount(2);
  await expect(
    screen("result").locator('[data-reveal-phase="ready"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-qianzai-transition][data-active="true"]'),
  ).toHaveCount(0);
  assert.equal(completedOk, true);
  await screenshot("reveal-390");
  await page
    .getByRole("button", { name: "下滑查看人物报告", exact: true })
    .click();
  await expect(screen("report")).toBeVisible();
  await expect(
    screen("report").locator("[data-report-chapter-id=encounter]"),
  ).toBeVisible();
  await expect(
    screen("report").locator("[data-report-chapter-id]"),
  ).toHaveCount(6);
  const report = await readReport(page, sessionPath);
  record.reportSha256 = report.hash;
  record.resultId = input.expectedResultId;
  await screenshot("report-390");
  record.cases.push("24-real-ui-answers-and-deterministic-report");
  record.stage = "exports";
  await page.getByRole("button", { name: "保存我的结果", exact: true }).click();
  await page.getByRole("button", { name: "查看图片预览", exact: true }).click();
  for (const kind of ["poster", "full-report"] as const) {
    const label = kind === "poster" ? "相逢海报" : "完整报告长图";
    if (kind === "full-report")
      await page
        .getByRole("button", { name: `切换为${label}`, exact: true })
        .click();
    const preview = page.getByRole("img", {
      name: `${label}原样预览`,
      exact: true,
    });
    await expect(preview).toBeVisible({ timeout: 30_000 });
    const bytes = await preview.evaluate(async (img: HTMLImageElement) =>
      Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())),
    );
    const expected = digest(Uint8Array.from(bytes));
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^保存 PNG/ }).click(),
    ]);
    const filename = path.join(out, kind + ".png");
    await download.saveAs(filename);
    const png = await readFile(filename),
      metadata = await sharp(png).metadata();
    assert.equal(digest(png), expected);
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, kind === "poster" ? 941 : 724);
    assert.ok(metadata.height! >= (kind === "poster" ? 1672 : 1000));
    record.exports.push({
      kind,
      width: metadata.width!,
      height: metadata.height!,
      bytes: png.length,
      sha256: expected,
    });
    await screenshot(kind + "-preview-390");
  }
  await page
    .getByRole("button", { name: "返回选择保存类型", exact: true })
    .click();
  await page.getByRole("button", { name: "关闭保存选项", exact: true }).click();
  record.cases.push("two-real-png-downloads-match-preview-bytes");
  record.stage = "readonly";
  await page.goto(input.origin + sessionPath + "/report");
  await expect(screen("report")).toBeVisible();
  assert.equal((await readReport(page, sessionPath)).hash, report.hash);
  await page.goto(input.origin + "/access#key=" + input.rawKey);
  await page.getByRole("button", { name: "验证访问", exact: true }).click();
  await page.waitForURL(/\/report$/);
  await expect(screen("report")).toBeVisible();
  assert.equal((await readReport(page, sessionPath)).hash, report.hash);
  assert.equal(record.completePosts, 1);
  assert.equal(record.pageErrorCount, 0);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  record.cases.push(
    "original-key-and-report-link-read-same-immutable-snapshot",
  );
  record.passed = true;
  record.stage = "complete";
} catch (error) {
  // Do not log Playwright call logs: they can contain the private access URL.
  record.failure =
    error instanceof Error
      ? error.message.split("\n")[0]!.replaceAll(input.rawKey, "[redacted]")
      : "UNKNOWN_PROBE_FAILURE";
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(record, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  await context.close();
  await browser.close();
  console.log(
    JSON.stringify({ passed: record.passed, stage: record.stage, out }),
  );
}
