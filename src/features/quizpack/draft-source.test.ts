import { randomUUID, createHash } from "node:crypto";
import type postgres from "postgres";
import { expect, it, vi } from "vitest";
import { createSyntheticFixture } from "./v1/fixtures/synthetic";
import { canonicalP1Json } from "./v1/canonical";
import { computeCandidateSha256 } from "./server/validation/candidate-hash";
import {
  ARCHIVE_POLICY_VERSION,
  archivePolicySha256,
} from "./validation/policy";
import { serializeValidationAttempts } from "./validation/repository";
import { readReadyDraftSource } from "./draft-source";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
/** Synthetic SQL projection only. This fixture never certifies executed media, filesystem ACK or actual PG. */
async function sourceFixture() {
  const fixture = await createSyntheticFixture("dimensions");
  const scope = {
    productId: fixture.content.product.productId,
    sourceImportId: randomUUID(),
    sourceValidationId: randomUUID(),
  };
  const attemptId = randomUUID(),
    nonce = "a".repeat(43);
  const controls = serializeValidationAttempts([
    {
      attemptId,
      ordinal: 1,
      fence: 1,
      ownerPid: process.pid,
      ownerNonce: nonce,
      kind: "validate",
      reservationBytes: 134_283_264,
      disposition: "released",
      mediaStop: "confirmed",
      fileStopProof: {
        schemaVersion: "quizpack-validation-file-stop-proof.v1",
        protocol: "candidate-receipt-db-ack.v1",
        validationId: scope.sourceValidationId,
        attemptId,
        fence: 1,
        ownerPid: process.pid,
        ownerNonce: nonce,
        receiptSha256: "f".repeat(64),
        scope: "files-and-media",
        mediaStopped: "confirmed",
        relatedIo: "settled",
      },
    },
  ]);
  const canonicalContentText = canonicalP1Json(fixture.content),
    canonicalManifestText = canonicalP1Json(fixture.manifest, "manifest");
  const resources = [...fixture.content.resources].sort((a, b) =>
    a.id < b.id
      ? -1
      : a.id > b.id
        ? 1
        : a.version < b.version
          ? -1
          : a.version > b.version
            ? 1
            : 0,
  );
  const assetSetText = canonicalP1Json({
    schemaVersion: "quizpack-candidate-asset-set.v1",
    productId: scope.productId,
    resources: resources.map((r) => ({
      productId: r.productId,
      resourceId: r.id,
      resourceVersion: r.version,
      blobSha256: r.sha256,
      declarationSha256: hash(canonicalP1Json(r)),
    })),
  });
  const row = {
    id: scope.sourceValidationId,
    product_id: scope.productId,
    import_id: scope.sourceImportId,
    state_revision: 5,
    status: "ready",
    storage_condition: "clean",
    reserved_bytes: "0",
    lease_until: null,
    attempts_text: controls,
    archive_sha256: "a".repeat(64),
    archive_bytes: 100,
    identity_sha256: "b".repeat(64),
    archive_policy_version: ARCHIVE_POLICY_VERSION,
    archive_policy_sha256: archivePolicySha256,
    canonical_manifest_text: canonicalManifestText,
    canonical_manifest_sha256: hash(canonicalManifestText),
    canonical_content_text: canonicalContentText,
    canonical_content_sha256: hash(canonicalContentText),
    asset_set_text: assetSetText,
    asset_set_sha256: hash(assetSetText),
    candidate_sha256: "",
    container_schema_version: "quizpack.v1",
    content_schema_version: "quizpack-content.v1",
    content_kind: "synthetic",
    pack_id: fixture.manifest.packId,
    pack_version: fixture.manifest.packVersion,
    resource_count: resources.length,
    identity_kind: "canonical",
    ready_at: "2026-10-15T00:00:00.000Z",
  };
  row.candidate_sha256 = computeCandidateSha256({
    archiveSha256: row.archive_sha256,
    identitySha256: row.identity_sha256,
    canonicalManifestSha256: row.canonical_manifest_sha256,
    canonicalContentSha256: row.canonical_content_sha256,
    assetSetSha256: row.asset_set_sha256,
  });
  const original = {
    id: scope.sourceImportId,
    product_id: scope.productId,
    status: "received",
    target_kind: "new-draft",
    actual_archive_sha256: row.archive_sha256,
    actual_archive_bytes: row.archive_bytes,
  };
  const stored = resources.map((r) => ({
    product_id: r.productId,
    resource_id: r.id,
    resource_version: r.version,
    blob_sha256: r.sha256,
    declaration_text: canonicalP1Json(r),
    declaration_sha256: hash(canonicalP1Json(r)),
    purpose: r.purpose,
    platform_approval: "unverified",
    blob_hash: r.sha256,
    blob_bytes: r.bytes,
    media_type: r.mediaType,
    width: r.width,
    height: r.height,
    frames: 1,
    storage_key: `blobs/${r.sha256}.blob`,
  }));
  const expected = {
    expectedValidationStateRevision: 5,
    expectedCandidateSha256: row.candidate_sha256,
  };
  const query = vi
    .fn()
    .mockResolvedValueOnce([original])
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce(stored);
  return {
    row,
    original,
    stored,
    scope,
    expected,
    query,
    tx: query as unknown as postgres.TransactionSql,
  };
}
it("returns exact immutable canonical texts and six versions for a same-Product ready source, including alias", async () => {
  const f = await sourceFixture();
  f.row.identity_kind = "alias";
  const result = await readReadyDraftSource(f.tx, f.scope, f.expected);
  expect(result.canonicalContentText).toBe(f.row.canonical_content_text);
  expect(result.assetSetText).toBe(f.row.asset_set_text);
  expect(result.resourceCount).toBe(f.stored.length);
  expect(Object.isFrozen(result.versions.engine)).toBe(true);
  expect(f.query).toHaveBeenCalledTimes(3);
});
it.each([
  "status",
  "policy",
  "hash-policy",
  "kind",
  "target",
  "foreign-import",
  "held",
  "unconfirmed",
  "no-ack",
  "noncanonical",
  "corrupt-content",
  "candidate-hash",
  "content-bytes",
  "asset-bytes",
])("rejects %s source facts before accepting resources", async (kind) => {
  const f = await sourceFixture();
  if (kind === "status") f.row.status = "archiving";
  if (kind === "policy")
    f.row.archive_policy_version = "quizpack-private-archive.v1";
  if (kind === "hash-policy") f.row.archive_policy_sha256 = "d".repeat(64);
  if (kind === "kind") f.row.content_kind = "authored";
  if (kind === "target") f.original.target_kind = "replace";
  if (kind === "foreign-import") f.original.product_id = "foreign-product";
  if (["held", "unconfirmed", "no-ack"].includes(kind)) {
    const attempts = JSON.parse(f.row.attempts_text);
    if (kind === "held") attempts[0].disposition = "held";
    if (kind === "unconfirmed") attempts[0].mediaStop = "unconfirmed";
    if (kind === "no-ack") attempts[0].fileStopProof = null;
    f.row.attempts_text = canonicalP1Json(attempts);
  }
  if (kind === "content-bytes") {
    f.row.canonical_content_text = "a".repeat(2_097_153);
    f.row.canonical_content_sha256 = hash(f.row.canonical_content_text);
  }
  if (kind === "asset-bytes") {
    f.row.asset_set_text = "a".repeat(65_537);
    f.row.asset_set_sha256 = hash(f.row.asset_set_text);
  }
  if (kind === "noncanonical") {
    f.row.canonical_content_text += " ";
    f.row.canonical_content_sha256 = hash(f.row.canonical_content_text);
  }
  if (kind === "corrupt-content") f.row.canonical_content_text += " ";
  if (kind === "candidate-hash") {
    f.row.candidate_sha256 = "d".repeat(64);
    f.expected.expectedCandidateSha256 = f.row.candidate_sha256;
  }
  await expect(
    readReadyDraftSource(f.tx, f.scope, f.expected),
  ).rejects.toMatchObject({ code: "DRAFT_SOURCE_INVALID" });
});
it.each([
  "missing",
  "duplicate",
  "declaration",
  "license",
  "blob",
  "foreign-product",
])(
  "rejects %s resource ownership even when candidate text and hashes are valid",
  async (kind) => {
    const f = await sourceFixture();
    if (kind === "missing") f.stored.pop();
    if (kind === "duplicate") f.stored[1] = { ...f.stored[0]! };
    if (kind === "declaration")
      f.stored[0]!.declaration_sha256 = "e".repeat(64);
    if (kind === "license") {
      const d = JSON.parse(f.stored[0]!.declaration_text);
      d.license.commercialUse = false;
      f.stored[0]!.declaration_text = canonicalP1Json(d);
      f.stored[0]!.declaration_sha256 = hash(f.stored[0]!.declaration_text);
    }
    if (kind === "blob") f.stored[0]!.width += 1;
    if (kind === "foreign-product") f.stored[0]!.product_id = "other-product";
    await expect(
      readReadyDraftSource(f.tx, f.scope, f.expected),
    ).rejects.toMatchObject({ code: "DRAFT_SOURCE_INVALID" });
  },
);
it("uses a distinct freshness error and never disguises an actual SQL transport failure as invalid source", async () => {
  const f = await sourceFixture();
  await expect(
    readReadyDraftSource(f.tx, f.scope, {
      ...f.expected,
      expectedValidationStateRevision: 4,
    }),
  ).rejects.toMatchObject({ code: "DRAFT_SOURCE_CHANGED", currentRevision: 5 });
  const failure = Object.assign(new Error("SYNTHETIC_TRANSPORT"), {
    code: "08006",
  });
  const query = vi
    .fn()
    .mockRejectedValue(failure) as unknown as postgres.TransactionSql;
  await expect(readReadyDraftSource(query, f.scope, f.expected)).rejects.toBe(
    failure,
  );
});
