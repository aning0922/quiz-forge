import { expect, type Browser } from "@playwright/test";
import type { consumerHostFixtureV1 } from "@/features/theme/consumer-v1/host.test-support";
import type { PersistedReportReceipt } from "@/features/report/persisted/view-contracts";
import { waitForConsumerCompletionAdoption } from "../e2e/consumer-flow.ui";

/** Actual host + synthetic HTTP. Hold original responses without changing controller behavior. */
export async function probeConsumerOperationReadiness(
  browser: Browser,
  base: string,
  fixture: Awaited<ReturnType<typeof consumerHostFixtureV1>>,
  receipt: PersistedReportReceipt,
  setCompleted: () => void,
) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const first = fixture.entry.facts.entry.questions[0]!,
    second = fixture.entry.facts.entry.questions[1]!;
  if (!second) throw Error("TWO_SYNTHETIC_QUESTIONS_REQUIRED");
  let releaseSave!: () => void,
    saveResponseHeld = false;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  try {
    await page.goto(`${base}/play/${fixture.session.sessionId}`);
    await page.getByRole("button", { name: "开始答题", exact: true }).click();
    const firstOption = page
      .locator(`input[type="radio"][name="consumer-question-${first.id}"]`)
      .first();
    const nextOption = page
      .locator(`input[type="radio"][name="consumer-question-${second.id}"]`)
      .first();
    await expect(firstOption).toBeEnabled();
    await firstOption.check();
    await page.route(
      "**/api/save",
      async (route) => {
        const response = await route.fetch({ timeout: 10_000 });
        expect(response.status()).toBe(200);
        saveResponseHeld = true;
        await saveGate;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "下一题", exact: true }).click();
    await expect.poll(() => saveResponseHeld).toBe(true);
    // Exact old loop: the old question remains visible, and checked .check() is a no-op.
    await expect(
      page.locator('[data-consumer-state="question"]'),
    ).toBeVisible();
    await expect(firstOption).toBeChecked();
    await expect(firstOption).toBeDisabled();
    await page.getByRole("radio").first().check({ timeout: 1_000 });
    await expect(nextOption).toHaveCount(0);
    releaseSave();
    // Actual proposed loop gate binds readiness to the expected immutable question ID.
    await expect(nextOption).toBeEnabled();
    await expect(nextOption).not.toBeChecked();
    const next = page.getByRole("button", {
      name:
        fixture.entry.facts.entry.questions.length === 2
          ? "检查并完成"
          : "下一题",
      exact: true,
    });
    await expect(next).toBeDisabled();
    await nextOption.check();
    await expect(next).toBeEnabled();
    await page.close();
  } finally {
    releaseSave();
    if (!page.isClosed()) await page.close();
  }

  setCompleted();
  const completed = await browser.newPage({
    viewport: { width: 390, height: 900 },
  });
  completed.setDefaultTimeout(10_000);
  completed.on("pageerror", (error) => errors.push(error.message));
  let releaseReport!: () => void,
    reportResponseHeld = false,
    reads = 0;
  const reportGate = new Promise<void>((resolve) => {
    releaseReport = resolve;
  });
  await completed.route("**/api/report", async (route) => {
    reads++;
    const response = await route.fetch({ timeout: 10_000 });
    expect(response.status()).toBe(200);
    if (reads === 2) {
      reportResponseHeld = true;
      await reportGate;
    }
    await route.fulfill({ response });
  });
  try {
    await completed.addInitScript(
      ({ id, binding }) => {
        sessionStorage.setItem(
          `quizforge:p4:consumer-pending:v1:${id}`,
          JSON.stringify({
            schemaVersion: "quizforge.consumer-client-pending.v1",
            operation: "complete",
            mayHaveBeenSent: true,
            binding,
          }),
        );
      },
      { id: fixture.session.sessionId, binding: receipt.binding },
    );
    await completed.goto(`${base}/play/${fixture.session.sessionId}`);
    await expect(
      completed.getByRole("heading", { name: "核对上一次操作", exact: true }),
    ).toBeVisible();
    await expect(
      completed.locator('[data-consumer-state="result"]'),
    ).toBeVisible();
    await completed
      .getByRole("button", { name: "核对原操作", exact: true })
      .click();
    await completed
      .getByRole("button", { name: "采用已核对结果", exact: true })
      .click();
    await expect.poll(() => reportResponseHeld).toBe(true);
    // The old result assertion passes while adoption is still busy, even after storage removal.
    await expect(
      completed.locator('[data-consumer-state="result"]'),
    ).toBeVisible();
    const pendingRemoved = await completed.evaluate(
      (id) =>
        sessionStorage.getItem(`quizforge:p4:consumer-pending:v1:${id}`) ===
        null,
      fixture.session.sessionId,
    );
    expect(pendingRemoved).toBe(true);
    let ready = false;
    const readiness = waitForConsumerCompletionAdoption(
      completed,
      fixture.session.sessionId,
    ).then(() => {
      ready = true;
    });
    await expect(
      completed.getByText("正在核对并保存，请稍候。", { exact: true }),
    ).toBeVisible();
    await expect(
      completed.getByRole("button", { name: "展开报告", exact: true }),
    ).toBeEnabled();
    expect(ready).toBe(false);
    releaseReport();
    await readiness;
    expect(ready).toBe(true);
    expect(reads).toBe(2);
    expect(errors).toEqual([]);
    return {
      save: {
        oldQuestionVisible: true,
        oldCheckedDisabledCheckReturned: true,
        nextQuestionInitiallyUnselected: true,
        exactQuestionEnabledGatePassed: true,
      },
      adoption: {
        oldResultVisibleDuringHeldReport: true,
        pendingRemovedBeforeReport: true,
        readonlyControlAlreadyEnabledWhileBusy: true,
        correctedGateBlockedThenPassed: true,
        reportReads: reads,
      },
      pageErrors: errors,
    };
  } finally {
    releaseReport();
    await completed.close();
  }
}
