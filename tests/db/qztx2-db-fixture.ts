import { randomUUID } from "node:crypto";
import { authenticateTestOperator, type TestDatabase } from "./p2a-fixture";
import { prepareQztx2SqlSource } from "./qztx2-source-fixture";
import { seedReadyP2b3Source } from "./p2b3-fixture";
import { createProduct } from "@/features/product/workspace/service";
import { createProductDraftService } from "@/features/product/drafts/service";
import { withStudioWrite } from "@/lib/auth/write";
import { readReadyDraftSourceEvidenceReadonly } from "@/features/quizpack/draft-source-evidence";
import {
  insertReview,
  insertVersion,
  versionById,
  versionDetail,
} from "@/features/product/internal-versions/repository";
import { internalVersionSnapshotV2Schema } from "@/features/product/internal-versions/identity-contracts";
import { persistedReportFixtureV2 } from "@/features/report/persisted/contracts-v2.test-support";
import {
  internalPlaySnapshotV2Schema,
  internalPlayDetailSchema,
  internalPlayBindingText,
  internalPlayBindingSha256,
  internalPlaySnapshotText,
  internalPlaySnapshotSha256,
} from "@/features/product/internal-play/contracts";
import { iso } from "@/features/product/workspace/repository";
import {
  createConsumerToken,
  digestConsumerToken,
} from "@/lib/consumer-contract/v1/credentials";
import {
  issueAccessKeyBindingText,
  issueAccessKeyBindingSha256,
} from "@/features/fulfillment/access/contracts";
import type { DatabaseTime } from "@/lib/auth/internal";
/**
 * Additive SQL integration fixture. It never resets the database or changes an old record.
 * Candidate platform authority and implementation identities are synthetic, without a native/registered-execution claim.
 * Product/draft and later consumer save/recovery use actual application services; review/version/play metadata uses explicit internal fixture ports.
 */
export async function qztx2DbFixture(db: TestDatabase) {
  if (db.config.purpose !== "test")
    throw Error("D2_DEDICATED_TEST_INSTANCE_REQUIRED");
  const productId = "synthetic-d2";
  const [occupied] = await db.admin
    .sql`SELECT EXISTS(SELECT 1 FROM qf.product WHERE id=${productId}) present`;
  if (occupied?.present !== false) throw Error("D2_SQL_FIXTURE_SCOPE_OCCUPIED");
  const auth = await authenticateTestOperator(db, "admin");
  await createProduct(db.app, auth.credentials, {
    id: productId,
    slug: "d2-synthetic-sql",
    title: "D2 synthetic SQL integration",
    primaryCategoryId: null,
    tagIds: [],
  });
  const prepared = await prepareQztx2SqlSource(productId),
    source = await seedReadyP2b3Source(db, auth, prepared, {
      createProduct: false,
    });
  return { ...(await finishQztx2DbFixture(db, { auth, source })), prepared };
}
/** Continue the exact retained ready source after an explicitly reconciled test-fixture interruption. */
export async function finishQztx2DbFixture(
  db: TestDatabase,
  input: {
    auth: Awaited<ReturnType<typeof authenticateTestOperator>>;
    source: Awaited<ReturnType<typeof seedReadyP2b3Source>>;
  },
) {
  const { auth, source } = input,
    productId = source.scope.productId;
  const initial = await createProductDraftService().applyReadyValidation(
    db.app,
    { ...auth.credentials, requestId: randomUUID() },
    source.scope,
    source.input,
  );
  const blueprint = await persistedReportFixtureV2();
  const fixed = await withStudioWrite(
    db.app,
    { ...auth.credentials, requestId: randomUUID() },
    "version:seal-internal",
    async (tx, actor) => {
      const evidence = await readReadyDraftSourceEvidenceReadonly(
        tx,
        source.scope,
        {
          expectedValidationStateRevision:
            source.input.expectedValidationStateRevision,
          expectedCandidateSha256: source.input.expectedCandidateSha256,
        },
      );
      const target = {
        draftId: initial.application.draftId,
        revision: 1,
        canonicalContentSha256: evidence.canonicalContentSha256,
        assetSetSha256: evidence.assetSetSha256,
        canonicalManifestSha256: evidence.canonicalManifestSha256,
      };
      const baseline = {
        kind: "baseline" as const,
        id: "synthetic-d2-sql-metadata",
        version: "1.0.0",
        entrySha256: "a".repeat(64),
      };
      const review = await insertReview(
        tx,
        {
          schemaVersion: "quizforge.review-record.v1",
          productId,
          idempotencyKey: randomUUID(),
          target,
          baseline,
        },
        {
          schemaVersion: "quizforge.internal-review-facts.v1",
          productId,
          target,
          baseline,
          purpose: "internal-test",
          approval: {
            kind: "synthetic-test",
            fixtureId: "d2-sql-metadata-only",
            evidenceSha256: "b".repeat(64),
            scope: "test-evidence-no-author-approval",
          },
        },
        evidence,
        actor,
      );
      const seal = {
        schemaVersion: "quizforge.internal-version-seal.v1" as const,
        productId,
        idempotencyKey: randomUUID(),
        target,
        reviewId: review.id,
        reviewSha256: review.reviewSha256,
        renderer: blueprint.snapshot.play.snapshot.parentSnapshot.renderer,
        engine: blueprint.snapshot.play.snapshot.parentSnapshot.engine,
      };
      const snapshot = internalVersionSnapshotV2Schema.parse({
        ...blueprint.snapshot.play.snapshot.parentSnapshot,
        productId,
        target,
        reviewId: review.id,
        reviewSha256: review.reviewSha256,
        baseline,
        packId: evidence.packId,
        packVersion: evidence.packVersion,
        versions: evidence.versions,
        validation: evidence.validation,
      });
      const receipt = await insertVersion(tx, seal, snapshot, 1, actor),
        row = await versionById(tx, productId, receipt.id);
      if (!row) throw Error("D2_FIXTURE_PARENT_MISSING");
      return { parent: await versionDetail(row), evidence };
    },
  );
  const binding = {
    schemaVersion: "quizforge.internal-play-create.v1" as const,
    operationKey: randomUUID(),
    parent: {
      productId,
      versionId: fixed.parent.version.id,
      snapshotSha256: fixed.parent.version.snapshotSha256,
    },
    renderer: blueprint.snapshot.play.snapshot.renderer,
  };
  const snapshot = internalPlaySnapshotV2Schema.parse({
    ...blueprint.snapshot.play.snapshot,
    parent: binding.parent,
    parentSnapshot: fixed.parent.snapshot,
    resources: JSON.parse(fixed.evidence.assetSetText),
  });
  const playId = randomUUID(),
    bindingText = internalPlayBindingText(binding),
    bindingSha256 = await internalPlayBindingSha256(binding),
    snapshotText = internalPlaySnapshotText(snapshot),
    snapshotSha256 = await internalPlaySnapshotSha256(snapshot);
  const [row] = await db.app
    .sql`INSERT INTO qf.internal_play_version(id,product_id,slot,parent_version_id,parent_snapshot_sha256,operation_key,binding_text,binding_sha256,snapshot_text,snapshot_sha256,created_by,created_at) VALUES(${playId},${productId},1,${binding.parent.versionId},${binding.parent.snapshotSha256},${binding.operationKey},${bindingText},${bindingSha256},${snapshotText},${snapshotSha256},${auth.id},date_trunc('milliseconds',clock_timestamp())) RETURNING created_at`;
  if (!row) throw Error("D2_FIXTURE_PLAY_MISSING");
  const play = internalPlayDetailSchema.parse({
    snapshot,
    play: {
      schemaVersion: "quizforge.internal-play-receipt.v1",
      id: playId,
      slot: 1,
      binding,
      bindingSha256,
      snapshotSha256,
      createdBy: auth.id,
      createdAt: iso(row.created_at as DatabaseTime),
      purpose: "internal-test",
      publicationApproved: false,
    },
  });
  async function issue() {
    const rawKey = createConsumerToken("access-key"),
      credentialDigest = await digestConsumerToken(rawKey, "access-key");
    if (!credentialDigest) throw Error("D2_FIXTURE_KEY_FAILED");
    const issue = {
      schemaVersion: "quizforge.access-key-issue.v1" as const,
      operationKey: randomUUID(),
      keyId: randomUUID(),
      play: {
        productId,
        playVersionId: playId,
        playSnapshotSha256: snapshotSha256,
      },
      credentialDigest,
      validForSeconds: 3600,
    };
    await db.app
      .sql`INSERT INTO qf.access_key(id,product_id,play_version_id,play_snapshot_sha256,credential_digest,issue_operation_key,issue_binding_text,issue_binding_sha256,valid_for_seconds,issued_by,issued_at,expires_at) VALUES(${issue.keyId},${productId},${playId},${snapshotSha256},${credentialDigest},${issue.operationKey},${issueAccessKeyBindingText(issue)},${await issueAccessKeyBindingSha256(issue)},3600,${auth.id},clock_timestamp(),clock_timestamp())`;
    return { rawKey, keyId: issue.keyId };
  }
  return { auth, source, initial, ...fixed, play, issue };
}
