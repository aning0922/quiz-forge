import {
  internalPlayFixture,
  testUuid,
  testMoment,
} from "@/features/product/internal-play/contracts.test-support";
import {
  internalPlayDetailSchema,
  internalPlayBindingSha256,
  internalPlaySnapshotSha256,
} from "@/features/product/internal-play/contracts";
import { internalVersionSnapshotV2Schema } from "@/features/product/internal-versions/identity-contracts";
import { synthetic24ContentV3 } from "@/features/quizpack/content/v3-synthetic.test-support";
import { prepareContentV3 } from "@/features/quizpack/content/v3-scoring-adapter";
import { projectPreparedResultV3 } from "@/features/theme/preview/v3-projection";
import { CONTENT_COMPONENTS_V3 } from "@/lib/assessment-contract/presentation-v3";
import {
  consumerCanonicalText,
  consumerTextSha256,
} from "@/lib/consumer-contract/v1/integrity";
import {
  consumerAnswersSchema,
  consumerAnswersSha256,
  consumerProgressSha256,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerCompleteBindingV2Schema,
  consumerCompleteBindingSha256V2,
  consumerMatchingSha256V2,
} from "@/lib/consumer-contract/v2/state";
import {
  STRUCTURED_FONT_V2,
  CONSUMER_PROTOCOLS_V2,
  consumerComponentMappingV2Schema,
  consumerMappingSha256V2,
} from "@/lib/consumer-contract/v2/identities";
import {
  persistedReportDisplayV2Schema,
  persistedReportReceiptV2Schema,
  persistedReportDisplaySha256V2,
} from "./view-contracts-v2";
import {
  persistedReportSnapshotV2Schema,
  persistedReportSnapshotSha256V2,
} from "./snapshot-contract-v2";
/** Synthetic metadata and actual 24-answer deterministic execution. No registry or durable DB authority. */
export async function persistedReportFixtureV2() {
  const old = await internalPlayFixture(),
    { content } = await synthetic24ContentV3();
  const prepared = prepareContentV3(content);
  if (!prepared.ok) throw Error("FIXTURE_PREPARE_FAILED");
  const matchingContext = {
    schemaVersion: "quiz-matching-context.v1" as const,
    preference: "any" as const,
    policyRef: content.core.scoringDefinition.matchingPolicy.ref,
  };
  const answers = consumerAnswersSchema.parse(
      content.bindings.witnesses.entries[0]!.answers,
    ),
    progress = { questionId: null };
  const projected = projectPreparedResultV3(prepared.value, {
    schemaVersion: "quiz-scoring-input.v2",
    answers,
    matchingContext,
  });
  if (!projected.ok) throw Error("FIXTURE_PROJECTION_FAILED");
  const hash = (v: unknown) =>
    consumerTextSha256(consumerCanonicalText(v, 524288));
  const resources = {
    schemaVersion: "quizpack-candidate-asset-set.v1" as const,
    productId: content.core.scoringDefinition.productId,
    resources: await Promise.all(
      [...content.bindings.resources]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(async (r) => ({
          productId: r.productId,
          resourceId: r.id,
          resourceVersion: r.version,
          blobSha256: r.sha256,
          declarationSha256: await hash(r),
        })),
    ),
  };
  const components = Object.fromEntries(
    Object.entries(CONTENT_COMPONENTS_V3).map(([s, id]) => [
      s,
      { id, version: "1.0.0", propsSchemaVersion: "1.0.0" },
    ]),
  );
  const parentSnapshot = internalVersionSnapshotV2Schema.parse({
    ...old.play.snapshot.parentSnapshot,
    schemaVersion: "quizforge.internal-version-snapshot.v2",
    contentSchemaVersion: "quizpack-content.v3",
    productId: resources.productId,
    packId: resources.productId,
    target: {
      ...old.play.snapshot.parentSnapshot.target,
      canonicalContentSha256: projected.value.score.canonicalContentSha256,
      assetSetSha256: await hash(resources),
    },
    versions: {
      contentVersion: content.core.scoringDefinition.contentVersion,
      visualVersion: content.bindings.visualVersion,
      reportVersion: content.bindings.reportVersion,
      resourceVersion: content.bindings.resourceVersion,
      componentVersion: content.bindings.componentVersion,
      engine: content.core.scoringDefinition.engine,
    },
    logicHash: projected.value.score.score.logicHash,
    engine: {
      ...old.play.snapshot.parentSnapshot.engine,
      ...content.core.scoringDefinition.engine,
    },
    components,
    font: STRUCTURED_FONT_V2,
  });
  const parent = {
    ...old.play.snapshot.parent,
    productId: resources.productId,
    snapshotSha256: await hash(parentSnapshot),
  };
  const binding = { ...old.play.play.binding, parent };
  const mapping = consumerComponentMappingV2Schema.parse({
    schemaVersion: "quizforge.consumer-component-map.v2",
    states: Object.fromEntries(
      Object.entries(CONTENT_COMPONENTS_V3).map(([s, id]) => [
        s,
        {
          source: { id, version: "1.0.0", propsSchemaVersion: "1.0.0" },
          runtime: {
            id: `consumer-composed-${s}`,
            version: "1.0.0",
            propsSchemaVersion: "1.0.0",
          },
        },
      ]),
    ),
  });
  const playSnapshot = {
    schemaVersion: "quizforge.internal-play-snapshot.v2",
    purpose: "internal-test",
    publicationApproved: false,
    parent,
    parentSnapshot,
    renderer: old.play.snapshot.renderer,
    mapping,
    mappingSha256: await consumerMappingSha256V2(mapping),
    resources,
    protocols: CONSUMER_PROTOCOLS_V2,
    presentation: {
      presentationMode: "structured-only",
      exports: { posterPng: false, fullReportPng: false },
    },
  };
  const play = internalPlayDetailSchema.parse({
    snapshot: playSnapshot,
    play: {
      ...old.play.play,
      binding,
      bindingSha256: await internalPlayBindingSha256(binding),
      snapshotSha256: await internalPlaySnapshotSha256(playSnapshot),
    },
  });
  const completion = consumerCompleteBindingV2Schema.parse({
    schemaVersion: "quizforge.consumer-complete.v2",
    session: {
      productId: parent.productId,
      playVersionId: play.play.id,
      playSnapshotSha256: play.play.snapshotSha256,
      keyId: testUuid(20),
      sessionId: testUuid(21),
    },
    expectedStateRevision: 1,
    consumerStateAnswersSha256: await consumerAnswersSha256(answers),
    progressSha256: await consumerProgressSha256(progress),
    matchingContextSha256: await consumerMatchingSha256V2(matchingContext),
    completionKey: testUuid(22),
  });
  const bindingSha256 = await consumerCompleteBindingSha256V2(completion);
  const view = persistedReportDisplayV2Schema.parse({
    schemaVersion: "quizforge.consumer-report-display.v2",
    reportId: testUuid(23),
    session: completion.session,
    completedAt: testMoment,
    completionBindingSha256: bindingSha256,
    parent,
    renderer: play.snapshot.renderer,
    font: parentSnapshot.font,
    mapping,
    mappingSha256: play.snapshot.mappingSha256,
    display: projected.value.display,
  });
  const snapshot = persistedReportSnapshotV2Schema.parse({
    schemaVersion: "quizforge.consumer-report-snapshot.v2",
    binding: completion,
    play,
    answers,
    progress,
    matchingContext,
    score: projected.value.score,
    view,
  });
  const receipt = persistedReportReceiptV2Schema.parse({
    schemaVersion: "quizforge.consumer-report-receipt.v2",
    reportId: view.reportId,
    binding: completion,
    bindingSha256,
    completedAt: testMoment,
    reportSnapshotSha256: await persistedReportSnapshotSha256V2(snapshot),
    displaySha256: await persistedReportDisplaySha256V2(view),
  });
  return { content, snapshot, receipt, view };
}
