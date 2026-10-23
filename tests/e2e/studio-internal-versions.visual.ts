import { expect, type Page } from "@playwright/test";

/** Wait only the readers/local initial reads owned by the photographed page.
 * Persistent UNKNOWN, denial and recovery evidence are intentional final UI. */
export async function waitForInternalCaptureReady(page: Page, state: string) {
  const listStates = [
    "readonly-review-resolved",
    "readonly-seal-resolved",
    "historical-list",
  ];
  const reviewStates = [
    "review-recorded",
    "unregistered-r2",
    "review-confirmation",
    "seal-confirmation",
    "review-unknown",
    "seal-unknown",
    "review-replayed",
    "seal-replayed",
    "review-resolved-detail-error",
    "seal-resolved-detail-error",
    "review-obsolete",
    "seal-obsolete",
    "authority-get401",
    "authority-get404",
    "authority-other-panel403",
    "authority-csrf403",
  ];
  if (state === "sealed-detail") {
    await expect(
      page.getByRole("button", { name: "重新读取并核对完整快照", exact: true }),
    ).toBeEnabled();
    const detail = page.locator("section").filter({
      has: page.getByRole("heading", { name: "固定内容版本详情", exact: true }),
    });
    await expect(detail.getByRole("alert")).toHaveCount(0);
    // Snapshot visibility proves only one read; this relation proves the
    // independent draft-head reader too, without refreshing either identity.
    await expect(
      detail.getByText("封存来源为本次读取的当前修订", { exact: true }),
    ).toBeVisible();
  } else if (listStates.includes(state)) {
    await expect(
      page.getByRole("button", { name: "重新读取固定版本列表", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "读取当前草稿指针", exact: true }),
    ).toBeEnabled();
    const list = page.locator("section").filter({
      has: page.getByRole("heading", { name: "固定内测内容版本", exact: true }),
    });
    await expect(list.getByRole("alert")).toHaveCount(0);
    await expect(list.getByText(/^已占用固定槽位：/)).toBeVisible();
    await expect(
      list.getByRole("link", { name: /^当前修订 \d+ 的基线与封存$/ }),
    ).toBeVisible();
  } else if (reviewStates.includes(state)) {
    const read = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: /^固定修订 \d+ · 已有审核依据$/,
      }),
    });
    // Disabled until BOTH independent revision/capacity reads settle, including
    // finite errors. Never require the error scenarios to become successful.
    await expect(
      read.getByRole("button", {
        name: "重新读取修订事实与封存容量",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      read.getByText("正在核对修订与审核依据记录…", { exact: true }),
    ).toHaveCount(0);
    const twoErrors = ["authority-get401", "authority-get404"].includes(state);
    const readError = state.endsWith("-resolved-detail-error");
    await expect(read.getByRole("alert")).toHaveCount(
      twoErrors ? 2 : readError ? 1 : 0,
    );
    if (!state.startsWith("authority-")) {
      await expect(read.getByText(/^已占用固定槽位：/)).toBeVisible();
      if (!readError)
        await expect(
          read.getByText("本次读取的当前修订：", { exact: false }),
        ).toBeVisible();
    }
    const write = page.getByRole("region", {
      name: "记录审核依据与固定内容版本",
      exact: true,
    });
    const unavailable = write.getByText(
      "尚未可靠确认四类请求均无待确认本地操作记录，新准备保持关闭。请先处理对应原操作核实区。",
      { exact: true },
    );
    if (
      [
        "review-recorded",
        "unregistered-r2",
        "review-confirmation",
        "seal-confirmation",
      ].includes(state)
    )
      await expect(unavailable).toHaveCount(0);
    else await expect(unavailable).toBeVisible();
    await expect(
      write.getByText("正在发送固定请求；请等待或保留原操作记录核实…", {
        exact: true,
      }),
    ).toHaveCount(0);
  } else throw Error("INTERNAL_CAPTURE_STATE_UNRECOGNIZED");
  for (const label of ["审核依据记录", "内容版本固定"]) {
    const pending = page.getByRole("region", {
      name: `${label}操作查询`,
      exact: true,
    });
    await expect(pending).toHaveCount(1);
    await expect(
      pending.getByText("正在检查上次操作，请稍候；检查完成前不能继续提交。", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      pending.getByText("正在核实或处理原操作…", { exact: true }),
    ).toHaveCount(0);
  }
}
