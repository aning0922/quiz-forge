import { expect, type Page, type TestInfo } from "@playwright/test";
import { sampleStudioLayout, assertStudioLayout } from "./studio-layout";
import { waitForPreviewCaptureReady } from "./studio-preview.visual";

const previewStates = [
  "original-r1-result",
  "retained-r1-result",
  "retained-r2-result",
];
const historyStates = [
  "corrupt-anchor-history-readable",
  "stable-anchor2-current3",
  "read-only-final-history",
];
const validationStates = [
  "read-only-r1",
  "legacy-anchor-blocked",
  "append-r2-confirmation",
  "source503-r2-fixed-receipt",
  "source404-r2-fixed-receipt",
  "r3-confirmed-fixed-receipt",
  "obsolete-original-base2",
  "source-used-source-import",
  "source-used-canonical-manifest",
];

export async function waitForRevisionCaptureReady(page: Page, state: string) {
  if (previewStates.includes(state))
    return waitForPreviewCaptureReady(page, "result");
  if (!historyStates.includes(state) && !validationStates.includes(state))
    throw Error("REVISION_CAPTURE_STATE_UNRECOGNIZED");
  const pending = page.getByRole("region", {
    name: "草稿更新操作查询",
    exact: true,
  });
  await expect(pending).toHaveCount(1);
  if (state === "corrupt-anchor-history-readable") {
    // This is a terminal failed local read: its !loaded notice must remain.
    await expect(
      pending.getByText("无法可靠核对操作记录", { exact: false }),
    ).toBeVisible();
    await expect(
      pending.getByText(
        "正在检查上次更新操作，请稍候；检查完成前不能重复提交。",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
  } else {
    await expect(
      pending.getByText(
        "正在检查上次更新操作，请稍候；检查完成前不能重复提交。",
        {
          exact: true,
        },
      ),
    ).toHaveCount(0);
    if (
      [
        "source503-r2-fixed-receipt",
        "source404-r2-fixed-receipt",
        "obsolete-original-base2",
        "source-used-source-import",
        "source-used-canonical-manifest",
      ].includes(state)
    ) {
      await expect(
        pending.getByRole("button", {
          name: "查询上次草稿更新结果",
          exact: true,
        }),
      ).toBeEnabled();
    } else {
      await expect(
        pending.getByText("此浏览器会话没有此工作区的待确认追加请求。", {
          exact: true,
        }),
      ).toBeAttached();
    }
  }
  await expect(
    pending.getByText("正在核实或处理原操作…", { exact: true }),
  ).toHaveCount(0);
  if (historyStates.includes(state)) {
    await expect(
      page.getByRole("button", { name: "读取当前草稿", exact: true }),
    ).toBeEnabled();
    const mainRead = page.locator("section").filter({
      has: page.getByRole("heading", { name: "内容草稿", exact: true }),
    });
    await expect(
      mainRead.getByText("正在读取草稿…", { exact: true }),
    ).toHaveCount(0);
    await expect(mainRead.getByRole("alert")).toHaveCount(0);
    const firstPending = page.getByRole("region", {
      name: "草稿创建操作查询",
      exact: true,
    });
    await expect(
      firstPending.getByText("此浏览器会话未保存此工作区的待确认应用请求。", {
        exact: true,
      }),
    ).toBeAttached();
    const history = page.getByRole("region", {
      name: "草稿历史修订",
      exact: true,
    });
    await expect(
      history.locator("[data-history-revision]").first(),
    ).toBeVisible();
    await expect(
      history.getByText("正在读取固定历史页…", { exact: true }),
    ).toHaveCount(0);
    await expect(history.getByRole("alert")).toHaveCount(0);
    await expect(
      history.getByRole("button", {
        name: "重新读取历史（新上界）",
        exact: true,
      }),
    ).toBeEnabled();
    return;
  }
  const record = page.locator("section").filter({
    has: page.getByRole("heading", { name: "内容检查结果", exact: true }),
  });
  await expect(
    record.getByRole("button", { name: "查询最新检查结果", exact: true }),
  ).toBeEnabled();
  await expect(
    record.getByText("正在读取服务器验证状态…", { exact: true }),
  ).toHaveCount(0);
  const first = page.getByRole("region", {
    name: "建立第一版草稿",
    exact: true,
  });
  const sourceError =
    state === "source503-r2-fixed-receipt" ||
    state === "source404-r2-fixed-receipt";
  if (sourceError) {
    await expect(record.getByRole("alert")).toHaveCount(1);
    await expect(first).toHaveCount(0);
  } else {
    await expect(record.getByRole("alert")).toHaveCount(0);
    await expect(first).toHaveCount(1);
    await expect(
      first.getByText("正在核对工作区与本页操作记录…", { exact: true }),
    ).toHaveCount(0);
    await expect(
      first.getByRole("button", { name: "刷新草稿与工作区状态", exact: true }),
    ).toBeEnabled();
    await expect(first.getByRole("alert")).toHaveCount(0);
    if (state === "legacy-anchor-blocked")
      await expect(
        first.getByRole("region", { name: "待确认的原操作编号", exact: true }),
      ).toBeVisible();
    else
      await expect(
        first.getByText("此工作区已有草稿，不能建立第二份草稿。", {
          exact: true,
        }),
      ).toBeVisible();
  }
  const append = page.getByRole("region", {
    name: "更新草稿",
    exact: true,
  });
  await expect(
    append.getByRole("heading", { name: /^本次更新所依据的草稿：修订 \d+$/ }),
  ).toBeVisible();
  await expect(
    append.getByText("正在核对当前草稿和工作区状态…", { exact: true }),
  ).toHaveCount(0);
  await expect(append.getByRole("alert")).toHaveCount(0);
  const unavailable = append.getByText(
    "此工作区有原操作待核实，或本地操作记录存储不可用。新准备保持关闭。",
    { exact: true },
  );
  if (
    [
      "read-only-r1",
      "append-r2-confirmation",
      "r3-confirmed-fixed-receipt",
    ].includes(state)
  )
    await expect(unavailable).toHaveCount(0);
  else await expect(unavailable).toBeVisible();
}

export async function captureRevisionWidths(
  page: Page,
  info: TestInfo,
  state: string,
) {
  await waitForRevisionCaptureReady(page, state);
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    assertStudioLayout(await sampleStudioLayout(page));
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    const height = await page.evaluate(() =>
      Math.max(innerHeight, document.documentElement.scrollHeight),
    );
    const png = await page.screenshot({
      path: info.outputPath(`draft-revisions-${state}-${width}.png`),
      fullPage: true,
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
