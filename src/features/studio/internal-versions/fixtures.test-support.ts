import {
  recordBaselineFingerprint,
  sealInternalVersionFingerprint,
  reviewFactsText,
  internalSnapshotText,
  hashInternalText,
  type RecordBaselineBinding,
  type InternalReviewReceipt,
  type InternalVersionReceipt,
  type InternalVersionSnapshot,
} from "@/features/product/internal-versions/contracts";
/** Synthetic isolated transport data; no real author statement, user data, Key or approval. */
export const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const sha = (c = "a") => c.repeat(64);
export const target = {
  draftId: uuid(1),
  revision: 2,
  canonicalContentSha256: sha(),
  assetSetSha256: sha("b"),
  canonicalManifestSha256: sha("c"),
};
export const baseline = {
  kind: "baseline" as const,
  id: "synthetic-baseline",
  version: "1.0.0",
  entrySha256: sha("d"),
};
export const renderer = {
  kind: "renderer" as const,
  id: "folio-cabinet-preview",
  version: "1.0.0",
  entrySha256: sha("e"),
};
export const engine = {
  kind: "engine" as const,
  id: "archetype" as const,
  version: "1.0.0" as const,
  entrySha256: sha("f"),
};
export const binding: RecordBaselineBinding = {
  productId: "test-product",
  schemaVersion: "quizforge.review-record.v1",
  idempotencyKey: uuid(2),
  target,
  baseline,
};
export async function fixture() {
  const facts = {
    schemaVersion: "quizforge.internal-review-facts.v1" as const,
    productId: binding.productId,
    target,
    baseline,
    purpose: "internal-test" as const,
    approval: {
      kind: "synthetic-test" as const,
      fixtureId: "test-profile",
      evidenceSha256: sha(),
      scope: "test-evidence-no-author-approval" as const,
    },
  };
  const review: InternalReviewReceipt = {
    id: uuid(3),
    binding,
    fingerprint: await recordBaselineFingerprint(binding),
    facts,
    reviewSha256: await hashInternalText(reviewFactsText(facts)),
    recordedBy: uuid(4),
    recordedAt: "2026-10-18T00:00:00.000Z",
  };
  const seal = {
    productId: binding.productId,
    schemaVersion: "quizforge.internal-version-seal.v1" as const,
    idempotencyKey: uuid(5),
    target,
    reviewId: review.id,
    reviewSha256: review.reviewSha256,
    renderer,
    engine,
  };
  const component = <I extends string>(id: I) => ({
    id,
    version: "2.0.0" as const,
    propsSchemaVersion: "1.0.0" as const,
  });
  const snapshot: InternalVersionSnapshot = {
    schemaVersion: "quizforge.internal-version-snapshot.v1",
    productId: binding.productId,
    target,
    reviewId: review.id,
    reviewSha256: review.reviewSha256,
    baseline,
    purpose: "internal-test",
    publicationApproved: false,
    contentSchemaVersion: "quizpack-content.v2",
    contentKind: "synthetic",
    packId: "test-pack",
    packVersion: "1.0.0",
    versions: {
      contentVersion: "1.0.0",
      visualVersion: "1.0.0",
      reportVersion: "1.0.0",
      resourceVersion: "1.0.0",
      componentVersion: "2.0.0",
      engine: { id: "archetype", version: "1.0.0" },
    },
    logicHash: sha(),
    renderer,
    rendererCapability: "studio-internal-preview",
    components: {
      cover: component("folio-cover"),
      question: component("folio-question"),
      resume: component("folio-resume"),
      result: component("cabinet-result"),
      report: component("folio-report"),
      poster: component("folio-poster"),
    },
    engine,
    font: {
      id: "test-font",
      version: "1.0.0",
      fileSha256: sha(),
      coverageSha256: sha("b"),
      licenseSha256: sha("c"),
      weight: 600,
    },
    validation: {
      sourceImportId: uuid(6),
      sourceValidationId: uuid(7),
      sourceValidationStateRevision: 5,
      archiveSha256: sha(),
      candidateSha256: sha("b"),
      identitySha256: sha("c"),
      validatorBundleSha256: sha("d"),
      archivePolicyVersion: "test-policy.v1",
      archivePolicySha256: sha("e"),
      evidenceSha256: sha("f"),
    },
  };
  const version: InternalVersionReceipt = {
    id: uuid(8),
    slot: 1,
    binding: seal,
    fingerprint: await sealInternalVersionFingerprint(seal),
    purpose: "internal-test",
    publicationApproved: false,
    snapshotSha256: await hashInternalText(internalSnapshotText(snapshot)),
    createdBy: uuid(4),
    createdAt: review.recordedAt,
  };
  return structuredClone({ review, version, snapshot, seal });
}
export function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
