import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  applyReadyValidationSchema,
  draftApplicationFingerprint,
  draftApplicationFingerprintPayload,
  draftApplicationFingerprintText,
  draftRevisionDtoSchema,
  DRAFT_LIMITS,
} from "./contracts";

const input = {
  productId: "synthetic-product",
  sourceImportId: randomUUID(),
  sourceValidationId: randomUUID(),
  expectedValidationStateRevision: 5,
  expectedCandidateSha256: "a".repeat(64),
  target: { kind: "new-draft" as const },
};
it("browser-safe fingerprint text and WebCrypto digest equal the frozen canonical server formula", async () => {
  const canonical = canonicalP1Json(draftApplicationFingerprintPayload(input));
  expect(draftApplicationFingerprintText(input)).toBe(canonical);
  expect(await draftApplicationFingerprint(input)).toBe(
    createHash("sha256").update(canonical, "utf8").digest("hex"),
  );
  expect(
    await draftApplicationFingerprint({ ...input, productId: "other-product" }),
  ).not.toBe(await draftApplicationFingerprint(input));
});
it("request rejects unknown fields, unsupported targets, fractional/overflow revisions and non-P1 IDs", () => {
  const request = {
    idempotencyKey: randomUUID(),
    expectedValidationStateRevision: 5,
    expectedCandidateSha256: "a".repeat(64),
    target: { kind: "new-draft" },
  };
  expect(applyReadyValidationSchema.safeParse(request).success).toBe(true);
  for (const changed of [
    { code: "unexpected" },
    { target: { kind: "replace" } },
    { expectedValidationStateRevision: 2_147_483_648 },
    { expectedValidationStateRevision: 1.5 },
    { expectedCandidateSha256: "A".repeat(64) },
  ])
    expect(
      applyReadyValidationSchema.safeParse({ ...request, ...changed }).success,
    ).toBe(false);
  expect(() =>
    draftApplicationFingerprintPayload({
      ...input,
      idempotencyKey: randomUUID(),
    }),
  ).toThrow();
  expect(() =>
    draftApplicationFingerprintPayload({ ...input, productId: "UPPER" }),
  ).toThrow();
});
it("revision DTO admits only the two bounded raw texts and an explicit strict summary", () => {
  const version = "1.0.0";
  const summary = {
    productId: input.productId,
    draftId: randomUUID(),
    revision: 1,
    applicationId: randomUUID(),
    sourceImportId: input.sourceImportId,
    sourceValidationId: input.sourceValidationId,
    canonicalContentSha256: "a".repeat(64),
    assetSetSha256: "b".repeat(64),
    canonicalManifestSha256: "c".repeat(64),
    candidateSha256: input.expectedCandidateSha256,
    containerSchemaVersion: "quizpack.v1",
    contentSchemaVersion: "quizpack-content.v1",
    contentKind: "synthetic",
    packId: "synthetic-pack",
    packVersion: version,
    versions: {
      contentVersion: version,
      visualVersion: version,
      reportVersion: version,
      resourceVersion: version,
      componentVersion: version,
      engine: { id: "dimensions", version },
    },
    resourceCount: 4,
    createdAt: "2026-10-15T00:00:00.000Z",
    createdBy: randomUUID(),
    platformApproval: "unverified",
    publishable: false,
  };
  const valid = {
    draft: summary,
    canonicalContentText: JSON.stringify({ text: "a".repeat(1_048_576) }),
    assetSetText: "{}",
  };
  expect(draftRevisionDtoSchema.safeParse(valid).success).toBe(true);
  for (const changed of [
    { canonicalContentText: "a".repeat(DRAFT_LIMITS.contentBytes + 1) },
    { canonicalContentText: JSON.stringify({ text: "中".repeat(700_000) }) },
    { assetSetText: "a".repeat(DRAFT_LIMITS.assetSetBytes + 1) },
    { canonicalContentText: "{\n}" },
    { canonicalManifestText: "{}" },
  ])
    expect(
      draftRevisionDtoSchema.safeParse({ ...valid, ...changed }).success,
    ).toBe(false);
  expect(
    draftRevisionDtoSchema.safeParse({
      canonicalContentText: "{}",
      assetSetText: "{}",
    }).success,
  ).toBe(false);
});
