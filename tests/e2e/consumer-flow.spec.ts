import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type TestInfo,
  type Page,
  type Route,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  CONSUMER_E2E_CASES as CASES,
  type ConsumerFixture,
  type ConsumerFixtureObservations,
} from "../db/p4-consumer-fixture-contract";
import {
  consumerFixtureCommand,
  readConsumerE2eFixture,
  writeConsumerE2eObservations,
  consumerRunId,
  ConsumerSuiteCompletion,
} from "./consumer-flow.fixture";
import {
  consumerGet,
  consumerPost,
  consumerRouteFetch,
  consumerCrossSessionGet,
} from "./consumer-flow.network";
import {
  captureConsumerWidths,
  downloadIssuedPrivateLink,
  openPrivateConsumerLink,
  observeConsumerGrant,
  waitForConsumerCompletionAdoption,
} from "./consumer-flow.ui";
import { signInInternalOperator } from "./studio-internal-versions.ui";
import * as urls from "../../src/features/fulfillment/consumer-flow/urls";
import {
  internalPlayListSchema,
  internalPlayReceiptSchema,
  type InternalPlayReceipt,
} from "../../src/features/product/internal-play/contracts";
import {
  verifyAccessKeyDetail,
  accessKeyListSchema,
  voidUnusedAccessKeyBindingSha256,
  type AccessKeyDetail,
} from "../../src/features/fulfillment/access/contracts";
import {
  verifyVoidUnusedAccessKeyResolution,
  verifyIssueAccessKeyResolution,
} from "../../src/features/fulfillment/consumer-flow/operator-resolutions";
import {
  verifyConsumerEntryView,
  type ConsumerEntryView,
} from "../../src/features/fulfillment/consumer-flow/display-contract";
import {
  verifyConsumerSaveInput,
  verifyConsumerState,
  type ConsumerSaveInput,
} from "../../src/lib/consumer-contract/v1/state";
import {
  verifyConsumerSaveResolution,
  verifyConsumerCompleteResolution,
} from "../../src/features/fulfillment/consumer-flow/contracts";
import {
  verifyPersistedReportView,
  consumerCompleteBindingSchema,
  type ConsumerCompleteBinding,
} from "../../src/features/report/persisted/view-contracts";
import { CONSUMER_COOKIE_NAME_V1 } from "../../src/lib/consumer-contract/v1/credentials";
import { sameConsumerFact } from "../../src/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "../../src/lib/consumer-contract/v1/limits";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
const completion = new ConsumerSuiteCompletion();
let fixture: ConsumerFixture,
  observations: ConsumerFixtureObservations,
  operator: Page,
  buyer: Page,
  play: InternalPlayReceipt,
  entry: ConsumerEntryView,
  sessionId: string;
type OperatorStage =
  | "not-started"
  | "initial-read"
  | "create-play"
  | "confirm-play"
  | "issue-key"
  | "export-private-link"
  | "final-list-capture";
let operatorStage: OperatorStage = "not-started";
const sessionBoundaries: {
  endpoint: "session" | "parent-list" | "play-list" | "key-list";
  status: number;
  encoding: "none" | "identity" | "gzip" | "deflate" | "br" | "zstd" | "other";
  jsonContentType: boolean;
}[] = [];
const contexts: BrowserContext[] = [],
  keys: AccessKeyDetail[] = [],
  privateLinks: string[] = [];
async function checked<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw Error("CONSUMER_E2E_FACT_INVALID");
  }
}
// Close all credential/answer-bearing pages before surfacing a failure to the reporter.
// This also prevents Playwright's failure context from serializing the answer DOM.
function safeCase(
  work: (fixtures: { browser: Browser }, info: TestInfo) => Promise<void>,
) {
  return async ({ browser }: { browser: Browser }, info: TestInfo) => {
    try {
      await work({ browser }, info);
    } catch {
      let visibilityEvents: unknown = "unavailable";
      if (info.title === CASES[0]) {
        try {
          visibilityEvents = await operator.evaluate(() => {
            const value = (
              window as Window & { __qfStudioBoundaryEvents?: unknown }
            ).__qfStudioBoundaryEvents;
            return Array.isArray(value) &&
              value.length <= 32 &&
              value.every((v) =>
                [
                  "hidden",
                  "visible",
                  "pagehide",
                  "authority-invalidated",
                ].includes(v),
              )
              ? value
              : "unavailable";
          });
        } catch {}
      }
      for (const context of contexts) {
        try {
          await context.close();
        } catch {}
      }
      if (info.title === CASES[0]) {
        // Finite diagnostics only. No URL, headers object, DTO, credentials,
        // operator/Key identity, original exception or answer DOM is attached.
        try {
          await info.attach("consumer-operator-boundary.json", {
            body: Buffer.from(
              JSON.stringify({
                stage: operatorStage,
                responses: sessionBoundaries,
                visibilityEvents,
                issuedKeyCount: keys.length,
              }),
            ),
            contentType: "application/json",
          });
        } catch {}
      }
      throw Error(
        `CONSUMER_E2E_CASE_FAILED:${CASES.includes(info.title as (typeof CASES)[number]) ? info.title : "unknown"}${info.title === CASES[0] ? ":" + operatorStage : ""}`,
      );
    }
  };
}
const studioPage = () =>
  `/studio/products/${fixture.productId}/consumer-access`;
function rememberKey(key: AccessKeyDetail) {
  const index = observations.keys.findIndex(
    (k) => k.issue.binding.keyId === key.issue.binding.keyId,
  );
  if (index < 0) observations.keys.push(key);
  else observations.keys[index] = key;
}
async function latestKey(key: AccessKeyDetail) {
  const response = await consumerGet(
    operator,
    urls.accessKeyUrl(fixture.productId, key.issue.binding.keyId),
  );
  expect(response.status()).toBe(200);
  const value = await checked(() =>
    response.json().then(verifyAccessKeyDetail),
  );
  rememberKey(value);
  return value;
}
async function observe(page: Page, id: string) {
  const { view, observation } = await observeConsumerGrant(page, id);
  const index = observations.grants.findIndex(
    (g) => g.grantId === observation.grantId,
  );
  if (index < 0) observations.grants.push(observation);
  if ("state" in view.outcome) {
    const input = view.outcome.state;
    const state = await checked(() => verifyConsumerState(input));
    const index = observations.states.findIndex(
      (s) => s.session.sessionId === id,
    );
    if (index < 0) observations.states.push(state);
    else observations.states[index] = state;
  }
  return view;
}
async function finishStudioPending() {
  await operator.getByRole("checkbox").check();
  await operator
    .getByRole("button", { name: "确认结束并清除当前标签页记录", exact: true })
    .click();
  await expect(
    operator.getByRole("combobox", { name: "固定内测内容版本", exact: true }),
  ).toBeEnabled();
}
async function unknown(route: Route) {
  await route.fulfill({
    status: 503,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
    },
    body: JSON.stringify({
      schemaVersion: "quizforge.consumer-error.v1",
      code: "OUTCOME_UNKNOWN",
      requestId: randomUUID(),
    }),
  });
}
async function enter(page: Page, file: string) {
  await openPrivateConsumerLink(page, file);
  // Fragment must already be erased before any exchange is allowed.
  let exchanged = false,
    safe = true;
  await page.route(
    "**/access/exchange",
    async (route) => {
      exchanged = true;
      safe &&= await page.evaluate(
        () => location.hash === "" && location.search === "",
      );
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "验证访问", exact: true }).click();
  await expect
    .poll(() => {
      const p = new URL(page.url());
      return (
        /^\/play\/[a-f0-9-]{36}(\/report)?$/.test(p.pathname) &&
        !p.search &&
        !p.hash
      );
    })
    .toBe(true);
  expect(exchanged && safe).toBe(true);
  return new URL(page.url()).pathname.split("/")[2]!;
}
async function consumerPending() {
  return checked(async () => {
    const text = await buyer.evaluate(
      (id) => sessionStorage.getItem(`quizforge:p4:consumer-pending:v1:${id}`),
      sessionId,
    );
    if (!text) throw Error();
    const value: unknown = JSON.parse(text);
    return value;
  });
}
test.beforeAll(async ({ browser }) => {
  // Hook timeouts are independent of the 180s case budget. Prepare's existing
  // 90s child budget includes a possible 61s auth-window wait; reserve another
  // finite 90s for fixture verification, two browser contexts and Studio login.
  test.setTimeout(180_000);
  await consumerFixtureCommand("prepare");
  fixture = await readConsumerE2eFixture();
  observations = {
    schemaVersion: "quizforge.consumer-fixture-observations.v1",
    instanceId: fixture.instanceId,
    runId: consumerRunId(),
    productId: fixture.productId,
    mode: "consumer-e2e",
    suiteCompletion: null,
    plays: [],
    keys: [],
    states: [],
    reports: [],
    grants: [],
  };
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 390, height: 900 },
  });
  contexts.push(context);
  operator = await context.newPage();
  await signInInternalOperator(operator, fixture.operator.secret);
  const consumer = await browser.newContext({
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 390, height: 900 },
  });
  contexts.push(consumer);
  buyer = await consumer.newPage();
});
test.afterEach(async ({}, info) => {
  completion.observe(info);
});
test.afterAll(async () => {
  // Three final Key reads have 20s native HTTP bounds each, then finish has its
  // existing 90s child bound. Reserve 90s for observation I/O and context closure.
  test.setTimeout(240_000);
  try {
    if (completion.canFinish()) {
      for (const key of keys) await latestKey(key);
      observations.suiteCompletion = completion.receipt();
      await writeConsumerE2eObservations(observations);
      await consumerFixtureCommand("finish");
    }
  } finally {
    for (const context of contexts) await context.close();
  }
});

test(
  CASES[0],
  safeCase(async ({}, info) => {
    operatorStage = "initial-read";
    const boundaryPaths = new Map<
      string,
      "session" | "parent-list" | "play-list" | "key-list"
    >([
      ["/api/studio/auth/session", "session"],
      [
        `/api/studio/products/${fixture.productId}/internal-versions`,
        "parent-list",
      ],
      [urls.internalPlaysUrl(fixture.productId), "play-list"],
      [urls.accessKeysUrl(fixture.productId), "key-list"],
    ]);
    operator.on("response", (response) => {
      if (response.request().method() !== "GET") return;
      const endpoint = boundaryPaths.get(new URL(response.url()).pathname);
      if (!endpoint) return;
      const headers = response.headers(),
        raw = headers["content-encoding"] ?? "none";
      const encoding = [
        "none",
        "identity",
        "gzip",
        "deflate",
        "br",
        "zstd",
      ].includes(raw)
        ? (raw as "none" | "identity" | "gzip" | "deflate" | "br" | "zstd")
        : "other";
      if (sessionBoundaries.length === 32) sessionBoundaries.shift();
      sessionBoundaries.push({
        endpoint,
        status: response.status(),
        encoding,
        jsonContentType: /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          headers["content-type"] ?? "",
        ),
      });
    });
    await operator.addInitScript(() => {
      const events: string[] = [];
      (
        window as Window & { __qfStudioBoundaryEvents?: string[] }
      ).__qfStudioBoundaryEvents = events;
      const probe = {
        record(event: string) {
          if (events.length === 32) events.shift();
          events.push(event);
        },
      };
      document.addEventListener("visibilitychange", () =>
        probe.record(document.hidden ? "hidden" : "visible"),
      );
      window.addEventListener("pagehide", () => probe.record("pagehide"));
      window.addEventListener("quizforge:studio-authority-invalidated:v1", () =>
        probe.record("authority-invalidated"),
      );
    });
    await operator.bringToFront();
    await operator.goto(studioPage());
    const parentChoice = operator.getByRole("combobox", {
      name: "固定内测内容版本",
      exact: true,
    });
    // Fresh identity then the joint metadata read each have the existing 15s
    // request deadline. Fail this semantic boundary before a 180s action wait.
    await expect(parentChoice).toBeEnabled({
      timeout: 2 * L.deadlineMs + 5_000,
    });
    await parentChoice.selectOption(fixture.parent!.version.id);
    operatorStage = "create-play";
    await operator
      .getByRole("button", { name: "创建答题版本", exact: true })
      .click();
    await expect(
      operator.getByRole("heading", { name: "原内测版本已创建", exact: true }),
    ).toBeVisible();
    const response = await consumerGet(
      operator,
      urls.internalPlaysUrl(fixture.productId),
    );
    expect(response.status()).toBe(200);
    const list = await checked(async () =>
      internalPlayListSchema.parse(await response.json()),
    );
    expect(list.versions.length).toBe(1);
    play = await checked(() =>
      internalPlayReceiptSchema.parse(list.versions[0]),
    );
    expect(
      play.binding.parent.productId === fixture.productId &&
        play.binding.parent.versionId === fixture.parent!.version.id,
    ).toBe(true);
    observations.plays.push(play);
    operatorStage = "confirm-play";
    await finishStudioPending();
    for (let i = 0; i < 3; i++) {
      operatorStage = "issue-key";
      await operator
        .getByRole("combobox", { name: "固定内测内容版本", exact: true })
        .selectOption(play.id);
      let issued: AccessKeyDetail | undefined,
        applications = 0;
      if (i === 2)
        await operator.route(
          "**" + urls.accessKeysUrl(fixture.productId),
          async (route) => {
            if (route.request().method() !== "POST") {
              await route.continue();
              return;
            }
            applications++;
            const actual = await consumerRouteFetch(route, operator);
            expect(actual.status()).toBe(201);
            issued = await checked(async () => {
              const result = (await actual.json()) as { key: unknown };
              return verifyAccessKeyDetail(result.key);
            });
            await unknown(route);
          },
        );
      await operator
        .getByRole("button", { name: "生成并发放一枚访问码", exact: true })
        .click();
      if (i === 2) {
        await expect(
          operator.getByRole("button", {
            name: "再次发送原操作",
            exact: true,
          }),
        ).toBeVisible();
        await operator.reload();
        await expect(
          operator.getByRole("button", {
            name: "查询上次操作结果",
            exact: true,
          }),
        ).toBeVisible();
        expect(applications).toBe(1);
        await operator.unroute("**" + urls.accessKeysUrl(fixture.productId));
        await operator
          .getByRole("button", { name: "查询上次操作结果", exact: true })
          .click();
      }
      await expect(
        operator.getByRole("heading", {
          name: "上次访问码发放已记录",
          exact: true,
        }),
      ).toBeVisible();
      if (!issued) {
        const r = await consumerGet(
          operator,
          urls.accessKeysUrl(fixture.productId),
        );
        expect(r.status()).toBe(200);
        const list = await checked(async () =>
          accessKeyListSchema.parse(await r.json()),
        );
        issued = list.keys.find(
          (k) =>
            !keys.some(
              (old) => old.issue.binding.keyId === k.issue.binding.keyId,
            ),
        );
      }
      if (!issued) throw Error("CONSUMER_E2E_ISSUE_FACT_MISSING");
      keys.push(issued);
      rememberKey(issued);
      operatorStage = "export-private-link";
      privateLinks.push(await downloadIssuedPrivateLink(operator, issued));
      await finishStudioPending();
    }
    operatorStage = "final-list-capture";
    await captureConsumerWidths(operator, info, "operator-key-list");
  }),
);

test(
  CASES[1],
  safeCase(async ({}, info) => {
    await buyer.bringToFront();
    sessionId = await enter(buyer, privateLinks[0]!);
    const view = await observe(buyer, sessionId);
    expect(view.outcome.kind).toBe("editable");
    const response = await consumerGet(buyer, urls.consumerEntryUrl(sessionId));
    expect(response.status()).toBe(200);
    entry = await checked(async () =>
      verifyConsumerEntryView(await response.json(), view.grant.session),
    );
    expect(
      entry.facts.session.keyId === keys[0]!.issue.binding.keyId &&
        entry.facts.session.playSnapshotSha256 === play.snapshotSha256,
    ).toBe(true);
    await expect(buyer.locator('[data-consumer-state="cover"]')).toBeVisible();
    await captureConsumerWidths(buyer, info, "consumer-cover");
  }),
);

test(
  CASES[2],
  safeCase(async ({}, info) => {
    await buyer.getByRole("button", { name: "开始答题", exact: true }).click();
    await expect(
      buyer.locator('[data-consumer-state="question"]'),
    ).toBeVisible();
    let input: ConsumerSaveInput | undefined,
      writes = 0;
    await buyer.route("**" + urls.consumerSaveUrl(sessionId), async (route) => {
      writes++;
      input = await checked(() =>
        verifyConsumerSaveInput(
          JSON.parse(route.request().postData() ?? "null"),
        ),
      );
      const actual = await consumerRouteFetch(route, buyer);
      expect(actual.status()).toBe(200);
      await checked(async () =>
        verifyConsumerSaveResolution(await actual.json(), input!.binding),
      );
      await unknown(route);
    });
    const firstOption = buyer
      .locator(
        `input[type="radio"][name="consumer-question-${entry.facts.entry.questions[0]!.id}"]`,
      )
      .first();
    await expect(firstOption).toBeEnabled();
    await firstOption.check();
    await buyer.getByRole("button", { name: "下一题", exact: true }).click();
    await expect(
      buyer.getByRole("heading", { name: "核对上一次操作", exact: true }),
    ).toBeVisible();
    await buyer.reload();
    await expect(
      buyer.getByRole("heading", { name: "核对上一次操作", exact: true }),
    ).toBeVisible();
    expect(writes).toBe(1);
    const pending = await consumerPending();
    expect(
      await checked(async () =>
        sameConsumerFact(
          (pending as { input: unknown }).input,
          input,
          L.saveRequestBytes,
        ),
      ),
    ).toBe(true);
    await buyer.unroute("**" + urls.consumerSaveUrl(sessionId));
    await captureConsumerWidths(buyer, info, "save-unknown-restored");
    await buyer
      .getByRole("button", { name: "查询上次操作结果", exact: true })
      .click();
    await buyer
      .getByRole("button", { name: "采用已核对结果", exact: true })
      .click();
    await buyer.getByRole("button", { name: "继续答题", exact: true }).click();
    // The original save advanced to the next fixed question. Finish through actual UI saves.
    for (let i = 1; i < entry.facts.entry.questions.length; i++) {
      const option = buyer
        .locator(
          `input[type="radio"][name="consumer-question-${entry.facts.entry.questions[i]!.id}"]`,
        )
        .first();
      await expect(option).toBeEnabled();
      await option.check();
      await buyer
        .getByRole("button", {
          name:
            i === entry.facts.entry.questions.length - 1
              ? "检查并完成"
              : "下一题",
          exact: true,
        })
        .click();
    }
    await expect(
      buyer.getByRole("heading", { name: "确认完成本次测评", exact: true }),
    ).toBeVisible();
    const final = await observe(buyer, sessionId);
    expect(
      final.outcome.kind === "editable" &&
        "state" in final.outcome &&
        final.outcome.state.answers.length ===
          entry.facts.entry.questions.length,
    ).toBe(true);
    await captureConsumerWidths(buyer, info, "completion-review");
  }),
);

test(
  CASES[3],
  safeCase(async ({}, info) => {
    let binding: ConsumerCompleteBinding | undefined,
      writes = 0;
    await buyer.route(
      "**" + urls.consumerCompleteUrl(sessionId),
      async (route) => {
        writes++;
        binding = await checked(() =>
          consumerCompleteBindingSchema.parse(
            JSON.parse(route.request().postData() ?? "null"),
          ),
        );
        const actual = await consumerRouteFetch(route, buyer);
        expect(actual.status()).toBe(200);
        const resolution = await checked(async () =>
          verifyConsumerCompleteResolution(await actual.json(), binding),
        );
        expect(resolution.kind).toBe("applied");
        await unknown(route);
      },
    );
    await buyer
      .getByRole("button", { name: "确认完成并查看报告", exact: true })
      .click();
    await expect(
      buyer.getByRole("heading", { name: "核对上一次操作", exact: true }),
    ).toBeVisible();
    await buyer.reload();
    await expect(
      buyer.getByRole("heading", { name: "核对上一次操作", exact: true }),
    ).toBeVisible();
    expect(writes).toBe(1);
    expect(
      await checked(async () =>
        sameConsumerFact(
          ((await consumerPending()) as { binding: unknown }).binding,
          binding,
          L.operationRequestBytes,
        ),
      ),
    ).toBe(true);
    await buyer.unroute("**" + urls.consumerCompleteUrl(sessionId));
    await buyer
      .getByRole("button", { name: "查询上次操作结果", exact: true })
      .click();
    await buyer
      .getByRole("button", { name: "采用已核对结果", exact: true })
      .click();
    await waitForConsumerCompletionAdoption(buyer, sessionId);
    const reportResponse = await consumerGet(
      buyer,
      urls.consumerReportUrl(sessionId),
    );
    expect(reportResponse.status()).toBe(200);
    const report = await checked(async () =>
      verifyPersistedReportView(await reportResponse.json()),
    );
    expect(
      sameConsumerFact(
        report.receipt.binding,
        binding,
        L.operationRequestBytes,
      ),
    ).toBe(true);
    observations.reports.push(report.receipt);
    await captureConsumerWidths(buyer, info, "completed-result");
    const original = await enter(buyer, privateLinks[0]!);
    expect(original).toBe(sessionId);
    const view = await observe(buyer, sessionId);
    expect(
      view.outcome.kind === "completed" &&
        view.outcome.report.reportId === report.receipt.reportId,
    ).toBe(true);
    await expect(buyer.getByRole("radio")).toHaveCount(0);
    await expect(
      buyer.getByRole("button", { name: "确认完成并查看报告", exact: true }),
    ).toHaveCount(0);
  }),
);

test(
  CASES[4],
  safeCase(async ({}, info) => {
    // Original link lands on the stored read-only report; no browser score or regeneration.
    await expect(buyer.locator('[data-consumer-state="report"]')).toBeVisible();
    await captureConsumerWidths(buyer, info, "readonly-report");
    await buyer.getByRole("button", { name: "查看海报", exact: true }).click();
    await expect(buyer.locator('[data-consumer-state="poster"]')).toBeVisible();
    await buyer
      .getByRole("button", { name: "生成报告海报", exact: true })
      .click();
    await expect(
      buyer.getByRole("button", { name: "下载 PNG 海报", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const downloadPromise = buyer.waitForEvent("download");
    await buyer
      .getByRole("button", { name: "下载 PNG 海报", exact: true })
      .click();
    const download = await downloadPromise,
      file = info.outputPath("p4-report-poster.png");
    await download.saveAs(file);
    const bytes = await readFile(file);
    expect(
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.readUInt32BE(16) === 1080 &&
        bytes.readUInt32BE(20) === 1920,
    ).toBe(true);
    await captureConsumerWidths(buyer, info, "readonly-poster");
    const response = await consumerGet(
        buyer,
        urls.consumerReportUrl(sessionId),
      ),
      report = await checked(async () =>
        verifyPersistedReportView(await response.json()),
      );
    expect(
      report.receipt.reportId === observations.reports[0]!.reportId &&
        report.receipt.reportSnapshotSha256 ===
          observations.reports[0]!.reportSnapshotSha256,
    ).toBe(true);
  }),
);

test(
  CASES[5],
  safeCase(async ({ browser }) => {
    const strangerContext = await browser.newContext({
      baseURL: "http://127.0.0.1:3100",
    });
    contexts.push(strangerContext);
    const stranger = await strangerContext.newPage();
    await stranger.goto("/access");
    expect(
      (await consumerGet(stranger, urls.consumerReportUrl(sessionId))).status(),
    ).toBe(401);
    expect(
      (
        await consumerGet(buyer, urls.consumerSessionUrl(randomUUID()))
      ).status(),
    ).toBe(401);
    const current = await observe(buyer, sessionId),
      logoutResponse = buyer.waitForResponse(
        (r) =>
          r.url() ===
          "http://127.0.0.1:3100" + urls.consumerLogoutUrl(sessionId),
      );
    await buyer
      .getByRole("button", { name: "退出当前授权", exact: true })
      .click();
    expect((await logoutResponse).status()).toBe(204);
    observations.grants.find(
      (g) => g.grantId === current.grant.grantId,
    )!.logoutObserved = true;
    expect(
      (await consumerGet(buyer, urls.consumerReportUrl(sessionId))).status(),
    ).toBe(401);
    await expect(buyer.locator('[data-consumer-state="poster"]')).toHaveCount(
      0,
    );
    await enter(buyer, privateLinks[0]!);
    expect((await observe(buyer, sessionId)).outcome.kind).toBe("completed");
    // A separate read-only Studio identity can resolve facts, but has no write authority.
    const roContext = await browser.newContext({
      baseURL: "http://127.0.0.1:3100",
    });
    contexts.push(roContext);
    const ro = await roContext.newPage();
    await signInInternalOperator(ro, fixture.readOnly.secret);
    await ro.goto(studioPage());
    await expect(
      ro.getByText("当前运营身份为只读", { exact: false }),
    ).toBeVisible();
    const original = keys[0]!.issue.binding;
    const resolve = await consumerPost(
      ro,
      urls.accessKeyIssueResolveUrl(fixture.productId),
      original,
    );
    expect(resolve.status()).toBe(200);
    expect(
      (
        await checked(async () =>
          verifyIssueAccessKeyResolution(await resolve.json(), original),
        )
      ).kind,
    ).toBe("applied");
    const denied = await consumerPost(
      ro,
      urls.accessKeysUrl(fixture.productId),
      {
        ...original,
        operationKey: randomUUID(),
        keyId: randomUUID(),
      },
    );
    expect(denied.status()).toBe(403);
  }),
);

test(
  CASES[6],
  safeCase(async ({ browser }) => {
    await operator.bringToFront();
    await operator.goto(studioPage());
    const unusedId = keys[1]!.issue.binding.keyId;
    const card = operator
      .locator("li")
      .filter({ has: operator.locator("code", { hasText: unusedId }) });
    await card
      .getByRole("button", { name: "作废此未领取访问码", exact: true })
      .click();
    await card
      .getByRole("button", { name: "确认作废未领取访问码", exact: true })
      .click();
    await expect(
      operator.getByRole("heading", {
        name: "原未领取作废已记录",
        exact: true,
      }),
    ).toBeVisible();
    await finishStudioPending();
    const revoked = await latestKey(keys[1]!);
    expect(
      revoked.current.voidReceipt !== null && revoked.current.claim === null,
    ).toBe(true);
    const rejectedContext = await browser.newContext({
      baseURL: "http://127.0.0.1:3100",
    });
    contexts.push(rejectedContext);
    const rejected = await rejectedContext.newPage();
    await openPrivateConsumerLink(rejected, privateLinks[1]!);
    await rejected
      .getByRole("button", { name: "验证访问", exact: true })
      .click();
    await expect(
      rejected.getByText(
        "暂时无法验证访问。可在本页重新验证，或重新打开原私密链接。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      new URL(rejected.url()).pathname === "/access" &&
        new URL(rejected.url()).hash === "",
    ).toBe(true);
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:3100",
    });
    contexts.push(context);
    const claimant = await context.newPage(),
      claimedSession = await enter(claimant, privateLinks[2]!);
    await observe(claimant, claimedSession);
    const target = await latestKey(keys[2]!),
      binding = {
        schemaVersion: "quizforge.access-key-void-unused.v1" as const,
        productId: fixture.productId,
        operationKey: randomUUID(),
        keyId: target.issue.binding.keyId,
        issueBindingSha256: target.issue.bindingSha256,
      };
    const response = await consumerPost(
      operator,
      urls.accessKeyVoidUrl(fixture.productId, binding.keyId),
      binding,
    );
    expect(response.status()).toBe(200);
    const result = await checked(async () =>
      verifyVoidUnusedAccessKeyResolution(await response.json(), binding),
    );
    expect(
      result.kind === "claimed" &&
        result.key.current.claim?.sessionId === claimedSession &&
        result.key.current.voidReceipt === null &&
        result.bindingSha256 ===
          (await voidUnusedAccessKeyBindingSha256(binding)),
    ).toBe(true);
    rememberKey(result.key);
  }),
);

test(
  CASES[7],
  safeCase(async () => {
    const other = observations.states.find(
      (s) => s.session.keyId === keys[2]!.issue.binding.keyId,
    );
    if (!other) throw Error("CONSUMER_E2E_ISOLATION_FACT_MISSING");
    expect(
      (
        await consumerCrossSessionGet(
          buyer,
          urls.consumerSessionUrl(other.session.sessionId),
          sessionId,
        )
      ).status(),
    ).toBe(401);
    const resourceHeaders = (
      await consumerGet(buyer, urls.consumerReportUrl(sessionId))
    ).headers();
    expect(
      resourceHeaders["cache-control"] === "private, no-store, max-age=0" ||
        resourceHeaders["cache-control"]?.includes("no-store"),
    ).toBe(true);
    expect(resourceHeaders["referrer-policy"]).toBe("no-referrer");
    expect(resourceHeaders["x-content-type-options"]).toBe("nosniff");
    expect(resourceHeaders["access-control-allow-origin"]).toBeUndefined();
    for (const headers of [
      { "sec-fetch-site": "" },
      { "sec-fetch-site": "cross-site" },
      { host: "invalid.example" },
    ]) {
      expect(
        (
          await consumerGet(buyer, urls.consumerReportUrl(sessionId), headers)
        ).status(),
      ).toBe(403);
    }
    for (const cookie of [
      `${CONSUMER_COOKIE_NAME_V1}=bad`,
      `${CONSUMER_COOKIE_NAME_V1}=bad; ${CONSUMER_COOKIE_NAME_V1}=bad`,
      `${CONSUMER_COOKIE_NAME_V1} =bad`,
    ])
      expect(
        (
          await consumerGet(buyer, urls.consumerReportUrl(sessionId), {
            cookie,
          })
        ).status(),
      ).toBe(401);
    expect(
      (
        await consumerPost(
          buyer,
          urls.consumerSaveUrl(sessionId),
          {},
          { "x-quizforge-consumer-csrf": "bad" },
        )
      ).status(),
    ).toBe(403);
    expect(
      await buyer.evaluate(
        () =>
          !/qf[kg]_p4_/.test(document.documentElement.outerHTML) &&
          !Object.values(localStorage).some((v) => /qf[kg]_p4_/.test(v)) &&
          !Object.values(sessionStorage).some((v) => /qf[kg]_p4_/.test(v)),
      ),
    ).toBe(true);
  }),
);
