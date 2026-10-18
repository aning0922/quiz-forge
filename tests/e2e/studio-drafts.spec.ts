import { test, expect, type Page } from "@playwright/test";
import { constants } from "node:fs";
import { captureDraftMobile as mobile } from "./studio-drafts.visual";
import { open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  studioDraftFixtureSchema,
  type StudioDraftFixture,
} from "../db/p2b3-studio-contract";
import {
  DRAFT_PENDING_STORAGE_KEY,
  draftPendingEntrySchema,
} from "../../src/features/studio/drafts/pending";
import {
  draftApplicationBindingSchema,
  type DraftApplicationBinding,
} from "../../src/features/product/drafts/contracts";
// This suite proves B3 PG/HTTP/UI behavior using synthetic DB-ready sources.
// No media decoder or actual archive files are executed or certified by this fixture.
// The >1MiB source is a synthetic historical DB snapshot, not new P1 package issuance.
test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
const runId = randomUUID(),
  execute = promisify(execFile),
  helper = path.resolve("tests/db/p2b3-studio-fixture.ts");
let fixture: StudioDraftFixture,
  original: DraftApplicationBinding,
  allPassed = true;
async function command(mode: "prepare" | "finish" | "archive") {
  try {
    await execute(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", helper, mode, runId],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: 60_000,
        maxBuffer: 4096,
      },
    );
  } catch {
    throw new Error("DRAFTS_E2E_FIXTURE_FAILED");
  }
}
async function readFixture() {
  try {
    const config = process.env.QUIZFORGE_P2A_CONFIG;
    if (!config || !path.isAbsolute(config)) throw new Error();
    const file = await open(
      path.join(path.dirname(config), "drafts-e2e-fixture.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
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
      const value = studioDraftFixtureSchema.parse(
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
    throw new Error("DRAFTS_E2E_FIXTURE_UNAVAILABLE");
  }
}
const source = (index = 0) => fixture.sources[index]!;
const detail = (index = 0) => {
  const s = source(index);
  return `/studio/products/${s.productId}/imports/${s.sourceImportId}/validations/${s.sourceValidationId}`;
};
const workspace = (index = 0) =>
  `/studio/products/${source(index).productId}/draft`;
const postApi = () =>
  `**/api/studio/products/${source().productId}/imports/${source().sourceImportId}/validations/${source().sourceValidationId}/apply`;
async function signIn(page: Page, role: "operator" | "readOnly" = "operator") {
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
    throw new Error("DRAFTS_E2E_INPUT_UNAVAILABLE");
  }
  await page.getByRole("button", { name: "登录 Studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "运营会话", exact: true }),
  ).toBeVisible();
}
async function pending(page: Page) {
  const value = await page.evaluate((key) => {
    const text = sessionStorage.getItem(key);
    if (!text) return null;
    const bucket = JSON.parse(text) as { entries?: unknown[] };
    return bucket.entries?.[0] ?? null;
  }, DRAFT_PENDING_STORAGE_KEY);
  return value === null ? null : draftPendingEntrySchema.parse(value);
}
test.beforeAll(async () => {
  await command("prepare");
  fixture = await readFixture();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) allPassed = false;
});
test.afterAll(async () => {
  if (allPassed)
    await command(
      "finish",
    ); /* Root cleans only after its owned Next actually exits. Failures retain all fixture rows. */
});

test("synthetic DB eligibility: read-only empty source has no executable apply action", async ({
  page,
}, info) => {
  await signIn(page, "readOnly");
  await page.goto(detail());
  const panel = page.getByRole("region", { name: "首次草稿应用", exact: true });
  await expect(
    panel.getByRole("link", { name: "查看服务器草稿", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("当前身份为只读", { exact: false }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "应用为首次草稿", exact: true }),
  ).toHaveCount(0);
  await mobile(page, info, "read-only-empty");
  await page.goto(workspace());
  await expect(
    page.getByText("服务器当前没有草稿。", { exact: false }),
  ).toBeVisible();
});

test("storage failure produces zero POST and retains an unusable anchor", async ({
  page,
}) => {
  await signIn(page);
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key)
        throw new DOMException("synthetic unavailable", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, DRAFT_PENDING_STORAGE_KEY);
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/apply")) posts++;
  });
  await page.goto(detail());
  await page
    .getByRole("button", { name: "应用为首次草稿", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认应用为草稿修订 1", exact: true })
    .click();
  await expect(
    page.getByText("本页无法可靠保存或核对请求锚点。", { exact: false }),
  ).toBeVisible();
  expect(posts).toBe(0);
});

test("authorization denial closes apply and replay controls while preserving the sent tuple", async ({
  page,
}) => {
  await signIn(page);
  const s = source(1);
  let posts = 0;
  await page.route(
    `**/api/studio/products/${s.productId}/imports/${s.sourceImportId}/validations/${s.sourceValidationId}/apply`,
    async (route) => {
      posts++;
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          code: "CAPABILITY_DENIED",
          requestId: randomUUID(),
        }),
      });
    },
  );
  await page.goto(detail(1));
  await page
    .getByRole("button", { name: "应用为首次草稿", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认应用为草稿修订 1", exact: true })
    .click();
  await expect(
    page.getByText("当前会话或写入权限已失效", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "明确按原 key 重放", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "应用为首次草稿", exact: true }),
  ).toHaveCount(0);
  const anchor = await pending(page);
  expect(anchor?.mayHaveBeenSent).toBe(true);
  expect(anchor?.tuple.productId).toBe(s.productId);
  await page
    .getByRole("button", { name: "刷新草稿与工作区状态", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "核对原 key 回执", exact: true }),
  ).toBeEnabled();
  expect(await pending(page)).toEqual(anchor);
  expect(posts).toBe(1);
});

test("real PG apply loses its response; empty lookup and finite error preserve exact original key; manual replay returns fixed receipt", async ({
  page,
}, info) => {
  await signIn(page);
  let committed = 0;
  await page.route(
    postApi(),
    async (route) => {
      original = draftApplicationBindingSchema.parse({
        productId: source().productId,
        sourceImportId: source().sourceImportId,
        sourceValidationId: source().sourceValidationId,
        ...JSON.parse(route.request().postData()!),
      });
      const response = await route.fetch();
      if (response.status() !== 201)
        throw new Error("DRAFTS_EXPECTED_REAL_COMMIT");
      committed++;
      await route.abort("connectionfailed");
    },
    { times: 1 },
  );
  await page.goto(detail());
  await page
    .getByRole("button", { name: "应用为首次草稿", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认应用为草稿修订 1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "此工作区有待确认请求", exact: true }),
  ).toBeVisible();
  expect(committed).toBe(1);
  expect((await pending(page))?.tuple).toEqual(original);
  await mobile(page, info, "unknown");
  await page.goto(workspace());
  await expect(
    page.getByRole("heading", { name: "原 key 核实", exact: true }),
  ).toBeVisible();
  const lookup = `**/api/studio/products/${source().productId}/draft-applications/${original.idempotencyKey}`;
  await page.route(
    lookup,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          kind: "empty",
          productId: original.productId,
          idempotencyKey: original.idempotencyKey,
        }),
      }),
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "核对原 key 回执", exact: true })
    .click();
  await expect(
    page.getByText("尚无匹配回执；原 key 继续保留。", { exact: false }),
  ).toBeVisible();
  expect((await pending(page))?.tuple).toEqual(original);
  await page.route(
    postApi(),
    (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "DRAFT_ALREADY_EXISTS",
          requestId: randomUUID(),
        }),
      }),
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "明确按原 key 重放", exact: true })
    .click();
  await expect(
    page.getByText("此工作区已有草稿。请查看服务器草稿", { exact: false }),
  ).toBeVisible();
  expect((await pending(page))?.tuple).toEqual(original);
  // A malformed full-tuple success cannot clear a previously unknown request.
  await page.route(
    lookup,
    async (route) => {
      const response = await route.fetch();
      const value = await response.json();
      await route.fulfill({
        response,
        json: {
          ...value,
          application: {
            ...value.application,
            expectedValidationStateRevision:
              original.expectedValidationStateRevision + 1,
          },
        },
      });
    },
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "核对原 key 回执", exact: true })
    .click();
  await expect(
    page.getByText("Studio 暂不可用", { exact: false }),
  ).toBeVisible();
  expect((await pending(page))?.tuple).toEqual(original);
  const replay = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/apply"),
  );
  await page
    .getByRole("button", { name: "明确按原 key 重放", exact: true })
    .click();
  expect((await replay).status()).toBe(200);
  await expect.poll(() => pending(page)).toBeNull();
  await expect(
    page.getByText("服务器已确认原 key 的固定应用回执。", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("link", { name: "读取固定修订正文", exact: true }),
  ).toBeVisible();
  await mobile(page, info, "draft-summary");
});

test("full escaped historical synthetic content is hash-checked and read-only across refresh", async ({
  page,
}, info) => {
  await signIn(page);
  await page.goto(workspace());
  await page
    .getByRole("link", { name: "读取固定修订正文", exact: true })
    .click();
  const body = page.getByRole("textbox", { name: "完整内容正文", exact: true });
  await expect(body).toBeVisible();
  const facts = await body.evaluate(async (element) => {
    const text = (element as HTMLTextAreaElement).value,
      bytes = new TextEncoder().encode(text),
      digest = await crypto.subtle.digest("SHA-256", bytes);
    return {
      bytes: bytes.length,
      sha: [...new Uint8Array(digest)]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join(""),
    };
  });
  expect(facts).toEqual({
    bytes: source().canonicalContentBytes,
    sha: source().canonicalContentSha256,
  });
  expect(facts.bytes).toBeGreaterThan(1048576);
  await expect(body).toHaveAttribute("readonly", "");
  await mobile(page, info, "revision-body");
  await page.reload();
  await expect(body).toBeVisible();
});

test("archived Product still reconciles the already committed original key; read-only cannot replay", async ({
  page,
}, info) => {
  await command("archive");
  await signIn(page);
  await page.goto(workspace());
  await page.evaluate(
    ({ key, tuple }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: key,
          entries: [{ tuple, mayHaveBeenSent: true }],
        }),
      ),
    { key: DRAFT_PENDING_STORAGE_KEY, tuple: original },
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "明确按原 key 重放", exact: true }),
  ).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/apply"),
  );
  await page
    .getByRole("button", { name: "明确按原 key 重放", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect.poll(() => pending(page)).toBeNull();
  await expect(
    page.getByRole("button", { name: "读取服务器草稿", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("link", { name: "读取固定修订正文", exact: true }),
  ).toBeVisible();
  await mobile(page, info, "archived-receipt");
});

test("read-only archived workspace preserves pending until the exact successful lookup", async ({
  page,
}, info) => {
  await signIn(page, "readOnly");
  await page.goto(workspace());
  await page.evaluate(
    ({ key, tuple }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: key,
          entries: [{ tuple, mayHaveBeenSent: true }],
        }),
      ),
    { key: DRAFT_PENDING_STORAGE_KEY, tuple: original },
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "核对原 key 回执", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "明确按原 key 重放", exact: true }),
  ).toHaveCount(0);
  expect((await pending(page))?.tuple).toEqual(original);
  await mobile(page, info, "read-only-unknown");
  await page
    .getByRole("button", { name: "核对原 key 回执", exact: true })
    .click();
  await expect.poll(() => pending(page)).toBeNull();
});

test("late reads cannot display the prior Product after navigation", async ({
  page,
}) => {
  await signIn(page);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  await page.route(
    `**/api/studio/products/${source().productId}/draft`,
    async (route) => {
      entered();
      await gate;
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            kind: "empty",
            productId: source().productId,
          }),
        });
      } catch {
        /* The old navigation may have aborted the original request. */
      }
    },
    { times: 1 },
  );
  try {
    await page.goto(workspace());
    await started;
    await page.goto(workspace(1));
    release();
    await expect(
      page.getByText("服务器当前没有草稿。", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "返回工作区", exact: true }),
    ).toHaveAttribute("href", `/studio/products/${source(1).productId}`);
    await expect(
      page.getByText(source().productId, { exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});
