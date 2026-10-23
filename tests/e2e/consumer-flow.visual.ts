import { expect, type Page } from "@playwright/test";

export async function waitForConsumerCaptureReady(page: Page, state: string) {
  const screens: Readonly<Record<string, string>> = {
    "consumer-cover": "cover",
    "completed-result": "result",
    "readonly-report": "report",
    "readonly-poster": "poster",
  };
  const screen = screens[state];
  if (state === "operator-key-list") {
    // finishStudioPending already waits the controller's joint read completion.
    await expect(
      page.getByRole("combobox", { name: "固定内测内容版本", exact: true }),
    ).toBeEnabled();
    return;
  }
  if (state === "completion-review") {
    await expect(
      page.getByRole("heading", { name: "确认完成本次测评", exact: true }),
    ).toBeVisible();
    return; // This view intentionally has no media task.
  }
  if (state === "save-unknown-restored") {
    await expect(page.locator('[data-consumer-state="resume"]')).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "核对上一次操作", exact: true }),
    ).toBeVisible();
    // Bootstrap deliberately restores pending operations to resume, whose view
    // has no VerifiedMedia. Keep UNKNOWN and its disabled navigation intact.
    await expect(
      page.locator('[data-consumer-state="resume"] [data-consumer-media]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-consumer-state="resume"] button:enabled'),
    ).toHaveCount(0);
    return;
  }
  if (!screen) throw Error("CONSUMER_CAPTURE_STATE_UNRECOGNIZED");
  const surface = page.locator(`[data-consumer-state="${screen}"]`);
  await expect(surface).toHaveCount(1);
  await expect(surface).toBeVisible();
  // The host's verified screen media is independent from entry/report HTTP and
  // from the exporter's separate asset task. Keep pending/UNKNOWN controls intact.
  const media = surface.locator('[data-consumer-media="ready"] img');
  await expect(media).toHaveCount(1);
  await expect(media).toBeVisible();
  await expect
    .poll(() =>
      media.evaluate(
        (img) =>
          img instanceof HTMLImageElement &&
          img.complete &&
          img.naturalWidth > 0,
      ),
    )
    .toBe(true);
}
