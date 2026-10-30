import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { synthetic24ContentV3 } from "@/features/quizpack/content/v3-synthetic.test-support";
import { buildSupportedQuizPack } from "@/features/quizpack/package/build";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import type { ReadyDraftSourceEvidence } from "@/features/quizpack/draft-source-evidence";
import {
  BASELINES_V2,
  findCurrentBaselineDescriptor,
  matchCurrentRegisteredBaseline,
} from "./baseline-registry-v2";
import { baselineDescriptorV2Schema } from "./baseline-schema-v2";
import { IMPLEMENTATION_AVAILABILITY_V2 } from "./implementation-catalog-v2";
import { buildInternalSnapshot } from "./snapshot";
import {
  recordBaselineFingerprint,
  reviewFactsText,
  hashInternalText,
  type InternalReviewReceipt,
} from "./contracts";
import { persistedReportFixtureV2 } from "@/features/report/persisted/contracts-v2.test-support";
import historical from "./baselines/historical-cabinet-2026-10-18.json";

const fixed = BASELINES_V2[0]!,
  d = fixed.descriptor;
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sourceFacts = {
  productId: d.productId,
  canonicalContentSha256: d.canonicalContentSha256,
  assetSetSha256: d.assetSetSha256,
  canonicalManifestSha256: d.canonicalManifestSha256,
};
it("matches the deterministic full v3 package while limiting the synthetic registration to test/ci", async () => {
  const fixture = await synthetic24ContentV3(d.productId);
  const built = await buildSupportedQuizPack(
    {
      packId: d.productId,
      packVersion: "1.0.0",
      content: fixture.content,
      assets: fixture.assets,
    },
    { targetProductId: d.productId },
    "quizpack-content.v3",
  );
  expect(built.ok).toBe(true);
  if (!built.ok) throw Error("EXPECTED_BUILT_PACKAGE");
  expect(sha(canonicalP1Json(fixture.content))).toBe(d.canonicalContentSha256);
  expect(built.value.report.manifestSha256).toBe(d.canonicalManifestSha256);
  expect(fixture.content.bindings.slots).toEqual(d.slots);
  expect(matchCurrentRegisteredBaseline(sourceFacts, "test")).toBe(fixed);
  expect(matchCurrentRegisteredBaseline(sourceFacts, "demo")).toBeNull();
  expect(findCurrentBaselineDescriptor(fixed.identity)).toBe(fixed);
  for (const field of [
    "canonicalContentSha256",
    "assetSetSha256",
    "canonicalManifestSha256",
  ] as const)
    expect(
      matchCurrentRegisteredBaseline(
        { ...sourceFacts, [field]: "0".repeat(64) },
        "test",
      ),
    ).toBeNull();
  expect(
    matchCurrentRegisteredBaseline(
      { ...sourceFacts, productId: "foreign" },
      "test",
    ),
  ).toBeNull();
  expect(
    matchCurrentRegisteredBaseline(historical, "demo")?.descriptor
      .schemaVersion,
  ).toBe("quizforge.baseline-registry-entry.v1");
});
it("seals v3 metadata with the exact engine/font and rejects mixed implementation or baseline facts", async () => {
  const blueprint = (await persistedReportFixtureV2()).snapshot.play.snapshot
    .parentSnapshot;
  const target = {
    draftId: uuid(1),
    revision: 1,
    canonicalContentSha256: d.canonicalContentSha256,
    assetSetSha256: d.assetSetSha256,
    canonicalManifestSha256: d.canonicalManifestSha256,
  };
  const binding = {
    schemaVersion: "quizforge.review-record.v1" as const,
    productId: d.productId,
    target,
    baseline: fixed.identity,
    idempotencyKey: uuid(2),
  };
  const facts = {
    schemaVersion: "quizforge.internal-review-facts.v1" as const,
    productId: d.productId,
    target,
    baseline: fixed.identity,
    purpose: "internal-test" as const,
    approval: d.approval,
  };
  const review: InternalReviewReceipt = {
    id: uuid(3),
    binding,
    fingerprint: await recordBaselineFingerprint(binding),
    facts,
    reviewSha256: await hashInternalText(reviewFactsText(facts)),
    recordedBy: uuid(4),
    recordedAt: "2026-10-27T00:00:00.000Z",
  };
  const seal = {
    schemaVersion: "quizforge.internal-version-seal.v1" as const,
    productId: d.productId,
    idempotencyKey: uuid(5),
    target,
    reviewId: review.id,
    reviewSha256: review.reviewSha256,
    engine: IMPLEMENTATION_AVAILABILITY_V2.engine,
    renderer: IMPLEMENTATION_AVAILABILITY_V2.renderer,
  };
  // Metadata reconstruction fixture only; it does not claim native validation or a database write.
  const source: ReadyDraftSourceEvidence = {
    ...sourceFacts,
    sourceImportId: blueprint.validation.sourceImportId,
    sourceValidationId: blueprint.validation.sourceValidationId,
    sourceValidationStateRevision: 1,
    canonicalContentText: "{}",
    assetSetText: "{}",
    candidateSha256: "a".repeat(64),
    containerSchemaVersion: "quizpack.v1",
    contentSchemaVersion: "quizpack-content.v3",
    contentKind: "synthetic",
    packId: d.productId,
    packVersion: "1.0.0",
    resourceCount: d.resourceEdges.length,
    versions: { ...blueprint.versions, engine: d.engine },
    validation: blueprint.validation,
    resources: [],
  };
  const output = buildInternalSnapshot(seal, review, source);
  expect(output.snapshot.schemaVersion).toBe(
    "quizforge.internal-version-snapshot.v2",
  );
  expect(output.snapshot.font).toEqual({
    kind: "system-structured",
    pngAvailable: false,
  });
  expect(output.snapshot.engine).toEqual(IMPLEMENTATION_AVAILABILITY_V2.engine);
  expect(() =>
    buildInternalSnapshot(
      { ...seal, renderer: { ...seal.renderer, entrySha256: "0".repeat(64) } },
      review,
      source,
    ),
  ).toThrow();
  expect(() =>
    buildInternalSnapshot(seal, review, {
      ...source,
      contentSchemaVersion: "quizpack-content.v2",
    }),
  ).toThrow();
  expect(() =>
    buildInternalSnapshot(seal, review, {
      ...source,
      assetSetSha256: "0".repeat(64),
    }),
  ).toThrow();
});
it("rejects foreign resource ownership and unsupported approval claims in v3 baselines", () => {
  const foreign = structuredClone(d);
  foreign.slots.characters[0]!.nameArt.productId = "other";
  expect(baselineDescriptorV2Schema.safeParse(foreign).success).toBe(false);
  expect(
    baselineDescriptorV2Schema.safeParse({
      ...d,
      allowedInstancePurposes: ["test", "demo"],
    }).success,
  ).toBe(false);
  const alias = structuredClone(d);
  alias.resourceEdges[0]!.width++;
  expect(baselineDescriptorV2Schema.safeParse(alias).success).toBe(false);
});
