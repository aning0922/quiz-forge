import { randomUUID } from "node:crypto";
import type { P2aDatabase } from "@/lib/db/client";
import { createDatabase } from "@/lib/db/client";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { createProductDraftService } from "@/features/product/drafts/service";
import { matchRegisteredBaseline } from "@/features/product/internal-versions/baseline-registry";
import {
  IMPLEMENTATION_DESCRIPTORS,
  implementationIdentity,
} from "@/features/product/internal-versions/implementation-catalog";
import {
  engineIdentitySchema,
  rendererIdentitySchema,
} from "@/features/product/internal-versions/contracts";
import { createProductInternalVersionService } from "@/features/product/internal-versions/service";
import { createInternalVersionOwner } from "@/features/product/internal-versions/lifecycle";
import { createInternalPlayService } from "@/features/product/internal-play/service";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY } from "@/features/product/internal-play/implementation-catalog";
import { createAccessKeyService } from "@/features/fulfillment/access/service";
import { createConsumerRequestOwner } from "@/features/fulfillment/consumer-flow/request-owner";
import { createConsumerFlowService } from "@/features/fulfillment/consumer-flow/service";
import {
  createConsumerToken,
  digestConsumerToken,
} from "@/lib/consumer-contract/v1/credentials";
import {
  consumerAnswersSha256,
  consumerProgressSha256,
  type ConsumerAnswers,
  type ConsumerState,
} from "@/lib/consumer-contract/v1/state";
import {
  canonicalRecoveryJson,
  recoveryHash,
} from "@/features/runtime-recovery/contracts";
import { receiveAndValidateRecoveryPack } from "./receive-validation-fixture";
import { buildRecoverySyntheticPack } from "./synthetic-pack";

const unknownOwners = new Set<unknown>();
const fail = () => Error("RECOVERY_DRILL_BUSINESS_SOURCE_INVALID");
/** Creates only in a fresh owned test Product, through actual services and configured native media. */
export async function prepareRecoveryBusinessSource(
  app: P2aDatabase,
  credentials: StudioWriteCredentials,
) {
  if (app.config.purpose !== "test" || unknownOwners.size) throw fail();
  const source = await receiveAndValidateRecoveryPack(app, credentials);
  const applied = await createProductDraftService().applyReadyValidation(
    app,
    credentials,
    {
      productId: source.productId,
      sourceImportId: source.importId,
      sourceValidationId: source.validation.id,
    },
    {
      idempotencyKey: randomUUID(),
      expectedValidationStateRevision: source.validation.stateRevision,
      expectedCandidateSha256: source.validation.candidateSha256!,
      target: { kind: "new-draft" },
    },
  );
  const application = applied.application;
  const fixed = source.baseline;
  if (
    application.canonicalContentSha256 !== fixed.contentSha256 ||
    application.assetSetSha256 !== fixed.assetSetSha256 ||
    application.canonicalManifestSha256 !== fixed.manifestSha256
  )
    throw fail();
  const baseline = matchRegisteredBaseline(application, app.config.purpose);
  if (!baseline || baseline.descriptor.approval.kind !== "synthetic-test")
    throw fail();
  const target = {
    draftId: application.draftId,
    revision: 1,
    canonicalContentSha256: fixed.contentSha256,
    assetSetSha256: fixed.assetSetSha256,
    canonicalManifestSha256: fixed.manifestSha256,
  };
  const versionRequest = async <T>(
    work: (
      service: ReturnType<typeof createProductInternalVersionService>,
      db: P2aDatabase,
      budget: ReturnType<typeof createStudioRequestBudget>["budget"],
    ) => Promise<T>,
  ) => {
    if (unknownOwners.size) throw fail();
    const clock = createStudioRequestBudget(new AbortController().signal);
    const db = await createDatabase(app.config, clock.budget);
    const owner = createInternalVersionOwner(db, clock);
    try {
      return await work(
        createProductInternalVersionService(owner),
        db,
        clock.budget,
      );
    } finally {
      try {
        await owner.closeIfNotTransferred();
      } catch (error) {
        unknownOwners.add(owner);
        throw error;
      }
    }
  };
  const review = await versionRequest((service, db, budget) =>
    service.recordBaseline(
      db,
      credentials,
      { productId: source.productId, draftId: target.draftId, revision: 1 },
      {
        schemaVersion: "quizforge.review-record.v1",
        idempotencyKey: randomUUID(),
        target,
        baseline: baseline.identity,
      },
      budget,
    ),
  );
  const parent = await versionRequest((service, db, budget) =>
    service.sealInternalVersion(
      db,
      credentials,
      source.productId,
      {
        schemaVersion: "quizforge.internal-version-seal.v1",
        idempotencyKey: randomUUID(),
        target,
        reviewId: review.review.id,
        reviewSha256: review.review.reviewSha256,
        renderer: rendererIdentitySchema.parse(
          implementationIdentity(IMPLEMENTATION_DESCRIPTORS.renderers[0]!),
        ),
        engine: engineIdentitySchema.parse(
          implementationIdentity(
            IMPLEMENTATION_DESCRIPTORS.engines.find(
              (entry) => entry.descriptor.id === "archetype",
            )!,
          ),
        ),
      },
      budget,
    ),
  );
  const invoke = async <T>(
    work: (owner: ReturnType<typeof createConsumerRequestOwner>) => Promise<T>,
  ) => {
    if (unknownOwners.size) throw fail();
    const owner = createConsumerRequestOwner(
      app.config,
      createStudioRequestBudget(new AbortController().signal),
    );
    try {
      return await work(owner);
    } finally {
      try {
        await owner.closeIfNotTransferred();
      } catch (error) {
        unknownOwners.add(owner);
        throw error;
      }
    }
  };
  const play = await invoke((owner) =>
    createInternalPlayService(owner).create(credentials, source.productId, {
      schemaVersion: "quizforge.internal-play-create.v1",
      operationKey: randomUUID(),
      parent: {
        productId: source.productId,
        versionId: parent.version.id,
        snapshotSha256: parent.version.snapshotSha256,
      },
      renderer: CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1_1,
    }),
  );
  const issue = async () => {
    const raw = createConsumerToken("access-key");
    const credentialDigest = await digestConsumerToken(raw, "access-key");
    if (!credentialDigest) throw fail();
    const result = await invoke((owner) =>
      createAccessKeyService(owner).issue(credentials, source.productId, {
        schemaVersion: "quizforge.access-key-issue.v1",
        operationKey: randomUUID(),
        keyId: randomUUID(),
        play: {
          productId: source.productId,
          playVersionId: play.play.id,
          playSnapshotSha256: play.play.snapshotSha256,
        },
        credentialDigest,
        validForSeconds: 3600,
      }),
    );
    return { raw, key: result.key };
  };
  const completedKey = await issue(),
    pendingKey = await issue(),
    unusedKey = await issue();
  const exchange = async (raw: string) => {
    const exchanged = await invoke((owner) =>
      createConsumerFlowService(owner).exchange(raw),
    );
    const sessionId = exchanged.result.session.sessionId;
    const view = await invoke((owner) =>
      createConsumerFlowService(owner).readSession(
        { grantToken: exchanged.cookieGrantToken },
        sessionId,
      ),
    );
    if (!("state" in view.outcome)) throw fail();
    return {
      sessionId,
      state: view.outcome.state,
      credentials: {
        grantToken: exchanged.cookieGrantToken,
        csrfToken: view.grant.csrf,
        requestId: randomUUID(),
      },
    };
  };
  const { content } = await buildRecoverySyntheticPack();
  if (content.questions.length !== 2 || content.resources.length !== 5)
    throw fail();
  const answers: ConsumerAnswers = content.questions.map((question) => ({
    questionId: question.id,
    optionId: question.options[0]!.id,
  }));
  const save = async (
    session: Awaited<ReturnType<typeof exchange>>,
    state: ConsumerState,
    input: ConsumerAnswers,
    questionId: string,
  ) => {
    const progress = { questionId };
    const result = await invoke(async (owner) =>
      createConsumerFlowService(owner).save(
        session.credentials,
        session.sessionId,
        {
          binding: {
            schemaVersion: "quizforge.consumer-save.v1",
            session: state.session,
            expectedStateRevision: state.stateRevision,
            consumerStateAnswersSha256: await consumerAnswersSha256(input),
            progressSha256: await consumerProgressSha256(progress),
          },
          answers: input,
          progress,
        },
      ),
    );
    if (result.kind !== "applied-current") throw fail();
    return result.state;
  };
  const completed = await exchange(completedKey.raw);
  const completeState = await save(
    completed,
    completed.state,
    answers,
    content.questions[1]!.id,
  );
  await invoke((owner) =>
    createConsumerFlowService(owner).complete(
      completed.credentials,
      completed.sessionId,
      {
        schemaVersion: "quizforge.consumer-complete.v1",
        session: completeState.session,
        expectedStateRevision: completeState.stateRevision,
        consumerStateAnswersSha256: completeState.consumerStateAnswersSha256,
        progressSha256: completeState.progressSha256,
        completionKey: randomUUID(),
      },
    ),
  );
  const report = await invoke((owner) =>
    createConsumerFlowService(owner).readReport(
      completed.credentials,
      completed.sessionId,
    ),
  );
  const pending = await exchange(pendingKey.raw);
  const pendingState = await save(
    pending,
    pending.state,
    answers.slice(0, 1),
    content.questions[1]!.id,
  );
  // Sensitive synthetic credentials/answers stay with the caller's private drill record, never stdout.
  return {
    source,
    parent: parent.version,
    play: play.play,
    completed: {
      ...completedKey,
      sessionId: completed.sessionId,
      report,
      viewSha256: recoveryHash(canonicalRecoveryJson(report)),
    },
    pending: {
      ...pendingKey,
      sessionId: pending.sessionId,
      state: pendingState,
    },
    unused: unusedKey,
    counts: {
      questions: 2,
      results: 3,
      resources: 5,
      keys: 3,
      sessions: 2,
      reports: 1,
    },
  };
}
