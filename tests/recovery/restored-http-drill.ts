import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import {
  CONSUMER_EXCHANGE_HEADER_V1,
  CONSUMER_EXCHANGE_HEADER_VALUE_V1,
  createConsumerToken,
  digestConsumerToken,
} from "@/lib/consumer-contract/v1/credentials";
import { issueAccessKeyResultSchema } from "@/features/fulfillment/consumer-flow/operator-resolutions";
import type {
  APIResponse,
  Browser,
  BrowserContext,
  Page,
} from "@playwright/test";
import {
  consumerExchangeResultSchema,
  verifyConsumerSessionView,
  consumerSaveResolutionSchema,
  consumerCompleteResolutionSchema,
} from "@/features/fulfillment/consumer-flow/contracts";
import { verifyConsumerEntryView } from "@/features/fulfillment/consumer-flow/display-contract";
import { verifyPersistedReportView } from "@/features/report/persisted/view-contracts";
import {
  consumerAnswersSha256,
  consumerProgressSha256,
} from "@/lib/consumer-contract/v1/state";
import {
  recoveryOriginSchema,
  canonicalRecoveryJson,
  recoveryHash,
  recoveryRootSchema,
} from "@/features/runtime-recovery/contracts";
import {
  createRecoveryDirectory,
  writeRecoveryBytes,
  syncRecoveryDirectory,
} from "@/features/runtime-recovery/files";
import type { prepareRecoveryBusinessSource } from "./business-source-fixture";
import { RECOVERY_SYNTHETIC_BASELINE } from "./synthetic-pack";
import { holdRecoverySourceOrigin } from "./source-origin-hold";
import { readRecoveryDownloadBytes } from "./download-bytes";
import { waitForConsumerCaptureReady } from "../e2e/consumer-flow.visual";

const unknown = new Set<unknown>();
const failed = () => Error("RECOVERY_RESTORED_HTTP_DRILL_FAILED");
/** Caller owns target PG/HTTP and Browser; this helper owns fresh contexts and a source-origin hold. */
export async function verifyRestoredRecoveryHttp(input: {
  browser: Browser;
  origin: string;
  sourceOrigin: string;
  evidenceDirectory: string;
  operatorCredential?: string;
  onStage?(
    stage:
      | "old-session"
      | "old-report"
      | "old-resource"
      | "old-report-page"
      | "poster-open"
      | "poster-generate"
      | "poster-download"
      | "poster-read"
      | "poster-decode"
      | "pending-complete"
      | "unused-complete"
      | "old-report-recheck"
      | "operator-issue",
  ): void;
  source: Awaited<ReturnType<typeof prepareRecoveryBusinessSource>>;
}) {
  if (
    unknown.size ||
    input.origin === input.sourceOrigin ||
    !recoveryOriginSchema.safeParse(input.origin).success ||
    !recoveryOriginSchema.safeParse(input.sourceOrigin).success ||
    !recoveryRootSchema.safeParse(input.evidenceDirectory).success ||
    canonicalRecoveryJson(input.source.source.baseline) !==
      canonicalRecoveryJson(RECOVERY_SYNTHETIC_BASELINE)
  )
    throw failed();
  const budget = {
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 300_000,
  };
  await createRecoveryDirectory(input.evidenceDirectory, budget);
  const sourceHold = await holdRecoverySourceOrigin(input.sourceOrigin);
  const evidence: {
    file: string;
    bytes: number;
    sha256: string;
    width: number;
    height: number;
  }[] = [];
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const savePng = async (file: string, bytes: Buffer, poster = false) => {
    if (
      bytes.length < 24 ||
      bytes.length > 16_777_216 ||
      !bytes.subarray(0, 8).equals(signature)
    )
      throw failed();
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    if (
      poster
        ? width !== 1080 || height !== 1920
        : width !== 390 || height < 844 || height > 30_000
    )
      throw failed();
    if (poster)
      await sharp(bytes, { failOn: "error", limitInputPixels: 1080 * 1920 })
        .raw()
        .toBuffer();
    await writeRecoveryBytes(
      path.join(input.evidenceDirectory, file),
      bytes,
      budget,
    );
    evidence.push({
      file,
      bytes: bytes.length,
      sha256: recoveryHash(bytes),
      width,
      height,
    });
  };
  const capture = async (page: Page, state: string, file: string) => {
    await waitForConsumerCaptureReady(page, state);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await savePng(
      file,
      await page.screenshot({ fullPage: true, animations: "disabled" }),
    );
  };
  const contexts: BrowserContext[] = [];
  const context = async () => {
    const owned = await input.browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    contexts.push(owned);
    return owned;
  };
  const json = async (response: APIResponse): Promise<unknown> => {
    try {
      const bytes = await response.body();
      if (
        !response.ok() ||
        bytes.length > 524_288 ||
        !response.headers()["content-type"]?.startsWith("application/json")
      )
        throw failed();
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } finally {
      try {
        await response.dispose();
      } catch (error) {
        unknown.add(response);
        throw error;
      }
    }
  };
  const get = (ctx: BrowserContext, route: string) =>
    ctx.request.get(input.origin + route, {
      timeout: 15_000,
      maxRedirects: 0,
      headers: { "sec-fetch-site": "same-origin" },
    });
  const post = (
    ctx: BrowserContext,
    route: string,
    data: unknown,
    csrf?: string,
  ) =>
    ctx.request.post(input.origin + route, {
      timeout: 15_000,
      maxRedirects: 0,
      data,
      headers: {
        origin: input.origin,
        "sec-fetch-site": "same-origin",
        ...(route === "/access/exchange"
          ? { [CONSUMER_EXCHANGE_HEADER_V1]: CONSUMER_EXCHANGE_HEADER_VALUE_V1 }
          : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
      },
    });
  const exchange = async (ctx: BrowserContext, raw: string) => {
    const exchanged = consumerExchangeResultSchema.parse(
      await json(await post(ctx, "/access/exchange", { rawKey: raw })),
    );
    const sessionId = exchanged.session.sessionId;
    const view = await verifyConsumerSessionView(
      await json(await get(ctx, `/play/${sessionId}/api/session`)),
      sessionId,
    );
    return { sessionId, view };
  };
  try {
    input.onStage?.("old-session");
    const completedContext = await context();
    const completed = await exchange(
      completedContext,
      input.source.completed.raw,
    );
    if (
      completed.sessionId !== input.source.completed.sessionId ||
      completed.view.outcome.kind !== "completed"
    )
      throw failed();
    input.onStage?.("old-report");
    const oldReport = await verifyPersistedReportView(
      await json(
        await get(completedContext, `/play/${completed.sessionId}/api/report`),
      ),
    );
    if (
      recoveryHash(canonicalRecoveryJson(oldReport)) !==
      input.source.completed.viewSha256
    )
      throw failed();
    input.onStage?.("old-resource");
    const portrait = oldReport.view.display.result.portrait;
    const query = new URLSearchParams({
      resourceId: portrait.resourceRef.id,
      resourceVersion: portrait.resourceRef.version,
      sha256: portrait.sha256,
    });
    const resource = await get(
      completedContext,
      `/play/${completed.sessionId}/api/resources?${query}`,
    );
    try {
      const bytes = await resource.body();
      if (
        !resource.ok() ||
        bytes.length !== portrait.bytes ||
        recoveryHash(bytes) !== portrait.sha256
      )
        throw failed();
    } finally {
      try {
        await resource.dispose();
      } catch (error) {
        unknown.add(resource);
        throw error;
      }
    }
    input.onStage?.("old-report-page");
    const page = await completedContext.newPage();
    await page.goto(`${input.origin}/play/${completed.sessionId}/report`, {
      waitUntil: "networkidle",
      timeout: 15_000,
    });
    await page.getByRole("main").waitFor({ state: "visible" });
    if (
      !(await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ))
    )
      throw failed();
    await capture(page, "readonly-report", "old-report-390.png");
    input.onStage?.("poster-open");
    await page.getByRole("button", { name: "查看海报", exact: true }).click();
    await waitForConsumerCaptureReady(page, "readonly-poster");
    input.onStage?.("poster-generate");
    await page
      .getByRole("button", { name: "生成报告海报", exact: true })
      .click();
    const downloadButton = page.getByRole("button", {
      name: "下载 PNG 海报",
      exact: true,
    });
    await downloadButton.waitFor({ state: "visible", timeout: 30_000 });
    input.onStage?.("poster-download");
    const downloadPending = page.waitForEvent("download", { timeout: 15_000 });
    void downloadPending.catch(() => {}); // Context teardown still owns a failed download wait.
    await downloadButton.click();
    const download = await downloadPending;
    if (await download.failure()) throw failed();
    input.onStage?.("poster-read");
    const posterBytes = await readRecoveryDownloadBytes(download, budget);
    input.onStage?.("poster-decode");
    await savePng("restored-report-poster.png", posterBytes, true);
    await capture(page, "readonly-poster", "old-poster-390.png");

    const continueSession = async (
      ctx: BrowserContext,
      raw: string,
      expectedPending: boolean,
    ) => {
      const session = await exchange(ctx, raw);
      if (session.view.outcome.kind !== "editable") throw failed();
      const state = session.view.outcome.state;
      if (
        expectedPending &&
        (session.sessionId !== input.source.pending.sessionId ||
          canonicalRecoveryJson(state) !==
            canonicalRecoveryJson(input.source.pending.state))
      )
        throw failed();
      if (
        !expectedPending &&
        (state.stateRevision !== 0 || state.answers.length)
      )
        throw failed();
      const entry = await verifyConsumerEntryView(
        await json(await get(ctx, `/play/${session.sessionId}/api/entry`)),
        state.session,
      );
      const answers = entry.facts.entry.questions.map(
        (question) =>
          state.answers.find((answer) => answer.questionId === question.id) ?? {
            questionId: question.id,
            optionId: question.options[0]!.id,
          },
      );
      const progress = { questionId: entry.facts.entry.questions.at(-1)!.id };
      const saved = consumerSaveResolutionSchema.parse(
        await json(
          await post(
            ctx,
            `/play/${session.sessionId}/api/save`,
            {
              binding: {
                schemaVersion: "quizforge.consumer-save.v1",
                session: state.session,
                expectedStateRevision: state.stateRevision,
                consumerStateAnswersSha256:
                  await consumerAnswersSha256(answers),
                progressSha256: await consumerProgressSha256(progress),
              },
              answers,
              progress,
            },
            session.view.grant.csrf,
          ),
        ),
      );
      if (saved.kind !== "applied-current") throw failed();
      const final = consumerCompleteResolutionSchema.parse(
        await json(
          await post(
            ctx,
            `/play/${session.sessionId}/api/complete`,
            {
              schemaVersion: "quizforge.consumer-complete.v1",
              session: saved.state.session,
              expectedStateRevision: saved.state.stateRevision,
              consumerStateAnswersSha256:
                saved.state.consumerStateAnswersSha256,
              progressSha256: saved.state.progressSha256,
              completionKey: randomUUID(),
            },
            session.view.grant.csrf,
          ),
        ),
      );
      if (final.kind !== "applied") throw failed();
      const report = await verifyPersistedReportView(
        await json(await get(ctx, `/play/${session.sessionId}/api/report`)),
      );
      if (report.receipt.reportId === oldReport.receipt.reportId)
        throw failed();
      const page = await ctx.newPage();
      await page.goto(`${input.origin}/play/${session.sessionId}/report`, {
        waitUntil: "networkidle",
        timeout: 15_000,
      });
      await capture(
        page,
        "readonly-report",
        expectedPending ? "pending-report-390.png" : "unused-report-390.png",
      );
      return report.receipt.reportId;
    };
    input.onStage?.("pending-complete");
    const pendingReportId = await continueSession(
      await context(),
      input.source.pending.raw,
      true,
    );
    input.onStage?.("unused-complete");
    const newReportId = await continueSession(
      await context(),
      input.source.unused.raw,
      false,
    );
    input.onStage?.("old-report-recheck");
    const reread = await verifyPersistedReportView(
      await json(
        await get(completedContext, `/play/${completed.sessionId}/api/report`),
      ),
    );
    if (
      recoveryHash(canonicalRecoveryJson(reread)) !==
        input.source.completed.viewSha256 ||
      pendingReportId === newReportId
    )
      throw failed();
    let operatorNewKey: { keyId: string; receiptSha256: string } | null = null;
    if (input.operatorCredential !== undefined) {
      input.onStage?.("operator-issue");
      const operatorContext = await context();
      const csrf = (dto: unknown) => {
        if (
          !dto ||
          typeof dto !== "object" ||
          !("csrfToken" in dto) ||
          typeof dto.csrfToken !== "string" ||
          dto.csrfToken.length > 256
        )
          throw failed();
        return dto.csrfToken;
      };
      const preauth = await json(
        await post(operatorContext, "/api/studio/auth/preauth", {}),
      );
      const session = await json(
        await post(
          operatorContext,
          "/api/studio/auth/login",
          { credential: input.operatorCredential },
          csrf(preauth),
        ),
      );
      const raw = createConsumerToken("access-key");
      const digest = await digestConsumerToken(raw, "access-key");
      if (!digest) throw failed();
      const keyId = randomUUID();
      const issued = issueAccessKeyResultSchema.parse(
        await json(
          await post(
            operatorContext,
            `/api/studio/products/${input.source.source.productId}/access-keys`,
            {
              schemaVersion: "quizforge.access-key-issue.v1",
              operationKey: randomUUID(),
              keyId,
              play: {
                productId: input.source.source.productId,
                playVersionId: input.source.play.id,
                playSnapshotSha256: input.source.play.snapshotSha256,
              },
              credentialDigest: digest,
              validForSeconds: 7 * 24 * 60 * 60,
            },
            csrf(session),
          ),
        ),
      );
      if (
        !issued.created ||
        issued.key.issue.binding.keyId !== keyId ||
        issued.key.issue.binding.credentialDigest !== digest
      )
        throw failed();
      operatorNewKey = {
        keyId,
        receiptSha256: recoveryHash(canonicalRecoveryJson(issued.key.issue)),
      };
    }
    await syncRecoveryDirectory(input.evidenceDirectory, budget);
    return {
      oldReportStable: true,
      oldResourceShaVerified: true,
      pendingProgressStable: true,
      pendingSaveApplied: true,
      pendingCompleted: true,
      unusedKeyCompleted: true,
      oldReportId: oldReport.receipt.reportId,
      newReportId,
      pendingReportId,
      evidence,
      operatorNewKey,
      reportViewport: { width: 390, height: 844 },
    };
  } finally {
    try {
      let failure: unknown;
      for (const owned of contexts) {
        try {
          await owned.close();
        } catch (error) {
          unknown.add(owned);
          failure ??= error;
        }
      }
      if (failure) throw failure;
    } finally {
      try {
        await sourceHold.close();
      } catch (error) {
        unknown.add(sourceHold);
        throw error;
      }
    }
  }
}
