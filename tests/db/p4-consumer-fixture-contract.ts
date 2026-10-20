import { z } from "zod";
import {
  consumerSessionRefSchema,
  consumerMomentSchema,
  consumerSha256Schema,
} from "@/lib/consumer-contract/v1/primitives";
import { consumerStateSchema } from "@/lib/consumer-contract/v1/state";
import { consumerRendererIdentitySchema } from "@/lib/consumer-contract/v1/identities";
import { internalPlayReceiptSchema } from "@/features/product/internal-play/contracts";
import { accessKeyDetailSchema } from "@/features/fulfillment/access/contracts";
import { persistedReportReceiptSchema } from "@/features/report/persisted/view-contracts";
import {
  internalReviewReceiptSchema,
  internalVersionDetailSchema,
  baselineIdentitySchema,
  revisionTargetSchema,
} from "@/features/product/internal-versions/contracts";
import {
  draftSummarySchema,
  draftApplicationScopeSchema,
} from "@/features/product/drafts/contracts";
import {
  withinConsumerBytes,
  sameConsumerFact,
} from "@/lib/consumer-contract/v1/integrity";

export const CONSUMER_FIXTURE_PRIVATE_NAME = "consumer-p4-e2e-fixture.json";
export const CONSUMER_OBSERVATIONS_PRIVATE_NAME =
  "consumer-p4-e2e-observations.json";
export const CONSUMER_FIXTURE_MAX_BYTES = 2_097_152;
export const CONSUMER_E2E_CASES = [
  "operator-play-key",
  "consumer-exchange-entry",
  "save-resume-recovery",
  "completion-report-lock",
  "report-resource-png",
  "access-isolation-logout",
  "void-unused-claimed",
  "source-cookie-boundary",
] as const;
export const consumerFixtureSuiteCompletionSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-fixture-suite-completion.v1"),
    runId: z.uuid(),
    cases: z
      .strictObject({
        caseId: z.enum(CONSUMER_E2E_CASES),
        status: z.literal("passed"),
        expectedStatus: z.literal("passed"),
        retry: z.literal(0),
        repeatEachIndex: z.literal(0),
      })
      .array()
      .length(CONSUMER_E2E_CASES.length),
  })
  .refine(
    (v) =>
      new Set(v.cases.map((c) => c.caseId)).size === CONSUMER_E2E_CASES.length,
  );
const productId = z.literal("consumer-flow-fixture"),
  instanceId = z.string().regex(/^[a-f0-9]{32}$/);
const actor = z.strictObject({
  identifier: z.uuid(),
  secret: z.string().regex(/^qfo_p2a_[A-Za-z0-9_-]{43}$/),
});
/** Raw HttpOnly cookie and CSRF are intentionally absent. Digest is computed privately by test Node. */
export const consumerFixtureGrantObservationSchema = z
  .strictObject({
    source: z.literal("verified-bootstrap-and-cookie-digest"),
    grantId: z.uuid(),
    session: consumerSessionRefSchema,
    credentialDigest: consumerSha256Schema,
    issuedAt: consumerMomentSchema,
    expiresAt: consumerMomentSchema,
    logoutObserved: z.boolean(),
  })
  .refine(
    (v) => Date.parse(v.expiresAt) - Date.parse(v.issuedAt) === 28_800_000,
  );
/** These are exact validated HTTP facts, not a permission to adopt every row under Product. */
export const consumerFixtureObservationsSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-fixture-observations.v1"),
    instanceId,
    runId: z.uuid(),
    productId,
    mode: z.enum(["operator-services", "consumer-e2e"]),
    suiteCompletion: consumerFixtureSuiteCompletionSchema.nullable(),
    plays: internalPlayReceiptSchema.array().max(16),
    keys: accessKeyDetailSchema.array().max(64),
    states: consumerStateSchema.array().max(64),
    reports: persistedReportReceiptSchema.array().max(64),
    grants: consumerFixtureGrantObservationSchema.array().max(256),
  })
  .superRefine((v, ctx) => {
    const bad = () =>
      ctx.addIssue({
        code: "custom",
        message: "Fixture observations must be exact and bounded.",
      });
    if (
      !withinConsumerBytes(v, CONSUMER_FIXTURE_MAX_BYTES) ||
      new Set(v.plays.map((x) => x.id)).size !== v.plays.length ||
      new Set(v.keys.map((x) => x.issue.binding.keyId)).size !==
        v.keys.length ||
      new Set(v.states.map((x) => x.session.sessionId)).size !==
        v.states.length ||
      new Set(v.reports.map((x) => x.reportId)).size !== v.reports.length ||
      new Set(v.grants.map((x) => x.grantId)).size !== v.grants.length
    )
      bad();
    if (
      v.plays.some((x) => x.binding.parent.productId !== v.productId) ||
      v.keys.some((x) => x.issue.binding.play.productId !== v.productId) ||
      v.states.some((x) => x.session.productId !== v.productId) ||
      v.reports.some((x) => x.binding.session.productId !== v.productId) ||
      v.grants.some((x) => x.session.productId !== v.productId)
    )
      bad();
    if (
      v.mode === "consumer-e2e" &&
      (!v.plays.length ||
        !v.keys.length ||
        !v.states.length ||
        !v.reports.length ||
        !v.grants.length)
    )
      bad();
    if (
      v.mode === "consumer-e2e" &&
      (!v.suiteCompletion || v.suiteCompletion.runId !== v.runId)
    )
      bad();
    if (v.mode === "operator-services" && v.suiteCompletion !== null) bad();
    const plays = new Map(v.plays.map((x) => [x.id, x])),
      keys = new Map(v.keys.map((x) => [x.issue.binding.keyId, x])),
      states = new Map(v.states.map((x) => [x.session.sessionId, x]));
    for (const key of v.keys) {
      const p = key.issue.binding.play,
        play = plays.get(p.playVersionId);
      if (!play || play.snapshotSha256 !== p.playSnapshotSha256) bad();
      const claim = key.current.claim,
        completion = key.current.completion;
      if (claim) {
        const s = states.get(claim.sessionId);
        if (
          !s ||
          s.session.keyId !== key.issue.binding.keyId ||
          s.createdAt !== claim.claimedAt
        )
          bad();
      }
      if (
        completion &&
        !v.reports.some(
          (r) =>
            r.reportId === completion.reportId &&
            r.completedAt === completion.completedAt &&
            r.binding.session.keyId === key.issue.binding.keyId,
        )
      )
        bad();
    }
    for (const state of v.states) {
      const key = keys.get(state.session.keyId);
      if (
        !key ||
        key.current.claim?.sessionId !== state.session.sessionId ||
        !sameConsumerFact(
          key.issue.binding.play,
          {
            productId: state.session.productId,
            playVersionId: state.session.playVersionId,
            playSnapshotSha256: state.session.playSnapshotSha256,
          },
          4096,
        )
      )
        bad();
    }
    for (const report of v.reports) {
      const s = states.get(report.binding.session.sessionId),
        key = keys.get(report.binding.session.keyId);
      if (
        !s ||
        !key ||
        key.current.completion?.reportId !== report.reportId ||
        !sameConsumerFact(s.session, report.binding.session, 4096) ||
        s.stateRevision !== report.binding.expectedStateRevision ||
        s.consumerStateAnswersSha256 !==
          report.binding.consumerStateAnswersSha256 ||
        s.progressSha256 !== report.binding.progressSha256
      )
        bad();
    }
    for (const grant of v.grants) {
      const s = states.get(grant.session.sessionId);
      if (!s || !sameConsumerFact(s.session, grant.session, 4096)) bad();
    }
  });
export type ConsumerFixtureObservations = z.infer<
  typeof consumerFixtureObservationsSchema
>;
const source = z.strictObject({
  scope: draftApplicationScopeSchema,
  expectedValidationStateRevision: z.number().int().min(1).max(2147483647),
  expectedCandidateSha256: consumerSha256Schema,
  canonicalContentSha256: consumerSha256Schema,
  assetSetSha256: consumerSha256Schema,
  canonicalManifestSha256: consumerSha256Schema,
  packVersion: z.literal("1.0.1"),
});
const rowFact = z.strictObject({
  table: z.enum([
    "operator",
    "operator_session",
    "audit_event",
    "product",
    "quizpack_import",
    "quizpack_validation",
    "asset_blob",
    "product_asset",
    "product_draft",
    "draft_application",
    "draft_revision",
    "draft_review",
    "product_version",
    "internal_play_version",
    "access_key",
    "consumer_session",
    "consumer_grant",
    "quiz_report",
  ]),
  key: z.string().regex(/^[a-z0-9][a-z0-9./_-]{0,199}$/),
  sha256: consumerSha256Schema,
});
export const consumerFixtureSchema = z
  .strictObject({
    version: z.literal(1),
    qualification: z.literal(
      "synthetic-db-private-pixels-real-reads-no-native-validation",
    ),
    instanceId,
    runId: z.uuid(),
    writerPid: z.number().int().positive(),
    productId,
    prepared: z.boolean(),
    finished: z.boolean(),
    completed: z.boolean(),
    operator: actor,
    readOnly: actor,
    initial: draftSummarySchema.nullable(),
    target: revisionTargetSchema.nullable(),
    source: source.nullable(),
    baseline: baselineIdentitySchema.nullable(),
    review: internalReviewReceiptSchema.nullable(),
    parent: internalVersionDetailSchema.nullable(),
    consumerRenderer: consumerRendererIdentitySchema.nullable(),
    blobs: z
      .strictObject({
        sha256: consumerSha256Schema,
        bytes: z.number().int().positive().max(8388608),
        created: z.boolean(),
      })
      .array()
      .max(5),
    observations: consumerFixtureObservationsSchema.nullable(),
    rows: rowFact.array().max(8192),
  })
  .superRefine((v, ctx) => {
    const bad = () =>
      ctx.addIssue({
        code: "custom",
        message: "Fixture graph ownership must remain exact.",
      });
    if (
      !withinConsumerBytes(v, CONSUMER_FIXTURE_MAX_BYTES) ||
      v.operator.identifier === v.readOnly.identifier ||
      (v.finished && !v.prepared) ||
      new Set(v.blobs.map((x) => x.sha256)).size !== v.blobs.length ||
      new Set(v.rows.map((x) => `${x.table}/${x.key}`)).size !== v.rows.length
    )
      bad();
    if (
      v.prepared &&
      (!v.initial ||
        !v.target ||
        !v.source ||
        !v.baseline ||
        !v.review ||
        !v.parent ||
        !v.consumerRenderer ||
        v.blobs.length !== 5 ||
        v.initial.productId !== v.productId ||
        v.initial.revision !== 1 ||
        v.target.revision !== 1 ||
        v.parent.snapshot.productId !== v.productId ||
        v.parent.snapshot.target.revision !== 1 ||
        v.parent.version.createdBy !== v.operator.identifier ||
        v.review.recordedBy !== v.operator.identifier ||
        v.parent.version.binding.reviewId !== v.review.id ||
        v.parent.version.binding.reviewSha256 !== v.review.reviewSha256 ||
        v.source.scope.productId !== v.productId)
    )
      bad();
    if (
      v.prepared &&
      v.initial &&
      v.target &&
      v.source &&
      v.baseline &&
      v.review &&
      v.parent
    ) {
      if (
        v.initial.draftId !== v.target.draftId ||
        v.initial.createdBy !== v.operator.identifier ||
        v.initial.sourceImportId !== v.source.scope.sourceImportId ||
        v.initial.sourceValidationId !== v.source.scope.sourceValidationId ||
        v.target.canonicalContentSha256 !== v.source.canonicalContentSha256 ||
        v.target.assetSetSha256 !== v.source.assetSetSha256 ||
        v.target.canonicalManifestSha256 !== v.source.canonicalManifestSha256 ||
        v.review.binding.productId !== v.productId ||
        v.review.facts.approval.kind !== "synthetic-test" ||
        !sameConsumerFact(v.review.binding.target, v.target, 4096) ||
        !sameConsumerFact(v.review.facts.baseline, v.baseline, 4096) ||
        !sameConsumerFact(v.parent.snapshot.target, v.target, 4096) ||
        !sameConsumerFact(v.parent.snapshot.baseline, v.baseline, 4096) ||
        v.parent.snapshot.validation.sourceImportId !==
          v.source.scope.sourceImportId ||
        v.parent.snapshot.validation.sourceValidationId !==
          v.source.scope.sourceValidationId ||
        v.parent.snapshot.validation.sourceValidationStateRevision !==
          v.source.expectedValidationStateRevision
      )
        bad();
    }
    if (
      v.observations &&
      (v.observations.instanceId !== v.instanceId ||
        v.observations.runId !== v.runId ||
        v.observations.productId !== v.productId)
    )
      bad();
    if (v.finished && (!v.observations || !v.rows.length)) bad();
    if (
      v.completed !==
      Boolean(
        v.finished &&
        v.observations?.mode === "consumer-e2e" &&
        v.observations.suiteCompletion &&
        v.observations.reports.length,
      )
    )
      bad();
  });
export type ConsumerFixture = z.infer<typeof consumerFixtureSchema>;
