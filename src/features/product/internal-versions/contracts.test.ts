import { canonicalOrdinaryJson } from "@/lib/json/canonical";
import { canonicalInternalJson } from "./canonical";
import { describe, expect, it } from "vitest";
import {
  revisionTargetSchema,
  baselineIdentitySchema,
  engineIdentitySchema,
  internalVersionSnapshotSchema,
  recordBaselineBindingSchema,
  sealInternalVersionBindingSchema,
  recordBaselineFingerprint,
  sealInternalVersionFingerprint,
  reviewFactsText,
  internalSnapshotText,
  hashInternalText,
  recordBaselineFingerprintText,
  internalCanonicalText,
  internalReviewReceiptSchema,
  internalReviewResolutionSchema,
  internalVersionResolutionSchema,
  internalVersionListResponseSchema,
  INTERNAL_VERSION_LIMITS as L,
  internalVersionDetailSchema,
  type RecordBaselineBinding,
  type InternalReviewReceipt,
  type InternalVersionReceipt,
  type InternalVersionSnapshot,
} from "./contracts";
import {
  verifyInternalReviewReceipt,
  verifyInternalReviewResolution,
  verifyInternalVersionDetail,
  verifyInternalVersionResolution,
} from "./integrity";
import {
  internalRevisionParam,
  internalReviewUrl,
  internalVersionUrl,
} from "./urls";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const sha = (c = "a") => c.repeat(64);
const target = {
  draftId: uuid(1),
  revision: 2,
  canonicalContentSha256: sha(),
  assetSetSha256: sha("b"),
  canonicalManifestSha256: sha("c"),
};
const baseline = {
  kind: "baseline" as const,
  id: "synthetic-baseline",
  version: "1.0.0",
  entrySha256: sha("d"),
};
const renderer = {
  kind: "renderer" as const,
  id: "folio-cabinet-preview",
  version: "1.0.0",
  entrySha256: sha("e"),
};
const engine = {
  kind: "engine" as const,
  id: "archetype" as const,
  version: "1.0.0" as const,
  entrySha256: sha("f"),
};
const binding: RecordBaselineBinding = {
  productId: "test-product",
  schemaVersion: "quizforge.review-record.v1",
  idempotencyKey: uuid(2),
  target,
  baseline,
};
async function fixture() {
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
  return { review, version, snapshot, seal };
}
describe("exact review and version operation contracts", () => {
  it("uses distinct domains and canonical full bindings including the original key", async () => {
    const { seal } = await fixture();
    const reordered = Object.fromEntries(Object.entries(binding).reverse());
    expect(recordBaselineFingerprintText(reordered)).toBe(
      recordBaselineFingerprintText(binding),
    );
    expect(
      await recordBaselineFingerprint({ ...binding, idempotencyKey: uuid(90) }),
    ).not.toBe(await recordBaselineFingerprint(binding));
    expect(await recordBaselineFingerprint(binding)).not.toBe(
      await sealInternalVersionFingerprint({
        ...seal,
        idempotencyKey: binding.idempotencyKey,
      }),
    );
    expect(recordBaselineFingerprintText(binding)).toBe(
      internalCanonicalText(binding),
    );
  });
  it("rejects extra authority, cross-kind registry and trailing control characters", () => {
    expect(
      recordBaselineBindingSchema.safeParse({ ...binding, approved: true })
        .success,
    ).toBe(false);
    expect(
      recordBaselineBindingSchema.safeParse({ ...binding, baseline: renderer })
        .success,
    ).toBe(false);
    expect(
      baselineIdentitySchema.safeParse({ ...baseline, id: "baseline\n" })
        .success,
    ).toBe(false);
    expect(
      baselineIdentitySchema.safeParse({ ...baseline, version: "1.0.0\n" })
        .success,
    ).toBe(false);
    expect(
      baselineIdentitySchema.safeParse({
        ...baseline,
        entrySha256: sha() + "\n",
      }).success,
    ).toBe(false);
    expect(
      revisionTargetSchema.safeParse({ ...target, draftId: uuid(1) + "\n" })
        .success,
    ).toBe(false);
    expect(
      engineIdentitySchema.safeParse({ ...engine, id: "arbitrary-engine" })
        .success,
    ).toBe(false);
  });
  it("keeps receipt facts exactly tied to the three-hash revision and known baseline", async () => {
    const { review } = await fixture();
    expect(await verifyInternalReviewReceipt(review)).toEqual(review);
    for (const field of [
      "canonicalContentSha256",
      "assetSetSha256",
      "canonicalManifestSha256",
    ] as const) {
      const v = structuredClone(review);
      v.facts.target = { ...v.facts.target, [field]: sha("f") };
      expect(internalReviewReceiptSchema.safeParse(v).success).toBe(false);
    }
    expect(
      internalReviewReceiptSchema.safeParse({
        ...review,
        facts: {
          ...review.facts,
          baseline: { ...baseline, entrySha256: sha("a") },
        },
      }).success,
    ).toBe(false);
    await expect(
      verifyInternalReviewReceipt({ ...review, reviewSha256: sha() }),
    ).rejects.toThrow("CONTRACT_MISMATCH");
    await expect(
      verifyInternalReviewReceipt({ ...review, fingerprint: sha() }),
    ).rejects.toThrow("CONTRACT_MISMATCH");
  });
  it("requires exact current-head or strictly later-head evidence, never a lower head", async () => {
    const { review } = await fixture();
    const v = { binding, fingerprint: review.fingerprint };
    expect(
      internalReviewResolutionSchema.safeParse({
        kind: "not-recorded-obsolete",
        ...v,
        observedCurrentRevision: 3,
      }).success,
    ).toBe(true);
    for (const current of [1, 2])
      expect(
        internalReviewResolutionSchema.safeParse({
          kind: "not-recorded-obsolete",
          ...v,
          observedCurrentRevision: current,
        }).success,
      ).toBe(false);
    expect(
      internalReviewResolutionSchema.safeParse({
        kind: "unresolved",
        ...v,
        observedCurrentRevision: 3,
      }).success,
    ).toBe(false);
    expect(
      internalReviewResolutionSchema.safeParse({
        kind: "recorded",
        ...v,
        review: {
          ...review,
          binding: { ...binding, idempotencyKey: uuid(10) },
        },
      }).success,
    ).toBe(false);
  });
  it("accepts a different-key review target consumer but rejects contradictory targets", async () => {
    const { review } = await fixture();
    const consumed = structuredClone(review);
    consumed.binding.idempotencyKey = uuid(11);
    consumed.fingerprint = await recordBaselineFingerprint(consumed.binding);
    const v = {
      kind: "not-recorded-target-used" as const,
      binding,
      fingerprint: review.fingerprint,
      observedCurrentRevision: 2,
      consumed,
    };
    expect(await verifyInternalReviewResolution(v)).toEqual(v);
    expect(
      internalReviewResolutionSchema.safeParse({ ...v, consumed: review })
        .success,
    ).toBe(false);
    const wrong = structuredClone(consumed);
    wrong.binding.target.canonicalManifestSha256 = sha("f");
    wrong.facts.target.canonicalManifestSha256 = sha("f");
    expect(
      internalReviewResolutionSchema.safeParse({ ...v, consumed: wrong })
        .success,
    ).toBe(false);
  });
  it("retains exact snapshot and renderer capability; a digest mismatch is unavailable", async () => {
    const { version, snapshot } = await fixture();
    expect(await verifyInternalVersionDetail({ version, snapshot })).toEqual({
      version,
      snapshot,
    });
    expect(
      internalVersionDetailSchema.safeParse({
        version,
        snapshot: { ...snapshot, reviewId: uuid(20) },
      }).success,
    ).toBe(false);
    expect(
      internalVersionSnapshotSchema.safeParse({
        ...snapshot,
        publicationApproved: true,
      }).success,
    ).toBe(false);
    expect(
      internalVersionSnapshotSchema.safeParse({
        ...snapshot,
        rendererCapability: "persistent-consumer-session",
      }).success,
    ).toBe(false);
    expect(
      internalVersionSnapshotSchema.safeParse({
        ...snapshot,
        engine: { ...engine, id: "dimensions" },
      }).success,
    ).toBe(false);
    const changed = structuredClone(snapshot);
    changed.font.fileSha256 = sha("f");
    await expect(
      verifyInternalVersionDetail({ version, snapshot: changed }),
    ).rejects.toThrow("CONTRACT_MISMATCH");
  });
  it("version target-used binds another key to the same frozen seal tuple and snapshot", async () => {
    const { version, seal } = await fixture();
    const consumed = structuredClone(version);
    consumed.binding.idempotencyKey = uuid(21);
    consumed.fingerprint = await sealInternalVersionFingerprint(
      consumed.binding,
    );
    const v = {
      kind: "not-sealed-target-used" as const,
      binding: seal,
      fingerprint: version.fingerprint,
      observedCurrentRevision: 2,
      snapshotSha256: version.snapshotSha256,
      consumed,
    };
    expect(await verifyInternalVersionResolution(v)).toEqual(v);
    expect(
      internalVersionResolutionSchema.safeParse({ ...v, consumed: version })
        .success,
    ).toBe(false);
    expect(
      internalVersionResolutionSchema.safeParse({
        ...v,
        snapshotSha256: sha("e"),
      }).success,
    ).toBe(false);
    const wrong = structuredClone(consumed);
    wrong.binding.renderer.entrySha256 = sha();
    expect(
      internalVersionResolutionSchema.safeParse({ ...v, consumed: wrong })
        .success,
    ).toBe(false);
  });
  it("capacity proof fixes 100 immutable slots, current exact head and v1 protocol", async () => {
    const { version, seal } = await fixture();
    const v = {
      kind: "not-sealed-capacity-exhausted",
      binding: seal,
      fingerprint: version.fingerprint,
      observedCurrentRevision: 2,
      limit: 100,
      occupiedCount: 100,
    };
    expect(internalVersionResolutionSchema.safeParse(v).success).toBe(true);
    for (const change of [
      { limit: 101 },
      { occupiedCount: 99 },
      { observedCurrentRevision: 3 },
      {
        binding: {
          ...seal,
          schemaVersion: "quizforge.internal-version-seal.v2",
        },
      },
    ])
      expect(
        internalVersionResolutionSchema.safeParse({ ...v, ...change }).success,
      ).toBe(false);
  });
  it("keeps the maximum complete 100-item metadata envelope under its measured budget", async () => {
    const { version } = await fixture();
    const longest = "a".repeat(80),
      semver = "1234567890.1234567890.1234567890";
    const versions = Array.from({ length: 100 }, (_, i) => ({
      id: uuid(i + 100),
      productId: longest,
      slot: 100 - i,
      target: { ...target, revision: 100 },
      reviewId: uuid(3),
      reviewSha256: sha(),
      snapshotSha256: (i + 1).toString(16).padStart(64, "0"),
      renderer: { ...renderer, id: longest, version: semver },
      rendererCapability: "studio-internal-preview",
      engine,
      purpose: "internal-test",
      publicationApproved: false,
      createdAt: version.createdAt,
      createdBy: uuid(4),
    }));
    const v = { ok: true, value: { productId: longest, versions } };
    expect(internalVersionListResponseSchema.safeParse(v).success).toBe(true);
    const bytes = new TextEncoder().encode(JSON.stringify(v)).byteLength;
    expect(bytes).toBeLessThan(L.listResponseBytes);
    expect(
      internalVersionListResponseSchema.safeParse({
        ok: true,
        value: { productId: longest, versions: [...versions, versions[0]] },
      }).success,
    ).toBe(false);
    const wrong = structuredClone(v);
    wrong.value.versions[1]!.slot = 100;
    expect(internalVersionListResponseSchema.safeParse(wrong).success).toBe(
      false,
    );
    const foreign = structuredClone(v);
    foreign.value.versions[1]!.productId = "foreign";
    expect(internalVersionListResponseSchema.safeParse(foreign).success).toBe(
      false,
    );
  });
  it("bounds full operation request identity and rejects path aliases", async () => {
    const { seal } = await fixture();
    expect(
      new TextEncoder().encode(
        JSON.stringify(recordBaselineBindingSchema.parse(binding)),
      ).byteLength,
    ).toBeLessThan(L.requestBytes);
    expect(
      new TextEncoder().encode(
        JSON.stringify(sealInternalVersionBindingSchema.parse(seal)),
      ).byteLength,
    ).toBeLessThan(L.requestBytes);
    expect(internalRevisionParam("100")).toBe(100);
    for (const v of ["0", "01", "1e1", "101", " 1", "1\n"])
      expect(() => internalRevisionParam(v)).toThrow();
    expect(
      internalReviewUrl({
        productId: binding.productId,
        draftId: target.draftId,
        revision: 2,
      }),
    ).toContain("/revisions/2/internal-review");
    expect(() => internalVersionUrl("test-product\n", uuid(2))).toThrow();
  });
});

it("browser protocol canonical bytes equal the server canonicalizer for every persisted identity family", async () => {
  const { review, snapshot, seal } = await fixture();
  for (const value of [binding, seal, review.facts, snapshot]) {
    const text = canonicalOrdinaryJson(value, {
      maxBytes: 65536,
      maxDepth: 32,
    });
    expect(internalCanonicalText(value)).toBe(text);
    expect(await hashInternalText(internalCanonicalText(value))).toBe(
      await hashInternalText(text),
    );
    const reversed = Object.fromEntries(Object.entries(value).reverse());
    expect(internalCanonicalText(reversed)).toBe(text);
  }
  for (const value of [
    { c: '中文\n"\\', b: [-0, true, null, "𠮷"], a: 1 },
    { value: "\ud800" },
    Object.assign(Object.create(null), { z: 1, a: 2 }),
  ])
    expect(internalCanonicalText(value)).toBe(
      canonicalOrdinaryJson(value, { maxBytes: 65536, maxDepth: 32 }),
    );
});
it("new serializer rejects non-JSON values and counts actual UTF-8 before exceeding budgets", () => {
  for (const value of [
    NaN,
    Infinity,
    undefined,
    new Date(),
    [1, , 3],
    { a: undefined },
    Object.defineProperty({}, "x", {
      get() {
        throw Error("ACCESSOR_RAN");
      },
      enumerable: true,
    }),
  ])
    expect(() =>
      canonicalInternalJson(value, { maxBytes: 4096, maxDepth: 32 }),
    ).toThrow(/Canonical JSON rejected/);
  const text = internalCanonicalText({ a: "中" });
  const bytes = new TextEncoder().encode(text).byteLength;
  expect(() => internalCanonicalText({ a: "中" }, bytes - 1)).toThrow();
  expect(internalCanonicalText({ a: "中" }, bytes)).toBe(text);
});
