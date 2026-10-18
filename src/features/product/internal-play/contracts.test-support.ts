import { DISPLAY_COMPONENT_IDS_V1 } from "@/lib/assessment-contract/display-limits-v1";
import {
  CONSUMER_PROTOCOLS_V1,
  consumerComponentMappingSchema,
  consumerMappingSha256,
} from "@/lib/consumer-contract/v1/identities";
import {
  consumerCanonicalText,
  consumerTextSha256,
} from "@/lib/consumer-contract/v1/integrity";
import {
  previewFixture,
  sourceBinding,
} from "@/features/theme/preview/fixtures.test-support";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  prepareContentForScoring,
  scorePreparedContent,
} from "@/features/quizpack/content/scoring-adapter";
import {
  hashInternalText,
  internalSnapshotText,
  sealInternalVersionFingerprint,
  type InternalVersionDetail,
} from "../internal-versions/contracts";
import {
  internalPlayBindingSha256,
  internalPlaySnapshotSha256,
  type InternalPlayDetail,
  type InternalPlayResources,
} from "./contracts";

export const testUuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const testSha = (n = "a") => n.repeat(64);
export const testMoment = "2026-10-18T00:00:00.000Z";

/** Synthetic metadata only; no runtime registration, actual artifact, credential or author approval. */
export async function internalPlayFixture() {
  const content = await previewFixture();
  const answers = content.questions.map((q) => ({
    questionId: q.id,
    optionId: q.options[0]!.id,
  }));
  const prepared = prepareContentForScoring(content);
  if (!prepared.ok) throw Error("SYNTHETIC_FIXTURE_INVALID");
  const scored = scorePreparedContent(prepared.value, answers);
  if (!scored.ok) throw Error("SYNTHETIC_FIXTURE_INVALID");
  const source = sourceBinding(content);
  const hash = (v: unknown) => hashInternalText(canonicalP1Json(v));
  const resources: InternalPlayResources = {
    schemaVersion: "quizpack-candidate-asset-set.v1",
    productId: content.product.productId,
    resources: await Promise.all(
      content.resources.map(async (r) => ({
        productId: r.productId,
        resourceId: r.id,
        resourceVersion: r.version,
        blobSha256: r.sha256,
        declarationSha256: await hash(r),
      })),
    ),
  };
  resources.resources.sort((a, b) =>
    a.resourceId < b.resourceId
      ? -1
      : a.resourceId > b.resourceId
        ? 1
        : a.resourceVersion < b.resourceVersion
          ? -1
          : 1,
  );
  const components = Object.fromEntries(
    Object.entries(DISPLAY_COMPONENT_IDS_V1).map(([state, id]) => [
      state,
      { id, version: "2.0.0", propsSchemaVersion: "1.0.0" },
    ]),
  ) as InternalVersionDetail["snapshot"]["components"];
  const engine = {
    kind: "engine" as const,
    ...content.engine,
    entrySha256: testSha("e"),
  };
  const target = {
    draftId: source.draftId,
    revision: source.revision,
    canonicalContentSha256: source.canonicalContentSha256,
    assetSetSha256: source.assetSetSha256,
    canonicalManifestSha256: testSha("b"),
  };
  const previewRenderer = {
    kind: "renderer" as const,
    id: "folio-cabinet-preview",
    version: "1.0.0",
    entrySha256: testSha("c"),
  };
  const binding = {
    schemaVersion: "quizforge.internal-version-seal.v1" as const,
    productId: source.productId,
    idempotencyKey: testUuid(2),
    target,
    reviewId: testUuid(3),
    reviewSha256: testSha("d"),
    renderer: previewRenderer,
    engine,
  };
  const parentSnapshot: InternalVersionDetail["snapshot"] = {
    schemaVersion: "quizforge.internal-version-snapshot.v1",
    productId: source.productId,
    target,
    reviewId: binding.reviewId,
    reviewSha256: binding.reviewSha256,
    baseline: {
      kind: "baseline",
      id: "synthetic-test",
      version: "1.0.0",
      entrySha256: testSha("f"),
    },
    purpose: "internal-test",
    publicationApproved: false,
    contentSchemaVersion: "quizpack-content.v2",
    contentKind: "synthetic",
    packId: "synthetic-pack",
    packVersion: "1.0.0",
    versions: {
      contentVersion: content.contentVersion,
      visualVersion: content.visualVersion,
      reportVersion: content.reportVersion,
      resourceVersion: content.resourceVersion,
      componentVersion: "2.0.0",
      engine: content.engine,
    },
    logicHash: scored.value.score.logicHash,
    renderer: previewRenderer,
    rendererCapability: "studio-internal-preview",
    components,
    engine,
    font: {
      id: "test-font",
      version: "1.0.0",
      fileSha256: testSha(),
      coverageSha256: testSha("b"),
      licenseSha256: testSha("c"),
      weight: 600,
    },
    validation: {
      sourceImportId: testUuid(4),
      sourceValidationId: testUuid(5),
      sourceValidationStateRevision: 1,
      archiveSha256: testSha(),
      candidateSha256: testSha(),
      identitySha256: testSha(),
      validatorBundleSha256: testSha(),
      archivePolicyVersion: "test.v1",
      archivePolicySha256: testSha(),
      evidenceSha256: testSha(),
    },
  };
  const parent: InternalVersionDetail = {
    snapshot: parentSnapshot,
    version: {
      id: testUuid(6),
      slot: 1,
      binding,
      fingerprint: await sealInternalVersionFingerprint(binding),
      purpose: "internal-test",
      publicationApproved: false,
      snapshotSha256: await hashInternalText(
        internalSnapshotText(parentSnapshot),
      ),
      createdBy: testUuid(7),
      createdAt: testMoment,
    },
  };
  const mapping = consumerComponentMappingSchema.parse({
    schemaVersion: "quizforge.consumer-component-map.v1",
    states: Object.fromEntries(
      Object.entries(components).map(([state, source]) => [
        state,
        {
          source,
          runtime: {
            id: `consumer-${source.id}`,
            version: "1.0.0",
            propsSchemaVersion: "1.0.0",
          },
        },
      ]),
    ),
  });
  const renderer = {
    kind: "consumer-renderer" as const,
    id: "consumer-folio-cabinet",
    version: "1.0.0",
    entrySha256: testSha("f"),
  };
  const playBinding = {
    schemaVersion: "quizforge.internal-play-create.v1" as const,
    operationKey: testUuid(8),
    parent: {
      productId: source.productId,
      versionId: parent.version.id,
      snapshotSha256: parent.version.snapshotSha256,
    },
    renderer,
  };
  const snapshot: InternalPlayDetail["snapshot"] = {
    schemaVersion: "quizforge.internal-play-snapshot.v1",
    purpose: "internal-test",
    publicationApproved: false,
    parent: playBinding.parent,
    parentSnapshot,
    renderer,
    mapping,
    mappingSha256: await consumerMappingSha256(mapping),
    resources,
    protocols: { ...CONSUMER_PROTOCOLS_V1 },
  };
  const play: InternalPlayDetail = {
    snapshot,
    play: {
      schemaVersion: "quizforge.internal-play-receipt.v1",
      id: testUuid(9),
      slot: 1,
      binding: playBinding,
      bindingSha256: await internalPlayBindingSha256(playBinding),
      snapshotSha256: await internalPlaySnapshotSha256(snapshot),
      createdBy: testUuid(7),
      createdAt: testMoment,
      purpose: "internal-test",
      publicationApproved: false,
    },
  };
  return { content, parent, play, answers, scored: scored.value };
}

export const resourceSetHash = (value: unknown) =>
  consumerTextSha256(consumerCanonicalText(value, 65536));
