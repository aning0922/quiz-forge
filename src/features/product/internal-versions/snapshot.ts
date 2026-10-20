import "server-only";
import { createHash } from "node:crypto";
import { StudioError } from "@/lib/http-security/errors";
import type { ReadyDraftSourceEvidence } from "@/features/quizpack/draft-source-evidence";
import { findBaselineDescriptor } from "./baseline-registry";
import {
  findRendererImplementationDescriptor,
  findEngineImplementationDescriptor,
} from "./implementation-catalog";
import {
  internalVersionSnapshotSchema,
  internalSnapshotText,
  internalCanonicalText,
  sameRevisionTarget,
  type InternalReviewReceipt,
  type SealInternalVersionBinding,
} from "./contracts";

/** Rebuilds immutable semantics from retained metadata only. Never invokes an execution resolver or reads FS. */
export function buildInternalSnapshot(
  binding: SealInternalVersionBinding,
  review: InternalReviewReceipt,
  source: ReadyDraftSourceEvidence,
) {
  const baseline = findBaselineDescriptor(review.facts.baseline),
    renderer = findRendererImplementationDescriptor(binding.renderer),
    engine = findEngineImplementationDescriptor(binding.engine);
  if (!baseline || !renderer || !engine)
    throw new StudioError("VERSION_DEPENDENCY_UNAVAILABLE");
  if (
    review.id !== binding.reviewId ||
    review.reviewSha256 !== binding.reviewSha256 ||
    review.binding.productId !== binding.productId ||
    !sameRevisionTarget(review.binding.target, binding.target) ||
    source.productId !== binding.productId ||
    source.canonicalContentSha256 !== binding.target.canonicalContentSha256 ||
    source.assetSetSha256 !== binding.target.assetSetSha256 ||
    source.canonicalManifestSha256 !== binding.target.canonicalManifestSha256 ||
    baseline.descriptor.productId !== source.productId ||
    baseline.descriptor.canonicalContentSha256 !==
      source.canonicalContentSha256 ||
    baseline.descriptor.assetSetSha256 !== source.assetSetSha256 ||
    baseline.descriptor.canonicalManifestSha256 !==
      source.canonicalManifestSha256
  )
    throw new StudioError("REVIEW_BASELINE_MISMATCH");
  if (
    internalCanonicalText(engine.descriptor.algorithm) !==
      internalCanonicalText(source.versions.engine) ||
    internalCanonicalText(baseline.descriptor.engine) !==
      internalCanonicalText(source.versions.engine) ||
    internalCanonicalText(renderer.descriptor.components) !==
      internalCanonicalText(baseline.descriptor.components)
  )
    throw new StudioError("VERSION_DEPENDENCY_UNAVAILABLE");
  const f = renderer.descriptor.font;
  const parsed = internalVersionSnapshotSchema.safeParse({
    schemaVersion: "quizforge.internal-version-snapshot.v1",
    productId: source.productId,
    target: binding.target,
    reviewId: review.id,
    reviewSha256: review.reviewSha256,
    baseline: baseline.identity,
    purpose: "internal-test",
    publicationApproved: false,
    contentSchemaVersion: source.contentSchemaVersion,
    contentKind: source.contentKind,
    packId: source.packId,
    packVersion: source.packVersion,
    versions: source.versions,
    logicHash: baseline.descriptor.logicHash,
    renderer: binding.renderer,
    rendererCapability: renderer.descriptor.capability,
    components: renderer.descriptor.components,
    engine: binding.engine,
    font: {
      id: f.id,
      version: f.version,
      fileSha256: f.fileSha256,
      coverageSha256: f.coverageSha256,
      licenseSha256: f.licenseSha256,
      weight: f.weight,
    },
    validation: source.validation,
  });
  if (!parsed.success) throw new StudioError("VERSION_DEPENDENCY_UNAVAILABLE");
  const text = internalSnapshotText(parsed.data);
  return {
    snapshot: parsed.data,
    text,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}
