import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, afterEach, expect, it } from "vitest";
import {
  openTestDatabase,
  authenticateTestOperator,
  type TestDatabase,
} from "./p2a-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import { seedReadyP2b3Source } from "./p2b3-fixture";
import { prepareP3eSource } from "./p3e-source-fixture";
import { createProductDraftService } from "@/features/product/drafts/service";
import { createProductDraftRevisionService } from "@/features/product/draft-revisions/service";
import { read } from "@/features/quizpack/import/repository";
import { readReadyDraftSourceEvidenceReadonly } from "@/features/quizpack/draft-source-evidence";
import { matchRegisteredBaseline } from "@/features/product/internal-versions/baseline-registry";
import {
  recordBaselineFingerprintText,
  reviewFactsText,
  internalSnapshotText,
  sealInternalVersionFingerprintText,
  internalVersionSnapshotSchema,
} from "@/features/product/internal-versions/contracts";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { StorageReadGuard } from "@/features/quizpack/resource-read/guard";
import { assertNoRetainedInternalReferences } from "@/features/product/internal-versions/retention";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
let db: TestDatabase,
  auth: Awaited<ReturnType<typeof authenticateTestOperator>>,
  source: Awaited<ReturnType<typeof seedReadyP2b3Source>>,
  initial: Awaited<
    ReturnType<
      ReturnType<typeof createProductDraftService>["applyReadyValidation"]
    >
  >;
beforeAll(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  await resetDomainDatabase(db);
  auth = await authenticateTestOperator(db);
  source = await seedReadyP2b3Source(
    db,
    auth,
    await prepareP3eSource(randomUUID()),
  );
  initial = await createProductDraftService().applyReadyValidation(
    db.app,
    auth.credentials,
    source.scope,
    source.input,
  );
});
afterEach(async () => {
  if (!source || !auth) return;
  // These tests own this exact fresh actor and fixed Product, never an external ledger.
  await db.admin
    .sql`DELETE FROM qf.product_version WHERE product_id=${source.scope.productId} AND created_by=${auth.id}`;
  await db.admin
    .sql`DELETE FROM qf.draft_review WHERE product_id=${source.scope.productId} AND recorded_by=${auth.id}`;
  await resetDomainDatabase(db);
});
afterAll(async () => {
  await db?.close();
});
const proof = () =>
  read(db.app, auth.session.raw, (tx) =>
    readReadyDraftSourceEvidenceReadonly(tx, source.scope, {
      expectedValidationStateRevision:
        source.input.expectedValidationStateRevision,
      expectedCandidateSha256: source.input.expectedCandidateSha256,
    }),
  );
async function reviewData() {
  const p = await proof(),
    baseline = matchRegisteredBaseline(p, db.config.purpose)!;
  const target = {
    draftId: initial.application.draftId,
    revision: 1,
    canonicalContentSha256: p.canonicalContentSha256,
    assetSetSha256: p.assetSetSha256,
    canonicalManifestSha256: p.canonicalManifestSha256,
  };
  const binding = {
    productId: p.productId,
    schemaVersion: "quizforge.review-record.v1" as const,
    idempotencyKey: randomUUID(),
    target,
    baseline: baseline.identity,
  };
  const facts = {
    schemaVersion: "quizforge.internal-review-facts.v1",
    productId: p.productId,
    target,
    baseline: baseline.identity,
    purpose: "internal-test",
    approval: baseline.descriptor.approval,
  };
  return { p, baseline, target, binding, facts, id: randomUUID() };
}
async function insertReview(d: Awaited<ReturnType<typeof reviewData>>) {
  const b = recordBaselineFingerprintText(d.binding),
    f = reviewFactsText(d.facts),
    t = d.target;
  await db.app
    .sql`INSERT INTO qf.draft_review(id,product_id,draft_id,revision,canonical_content_sha256,asset_set_sha256,canonical_manifest_sha256,source_import_id,source_validation_id,source_validation_state_revision,purpose,idempotency_key,binding_text,fingerprint,facts_text,review_sha256,recorded_by,recorded_at) VALUES(${d.id},${d.p.productId},${t.draftId},${t.revision},${t.canonicalContentSha256},${t.assetSetSha256},${t.canonicalManifestSha256},${d.p.sourceImportId},${d.p.sourceValidationId},${d.p.sourceValidationStateRevision},'internal-test',${d.binding.idempotencyKey},${b},${sha(b)},${f},${sha(f)},${auth.id},date_trunc('milliseconds',clock_timestamp()))`;
}
it("returns verified bounded source identities and resources without raw evidence in the port output", async () => {
  const p = await proof();
  expect(p.validation.sourceValidationId).toBe(source.scope.sourceValidationId);
  expect(p.resources).toHaveLength(5);
  expect(new Set(p.resources.map((r) => r.sha256)).size).toBe(5);
  expect(
    p.resources.every(
      (r) => r.storageKey === `blobs/${r.sha256}.blob` && r.frames === 1,
    ),
  ).toBe(true);
  expect(JSON.stringify(p)).not.toContain("evidence_text");
  expect(matchRegisteredBaseline(p, "test")?.descriptor.approval.kind).toBe(
    "synthetic-test",
  );
  expect(matchRegisteredBaseline(p, "demo")).toBeNull();
});
it("matches PostgreSQL canonical JSON against the actual frozen browser/server protocol bytes", async () => {
  const d = await reviewData();
  for (const value of [
    d.binding,
    d.facts,
    {
      text: "中文“原文”\n\\\t\u2028😀",
      count: 100,
      array: [true, null, "a/b"],
    },
  ]) {
    const expected = canonicalOrdinaryJson(value, {
      maxBytes: 65536,
      maxDepth: 32,
    });
    const [r] = await db.app.sql<
      { text: string }[]
    >`SELECT qf.internal_canonical(${JSON.stringify(value)}::text::jsonb) AS text`;
    expect(r?.text).toBe(expected);
  }
});
it("rejects different source/target/column facts even when individual hashes and IDs are well formed", async () => {
  const d = await reviewData();
  await expect(
    insertReview({ ...d, p: { ...d.p, sourceImportId: randomUUID() } }),
  ).rejects.toMatchObject({ code: "23514" });
  const target = { ...d.target, canonicalManifestSha256: "f".repeat(64) };
  await expect(
    insertReview({
      ...d,
      target,
      binding: { ...d.binding, target },
      facts: { ...d.facts, target },
    }),
  ).rejects.toMatchObject({ code: "23503" });
  await insertReview(d);
  await expect(
    insertReview({
      ...d,
      id: randomUUID(),
      binding: { ...d.binding, idempotencyKey: randomUUID() },
    }),
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    db.app
      .sql`UPDATE qf.draft_review SET recorded_by=recorded_by WHERE id=${d.id}`,
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    db.app.sql`DELETE FROM qf.draft_review WHERE id=${d.id}`,
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    db.admin
      .sql`UPDATE qf.draft_review SET recorded_by=recorded_by WHERE id=${d.id}`,
  ).rejects.toMatchObject({ code: "23514" });
});
it("blocks retention even for a same-Product review; its exact own revision is not a blanket exemption", async () => {
  const d = await reviewData();
  await insertReview(d);
  const lock = await StorageLock.acquire(db.config);
  try {
    const scope = {
      revisions: [
        { productId: d.p.productId, draftId: d.target.draftId, revision: 1 },
      ],
      imports: [{ productId: d.p.productId, id: d.p.sourceImportId }],
      validations: [],
      blobSha256: [d.p.resources[0]!.sha256],
    };
    await expect(
      assertNoRetainedInternalReferences(lock, scope),
    ).rejects.toThrow("INTERNAL_VERSION_REFERENCE_RETAINED");
    await db.admin
      .sql`DELETE FROM qf.draft_review WHERE id=${d.id} AND recorded_by=${auth.id}`;
    await assertNoRetainedInternalReferences(lock, scope);
    await expect(
      assertNoRetainedInternalReferences(lock, { ...scope, revisions: [] }),
    ).rejects.toThrow("INTERNAL_VERSION_REFERENCE_RETAINED");
  } finally {
    await lock.close();
  }
});
it("refuses physical maintenance while an outer reader exists, and reference insertion while maintenance owns the lock", async () => {
  const d = await reviewData();
  const guard = await StorageReadGuard.acquire(
    db.config,
    () => {},
    performance.now() + 15000,
  );
  try {
    await expect(StorageLock.acquire(db.config)).rejects.toThrow(
      "RECEIVE_BUSY",
    );
  } finally {
    await guard.close();
  }
  const lock = await StorageLock.acquire(db.config);
  try {
    await expect(insertReview(d)).rejects.toMatchObject({ code: "55P03" });
    // Old first-key replay still precedes maintenance eligibility and takes no FS slot.
    expect(
      await createProductDraftService().applyReadyValidation(
        db.app,
        auth.credentials,
        source.scope,
        source.input,
      ),
    ).toEqual({ ...initial, created: false });
    await expect(
      createProductDraftService().applyReadyValidation(
        db.app,
        auth.credentials,
        source.scope,
        { ...source.input, idempotencyKey: randomUUID() },
      ),
    ).rejects.toThrow("WRITE_BUSY");
    await expect(
      createProductDraftRevisionService().appendReadyValidation(
        db.app,
        auth.credentials,
        source.scope,
        {
          idempotencyKey: randomUUID(),
          expectedValidationStateRevision:
            source.input.expectedValidationStateRevision,
          expectedCandidateSha256: source.input.expectedCandidateSha256,
          target: {
            kind: "append-revision",
            draftId: initial.application.draftId,
            expectedRevision: 1,
            expectedCanonicalContentSha256:
              initial.application.canonicalContentSha256,
            expectedAssetSetSha256: initial.application.assetSetSha256,
          },
        },
      ),
    ).rejects.toThrow("WRITE_BUSY");
  } finally {
    await lock.close();
  }
  await insertReview(d);
});
it("enforces exact review/source snapshot and 100 immutable NOT NULL slots with no 101st version", async () => {
  const d = await reviewData();
  await insertReview(d);
  const reviewSha256 = sha(reviewFactsText(d.facts));
  const renderer = {
      kind: "renderer" as const,
      id: "schema-test-renderer",
      version: "1.0.0",
      entrySha256: "a".repeat(64),
    },
    engine = {
      kind: "engine" as const,
      id: "archetype",
      version: "1.0.0",
      entrySha256: "b".repeat(64),
    };
  // Direct trusted-DB constraint fixture, NOT a registered executable renderer/engine or service success.
  const insert = async (slot: number, change: Record<string, unknown> = {}) => {
    const binding = {
      schemaVersion: "quizforge.internal-version-seal.v1" as const,
      productId: d.p.productId,
      idempotencyKey: randomUUID(),
      target: d.target,
      reviewId: d.id,
      reviewSha256,
      renderer,
      engine,
    };
    const snapshot = internalVersionSnapshotSchema.parse({
      schemaVersion: "quizforge.internal-version-snapshot.v1",
      productId: d.p.productId,
      target: d.target,
      reviewId: d.id,
      reviewSha256,
      baseline: d.baseline.identity,
      purpose: "internal-test",
      publicationApproved: false,
      contentSchemaVersion: d.p.contentSchemaVersion,
      contentKind: d.p.contentKind,
      packId: d.p.packId,
      packVersion: d.p.packVersion,
      versions: d.p.versions,
      logicHash: d.baseline.descriptor.logicHash,
      renderer,
      rendererCapability: "studio-internal-preview",
      components: d.baseline.descriptor.components,
      engine,
      font: {
        id: `synthetic-font-${slot}`,
        version: "1.0.0",
        fileSha256: "c".repeat(64),
        coverageSha256: "d".repeat(64),
        licenseSha256: "e".repeat(64),
        weight: 600,
      },
      validation: { ...d.p.validation, ...change },
    });
    const b = sealInternalVersionFingerprintText(binding),
      s = internalSnapshotText(snapshot),
      t = d.target;
    await db.app
      .sql`INSERT INTO qf.product_version(id,product_id,slot,draft_id,revision,canonical_content_sha256,asset_set_sha256,canonical_manifest_sha256,review_id,review_sha256,purpose,publication_approved,idempotency_key,binding_text,fingerprint,snapshot_text,snapshot_sha256,created_by,created_at) VALUES(${randomUUID()},${d.p.productId},${slot},${t.draftId},1,${t.canonicalContentSha256},${t.assetSetSha256},${t.canonicalManifestSha256},${d.id},${reviewSha256},'internal-test',false,${binding.idempotencyKey},${b},${sha(b)},${s},${sha(s)},${auth.id},date_trunc('milliseconds',clock_timestamp()))`;
  };
  await expect(
    insert(1, { sourceValidationId: randomUUID() }),
  ).rejects.toMatchObject({ code: "23514" });
  for (let slot = 1; slot <= 100; slot++) await insert(slot);
  await expect(insert(101)).rejects.toMatchObject({ code: "23514" });
  await expect(insert(1)).rejects.toMatchObject({ code: "23505" });
  const [count] = await db.app.sql<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM qf.product_version WHERE product_id=${d.p.productId}`;
  expect(count?.n).toBe(100);
});
