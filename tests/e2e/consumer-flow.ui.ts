import { constants } from "node:fs";
import { open, mkdir, chmod, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import {
  digestConsumerToken,
  CONSUMER_COOKIE_NAME_V1,
  verifyConsumerCsrf,
  parseConsumerToken,
} from "../../src/lib/consumer-contract/v1/credentials";
import { verifyConsumerSessionView } from "../../src/features/fulfillment/consumer-flow/contracts";
import { consumerSessionUrl } from "../../src/features/fulfillment/consumer-flow/urls";
import type { AccessKeyDetail } from "../../src/features/fulfillment/access/contracts";
import type { ConsumerFixtureObservations } from "../db/p4-consumer-fixture-contract";
import { sampleStudioLayout, assertStudioLayout } from "./studio-layout";
import { waitForConsumerCaptureReady } from "./consumer-flow.visual";
import { consumerGet } from "./consumer-flow.network";
import { consumerRunId } from "./consumer-flow.fixture";

const unavailable = () => Error("CONSUMER_E2E_PRIVATE_UI_UNAVAILABLE");

/** A reloaded completed report can already be visible before pending adoption. */
export async function waitForConsumerCompletionAdoption(
  page: Page,
  sessionId: string,
) {
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          sessionStorage.getItem(`quizforge:p4:consumer-pending:v1:${id}`) ===
          null,
        sessionId,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "核对上一次操作", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("正在核对并保存，请稍候。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-consumer-state="result"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "展开报告", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "查看海报", exact: true }),
  ).toBeEnabled();
}

const privateDirectory = () =>
  path.resolve(".cache/p4-e2e-private", consumerRunId());
async function verifyPrivateDirectory(directory: string) {
  const st = await lstat(directory);
  if (
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid?.() ||
    (st.mode & 0o777) !== 0o700 ||
    (await realpath(directory)) !== directory
  )
    throw unavailable();
}
async function ensurePrivateDirectory() {
  try {
    await mkdir(path.dirname(privateDirectory()), { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  // The parent may pre-exist for other runs, but is never chmod'ed or followed through a symlink.
  await verifyPrivateDirectory(path.dirname(privateDirectory()));
  try {
    await mkdir(privateDirectory(), { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await verifyPrivateDirectory(privateDirectory());
}
async function privateLinkText(file: string) {
  if (path.dirname(file) !== privateDirectory()) throw unavailable();
  await verifyPrivateDirectory(path.dirname(privateDirectory()));
  await verifyPrivateDirectory(privateDirectory());
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const st = await handle.stat();
    if (
      !st.isFile() ||
      st.uid !== process.getuid?.() ||
      (st.mode & 0o777) !== 0o600 ||
      st.nlink !== 1 ||
      st.size > 4096
    )
      throw unavailable();
    const buffer = Buffer.alloc(4097),
      { bytesRead } = await handle.read(buffer, 0, buffer.length, 0),
      after = await handle.stat();
    if (
      bytesRead !== st.size ||
      after.ino !== st.ino ||
      after.dev !== st.dev ||
      after.size !== st.size ||
      after.mtimeMs !== st.mtimeMs ||
      after.nlink !== 1 ||
      (after.mode & 0o777) !== 0o600
    )
      throw unavailable();
    return new TextDecoder("utf-8", { fatal: true })
      .decode(buffer.subarray(0, bytesRead))
      .trim();
  } finally {
    await handle.close();
  }
}
export async function downloadIssuedPrivateLink(
  page: Page,
  key: AccessKeyDetail,
) {
  try {
    const directory = privateDirectory();
    await ensurePrivateDirectory();
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下载私密链接文件", exact: true })
      .click();
    const download = await downloadPromise,
      file = path.join(directory, `${key.issue.binding.keyId}.txt`);
    // Reserve exclusively; retries cannot overwrite evidence from an earlier run.
    const handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.close();
    await download.saveAs(file);
    await chmod(file, 0o600);
    const url = new URL(await privateLinkText(file));
    if (
      url.origin !== "http://127.0.0.1:3100" ||
      url.pathname !== "/access" ||
      url.search ||
      !url.hash.startsWith("#key=") ||
      (await digestConsumerToken(url.hash.slice(5), "access-key")) !==
        key.issue.binding.credentialDigest
    )
      throw unavailable();
    return file;
  } catch {
    throw unavailable();
  }
}
/** The raw never appears in goto/fill/APIRequest/expect arguments or a Node error. */
export async function openPrivateConsumerLink(page: Page, file: string) {
  try {
    const url = new URL(await privateLinkText(file)),
      raw = url.hash.slice(5);
    if (
      url.origin !== "http://127.0.0.1:3100" ||
      url.pathname !== "/access" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash !== "#key=" + raw ||
      !parseConsumerToken(raw, "access-key")
    )
      throw unavailable();
    // The Access effect consumes the fragment only on mount. Starting from the
    // same /access document could make replace hash-only and leave that effect
    // already finished. Always navigate a safe different document first.
    await page.goto("about:blank");
    if (page.url() !== "about:blank") throw unavailable();
    // The validated absolute private link crosses only evaluate; never goto,
    // fill, APIRequest, expect or logs. Trace/video remain disabled.
    await page.evaluate((value) => {
      location.replace(value);
    }, url.href);
    await expect(
      page.getByRole("button", { name: "验证访问", exact: true }),
    ).toBeEnabled();
    if (
      !(await page.evaluate(
        () =>
          location.pathname === "/access" &&
          location.search === "" &&
          location.hash === "" &&
          !/qf[kg]_p4_/.test(document.documentElement.outerHTML) &&
          !Object.values(localStorage).some((value) =>
            /qf[kg]_p4_/.test(value),
          ) &&
          !Object.values(sessionStorage).some((value) =>
            /qf[kg]_p4_/.test(value),
          ),
      ))
    )
      throw unavailable();
  } catch {
    throw unavailable();
  }
}
export async function observeConsumerGrant(page: Page, sessionId: string) {
  try {
    const response = await consumerGet(page, consumerSessionUrl(sessionId));
    if (response.status() !== 200) throw unavailable();
    const view = await verifyConsumerSessionView(
        await response.json(),
        sessionId,
      ),
      cookies = await page
        .context()
        .cookies("http://127.0.0.1:3100" + consumerSessionUrl(sessionId));
    const matching = cookies.filter(
      (c) =>
        c.name === CONSUMER_COOKIE_NAME_V1 && c.path === `/play/${sessionId}`,
    );
    if (
      matching.length !== 1 ||
      !matching[0]!.httpOnly ||
      matching[0]!.sameSite !== "Strict" ||
      !(await verifyConsumerCsrf(matching[0]!.value, view.grant.csrf))
    )
      throw unavailable();
    const credentialDigest = await digestConsumerToken(
      matching[0]!.value,
      "grant",
    );
    if (!credentialDigest) throw unavailable();
    const observation: ConsumerFixtureObservations["grants"][number] = {
      source: "verified-bootstrap-and-cookie-digest",
      grantId: view.grant.grantId,
      session: view.grant.session,
      credentialDigest,
      issuedAt: view.grant.issuedAt,
      expiresAt: view.grant.expiresAt,
      logoutObserved: false,
    };
    return { view, observation };
  } catch {
    throw unavailable();
  }
}
export async function captureConsumerWidths(
  page: Page,
  info: TestInfo,
  state: string,
) {
  if (!/^[a-z-]{1,60}$/.test(state)) throw unavailable();
  await waitForConsumerCaptureReady(page, state);
  for (const width of [320, 375, 390, 430]) {
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          !/qf[kg]_p4_/.test(document.documentElement.outerHTML),
      ),
    ).toBe(true);
    assertStudioLayout(
      await sampleStudioLayout(page, {
        fontSelector: "",
        targetSelector: "main button, main a, main select",
        appliedReceipts: false,
      }),
      { minimumTargetWidth: 44 },
    );
    await page.screenshot({
      path: info.outputPath(`p4-${state}-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
}
