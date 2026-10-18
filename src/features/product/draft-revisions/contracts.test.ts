import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  draftApplicationDtoSchema,
  draftSummarySchema,
  draftApplicationFingerprintText,
  type DraftSummaryDto,
} from "../drafts/contracts";
import {
  appendReadyValidationSchema,
  appendDraftApplicationSchema,
  appendDraftFingerprintPayload,
  appendDraftFingerprintText,
  appendDraftFingerprint,
  fingerprintInputFromAppendBinding,
  draftRevisionResolutionSchema,
  draftRevisionHistoryQuerySchema,
  draftRevisionHistorySchema,
  type AppendDraftBinding,
} from "./contracts";
import { errorResponse, StudioError } from "@/lib/http-security/errors";
const productId = "fixture-product",
  draftId = randomUUID();
const sha = (c: string) => c.repeat(64);
function summary(revision = 1): DraftSummaryDto {
  return {
    productId,
    draftId,
    revision,
    applicationId: randomUUID(),
    sourceImportId: randomUUID(),
    sourceValidationId: randomUUID(),
    canonicalContentSha256: sha("a"),
    assetSetSha256: sha("b"),
    canonicalManifestSha256: sha("c"),
    candidateSha256: sha("d"),
    containerSchemaVersion: "quizpack.v1",
    contentSchemaVersion: "quizpack-content.v2",
    contentKind: "synthetic",
    packId: "fixture-pack",
    packVersion: "1.0.0",
    versions: {
      contentVersion: "1.0.0",
      visualVersion: "1.0.0",
      reportVersion: "1.0.0",
      resourceVersion: "1.0.0",
      componentVersion: "2.0.0",
      engine: { id: "archetype", version: "1.0.0" },
    },
    resourceCount: 5,
    createdAt: "2026-10-18T00:00:00.000Z",
    createdBy: randomUUID(),
    platformApproval: "unverified",
    publishable: false,
  };
}
function fixture(expectedRevision = 1) {
  const base = summary(expectedRevision);
  const binding: AppendDraftBinding = {
    productId,
    sourceImportId: randomUUID(),
    sourceValidationId: randomUUID(),
    idempotencyKey: randomUUID(),
    expectedValidationStateRevision: 5,
    expectedCandidateSha256: sha("d"),
    target: {
      kind: "append-revision",
      draftId,
      expectedRevision,
      expectedCanonicalContentSha256: base.canonicalContentSha256,
      expectedAssetSetSha256: base.assetSetSha256,
    },
  };
  const fingerprint = createHash("sha256")
    .update(
      appendDraftFingerprintText(fingerprintInputFromAppendBinding(binding)),
    )
    .digest("hex");
  const application = {
    ...summary(expectedRevision + 1),
    sourceImportId: binding.sourceImportId,
    sourceValidationId: binding.sourceValidationId,
    idempotencyKey: binding.idempotencyKey,
    expectedValidationStateRevision: 5,
    expectedCandidateSha256: binding.expectedCandidateSha256,
    fingerprint,
    target: binding.target,
  };
  return { base, binding, fingerprint, application };
}
it("new browser canonical bytes/digest match the actual canonical builder and bind every source/base fact", async () => {
  const { binding } = fixture();
  const input = fingerprintInputFromAppendBinding(binding);
  const text = canonicalP1Json(appendDraftFingerprintPayload(input));
  expect(appendDraftFingerprintText(input)).toBe(text);
  expect(await appendDraftFingerprint(input)).toBe(
    createHash("sha256").update(text).digest("hex"),
  );
  for (const changed of [
    { ...input, sourceImportId: randomUUID() },
    { ...input, sourceValidationId: randomUUID() },
    { ...input, expectedValidationStateRevision: 6 },
    { ...input, expectedCandidateSha256: sha("e") },
    { ...input, target: { ...input.target, draftId: randomUUID() } },
    { ...input, target: { ...input.target, expectedRevision: 2 } },
    {
      ...input,
      target: { ...input.target, expectedCanonicalContentSha256: sha("e") },
    },
    { ...input, target: { ...input.target, expectedAssetSetSha256: sha("f") } },
  ])
    expect(appendDraftFingerprintText(changed)).not.toBe(text);
  expect(() => appendDraftFingerprintPayload(binding)).toThrow();
});
it("old first fingerprints and receipts retain their v1/literal-one semantics while summaries admit r2", () => {
  const { base, binding } = fixture();
  const oldInput = {
    productId,
    sourceImportId: binding.sourceImportId,
    sourceValidationId: binding.sourceValidationId,
    expectedValidationStateRevision: 5,
    expectedCandidateSha256: sha("d"),
    target: { kind: "new-draft" },
  };
  expect(draftApplicationFingerprintText(oldInput)).toBe(
    JSON.stringify({
      expectedCandidateSha256: sha("d"),
      expectedValidationStateRevision: 5,
      productId,
      schemaVersion: "quizpack-draft-application.v1",
      sourceImportId: binding.sourceImportId,
      sourceValidationId: binding.sourceValidationId,
      target: { kind: "new-draft" },
    }),
  );
  const receipt = {
    ...base,
    idempotencyKey: binding.idempotencyKey,
    expectedValidationStateRevision: 5,
    expectedCandidateSha256: base.candidateSha256,
    fingerprint: sha("f"),
    target: { kind: "new-draft" },
  };
  expect(draftApplicationDtoSchema.safeParse(receipt).success).toBe(true);
  expect(
    draftApplicationDtoSchema.safeParse({ ...receipt, revision: 2 }).success,
  ).toBe(false);
  expect(draftSummarySchema.safeParse({ ...base, revision: 2 }).success).toBe(
    true,
  );
});
it("request base100 is structurally valid; receipts can never produce revision101 or a foreign draft", () => {
  const v = fixture(100);
  const request = {
    idempotencyKey: v.binding.idempotencyKey,
    expectedValidationStateRevision: v.binding.expectedValidationStateRevision,
    expectedCandidateSha256: v.binding.expectedCandidateSha256,
    target: v.binding.target,
  };
  expect(appendReadyValidationSchema.safeParse(request).success).toBe(true);
  expect(appendDraftApplicationSchema.safeParse(v.application).success).toBe(
    false,
  );
  const f = fixture(99);
  expect(appendDraftApplicationSchema.safeParse(f.application).success).toBe(
    true,
  );
  for (const changed of [
    { revision: 99 },
    { draftId: randomUUID() },
    { candidateSha256: sha("e") },
    { target: { ...f.binding.target, expectedRevision: 100 } },
    { authority: true },
  ])
    expect(
      appendDraftApplicationSchema.safeParse({ ...f.application, ...changed })
        .success,
    ).toBe(false);
});
it("an applied observation must match the entire original request, not only the key or latest revision", () => {
  const f = fixture();
  const value = {
    kind: "applied",
    binding: f.binding,
    fingerprint: f.fingerprint,
    application: f.application,
  };
  expect(draftRevisionResolutionSchema.safeParse(value).success).toBe(true);
  for (const binding of [
    { ...f.binding, sourceValidationId: randomUUID() },
    { ...f.binding, expectedValidationStateRevision: 6 },
    {
      ...f.binding,
      target: { ...f.binding.target, expectedAssetSetSha256: sha("c") },
    },
  ])
    expect(
      draftRevisionResolutionSchema.safeParse({ ...value, binding }).success,
    ).toBe(false);
  expect(
    draftRevisionResolutionSchema.safeParse({ ...value, fingerprint: sha("0") })
      .success,
  ).toBe(false);
});
it("obsolete requires the exact immutable base and strictly greater observed current; empty/equal cannot grant release", () => {
  const f = fixture(3);
  const value = {
    kind: "not-applied-obsolete",
    binding: f.binding,
    fingerprint: f.fingerprint,
    base: f.base,
    observedCurrentRevision: 4,
  };
  expect(draftRevisionResolutionSchema.safeParse(value).success).toBe(true);
  for (const changed of [
    { observedCurrentRevision: 3 },
    { observedCurrentRevision: 2 },
    { base: { ...f.base, revision: 2 } },
    { base: { ...f.base, canonicalContentSha256: sha("e") } },
    { base: { ...f.base, assetSetSha256: sha("e") } },
    { base: { ...f.base, draftId: randomUUID() } },
    { kind: "empty" },
  ])
    expect(
      draftRevisionResolutionSchema.safeParse({ ...value, ...changed }).success,
    ).toBe(false);
  expect(
    draftRevisionResolutionSchema.safeParse({
      ...value,
      kind: "unresolved",
      observedCurrentRevision: 3,
    }).success,
  ).toBe(true);
  expect(
    draftRevisionResolutionSchema.safeParse({ ...value, kind: "unresolved" })
      .success,
  ).toBe(false);
});
it("source-used evidence distinguishes an immutable import consumer from a verified manifest consumer", () => {
  const f = fixture(3),
    consumed = { ...summary(1), sourceImportId: f.binding.sourceImportId };
  const proof = {
    reason: "source-import",
    consumed,
    consumingIdempotencyKey: randomUUID(),
  };
  const value = {
    kind: "not-applied-source-used",
    binding: f.binding,
    fingerprint: f.fingerprint,
    base: f.base,
    observedCurrentRevision: 3,
    proof,
  };
  expect(draftRevisionResolutionSchema.safeParse(value).success).toBe(true);
  for (const p of [
    { ...proof, consumingIdempotencyKey: f.binding.idempotencyKey },
    { ...proof, consumed: { ...consumed, sourceImportId: randomUUID() } },
    { ...proof, consumed: { ...consumed, revision: 4 } },
    { ...proof, consumed: { ...consumed, productId: "another-product" } },
  ])
    expect(
      draftRevisionResolutionSchema.safeParse({ ...value, proof: p }).success,
    ).toBe(false);
  const alias = {
    ...proof,
    reason: "canonical-manifest",
    canonicalManifestSha256: consumed.canonicalManifestSha256,
    consumed: { ...consumed, sourceImportId: randomUUID() },
  };
  expect(
    draftRevisionResolutionSchema.safeParse({ ...value, proof: alias }).success,
  ).toBe(true);
  expect(
    draftRevisionResolutionSchema.safeParse({
      ...value,
      proof: { ...alias, canonicalManifestSha256: sha("f") },
    }).success,
  ).toBe(false);
});
it("history anchors, page endpoints and scopes cannot conceal gaps, duplicate rows, or a false last page", () => {
  expect(draftRevisionHistoryQuerySchema.parse({})).toEqual({ pageSize: 20 });
  expect(
    draftRevisionHistoryQuerySchema.safeParse({
      anchorRevision: 100,
      beforeRevision: 101,
      pageSize: 50,
    }).success,
  ).toBe(true);
  for (const q of [
    { beforeRevision: 2 },
    { anchorRevision: 1, beforeRevision: 3 },
    { pageSize: 51 },
    { anchorRevision: 101 },
    { pageSize: 1.5 },
    { cursor: "unknown" },
  ])
    expect(draftRevisionHistoryQuerySchema.safeParse(q).success).toBe(false);
  const value = {
    productId,
    draftId,
    anchorRevision: 3,
    beforeRevision: 4,
    pageSize: 2,
    items: [summary(3), summary(2)],
    nextBeforeRevision: 2,
  };
  expect(draftRevisionHistorySchema.safeParse(value).success).toBe(true);
  expect(
    draftRevisionHistorySchema.safeParse({
      ...value,
      beforeRevision: 2,
      items: [summary(1)],
      nextBeforeRevision: null,
    }).success,
  ).toBe(true);
  for (const changed of [
    { items: [summary(3)] },
    { items: [summary(3), summary(1)] },
    { items: [summary(3), summary(3)] },
    { items: [] },
    { nextBeforeRevision: null },
    { items: [{ ...summary(3), draftId: randomUUID() }, summary(2)] },
  ])
    expect(
      draftRevisionHistorySchema.safeParse({ ...value, ...changed }).success,
    ).toBe(false);
});
it("new finite409 errors do not misuse the old validation currentRevision field", async () => {
  for (const code of [
    "DRAFT_BASE_CONFLICT",
    "DRAFT_SOURCE_ALREADY_APPLIED",
    "DRAFT_REVISION_LIMIT",
  ] as const) {
    const response = errorResponse(new StudioError(code, 7), randomUUID());
    expect(response.status).toBe(409);
    const value = await response.json();
    expect(value.code).toBe(code);
    expect(value).not.toHaveProperty("currentRevision");
  }
});
