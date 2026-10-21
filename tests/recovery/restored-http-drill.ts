import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import {
  CONSUMER_EXCHANGE_HEADER_V1,
  CONSUMER_EXCHANGE_HEADER_VALUE_V1,
} from "@/lib/consumer-contract/v1/credentials";
import type { APIResponse, Browser, BrowserContext } from "@playwright/test";
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
} from "@/features/runtime-recovery/contracts";
import type { prepareRecoveryBusinessSource } from "./business-source-fixture";
import { RECOVERY_SYNTHETIC_BASELINE } from "./synthetic-pack";

const unknown = new Set<unknown>();
const failed = () => Error("RECOVERY_RESTORED_HTTP_DRILL_FAILED");
/** Caller owns target PG/HTTP and Browser; this helper owns fresh contexts and a source-origin hold. */
export async function verifyRestoredRecoveryHttp(input: {
  browser: Browser;
  origin: string;
  sourceOrigin: string;
  source: Awaited<ReturnType<typeof prepareRecoveryBusinessSource>>;
}) {
  if (
    unknown.size ||
    input.origin === input.sourceOrigin ||
    !recoveryOriginSchema.safeParse(input.origin).success ||
    !recoveryOriginSchema.safeParse(input.sourceOrigin).success ||
    canonicalRecoveryJson(input.source.source.baseline) !==
      canonicalRecoveryJson(RECOVERY_SYNTHETIC_BASELINE)
  )
    throw failed();
  const sourceHold = createServer();
  await new Promise<void>((resolve, reject) => {
    sourceHold.once("error", reject);
    sourceHold.listen(
      Number(new URL(input.sourceOrigin).port),
      "127.0.0.1",
      resolve,
    );
  });
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

    const continueSession = async (
      ctx: BrowserContext,
      raw: string,
      expectedPending: boolean,
      complete: boolean,
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
      if (!complete) return null;
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
      return report.receipt.reportId;
    };
    await continueSession(
      await context(),
      input.source.pending.raw,
      true,
      false,
    );
    const newReportId = await continueSession(
      await context(),
      input.source.unused.raw,
      false,
      true,
    );
    return {
      oldReportStable: true,
      oldResourceShaVerified: true,
      pendingProgressStable: true,
      pendingSaveApplied: true,
      unusedKeyCompleted: true,
      oldReportId: oldReport.receipt.reportId,
      newReportId,
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
      await new Promise<void>((resolve, reject) =>
        sourceHold.close((error) => {
          if (error) {
            unknown.add(sourceHold);
            reject(error);
          } else resolve();
        }),
      );
    }
  }
}
