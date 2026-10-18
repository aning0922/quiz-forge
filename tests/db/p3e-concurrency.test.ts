import { constants, type Stats } from "node:fs";
import { open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  expect,
  it,
  vi,
} from "vitest";
import {
  openTestDatabase,
  authenticateTestOperator,
  type TestDatabase,
} from "./p2a-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import { prepareP3eSource } from "./p3e-source-fixture";
import { seedReadyP2b3Source } from "./p2b3-fixture";
import {
  createDatabase,
  type DatabaseBudget,
  type P2aDatabase,
} from "@/lib/db/client";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { createProductDraftService } from "@/features/product/drafts/service";
import {
  ensureStorage,
  blobPath,
  removeOwned,
} from "@/features/quizpack/import/storage";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { createInternalVersionOwner } from "@/features/product/internal-versions/lifecycle";
import { createProductInternalVersionService } from "@/features/product/internal-versions/service";
import { assertNoRetainedInternalReferences } from "@/features/product/internal-versions/retention";
import { matchRegisteredBaseline } from "@/features/product/internal-versions/baseline-registry";
import {
  IMPLEMENTATION_DESCRIPTORS,
  implementationIdentity,
} from "@/features/product/internal-versions/implementation-catalog";
import * as repository from "@/features/product/internal-versions/repository";
import {
  rendererIdentitySchema,
  engineIdentitySchema,
  type RecordBaselineInput,
  type SealInternalVersionInput,
  type InternalReviewReceipt,
} from "@/features/product/internal-versions/contracts";
import type { ProductInternalVersionService } from "@/features/product/internal-versions/service-contract";

let db: TestDatabase,
  auth: Awaited<ReturnType<typeof authenticateTestOperator>>,
  source: Awaited<ReturnType<typeof seedReadyP2b3Source>>,
  initial: Awaited<
    ReturnType<
      ReturnType<typeof createProductDraftService>["applyReadyValidation"]
    >
  >,
  input: RecordBaselineInput;
let ready = false;
const reviewIds = new Set<string>(),
  versionIds = new Set<string>();
const files: { file: string; inode: Stats }[] = [];
beforeAll(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  ready = false;
  files.length = 0;
  reviewIds.clear();
  versionIds.clear();
  await resetDomainDatabase(db);
  auth = await authenticateTestOperator(db);
  const prepared = await prepareP3eSource(randomUUID());
  source = await seedReadyP2b3Source(db, auth, prepared);
  initial = await createProductDraftService().applyReadyValidation(
    db.app,
    auth.credentials,
    source.scope,
    source.input,
  );
  const baseline = matchRegisteredBaseline(
    {
      productId: source.scope.productId,
      canonicalContentSha256: prepared.candidate.facts.canonicalContentSha256,
      assetSetSha256: prepared.candidate.facts.assetSetSha256,
      canonicalManifestSha256: prepared.candidate.facts.canonicalManifestSha256,
    },
    db.config.purpose,
  )!;
  input = {
    schemaVersion: "quizforge.review-record.v1",
    idempotencyKey: randomUUID(),
    target: {
      draftId: initial.application.draftId,
      revision: 1,
      canonicalContentSha256: initial.application.canonicalContentSha256,
      assetSetSha256: initial.application.assetSetSha256,
      canonicalManifestSha256: initial.application.canonicalManifestSha256,
    },
    baseline: baseline.identity,
  };
  const lock = await StorageLock.acquire(db.config);
  try {
    await ensureStorage(db.config);
    for (const blob of prepared.blobs) {
      const asset = prepared.assetFiles.find(
        (a) =>
          a.bytes.length === blob.bytes &&
          prepared.candidate.facts.resources.some(
            (r) =>
              r.blobSha256 === blob.sha256 && r.declaration.path === a.path,
          ),
      )!;
      const file = blobPath(db.config, blob.sha256),
        h = await open(
          file,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
      try {
        await h.writeFile(asset.bytes);
        await h.sync();
        files.push({ file, inode: await h.stat() });
      } finally {
        await h.close();
      }
    }
  } finally {
    await lock.close();
  }
  ready = true;
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (!ready) return;
  const lock = await StorageLock.acquire(db.config);
  try {
    const [foreign] = await db.admin.sql<
      { present: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM qf.draft_review WHERE product_id=${source.scope.productId} AND (recorded_by<>${auth.id} OR id<>ALL(${db.admin.sql.array([...reviewIds])}::uuid[]))) OR EXISTS(SELECT 1 FROM qf.product_version WHERE product_id=${source.scope.productId} AND (created_by<>${auth.id} OR id<>ALL(${db.admin.sql.array([...versionIds])}::uuid[]))) AS present`;
    if (foreign?.present !== false)
      throw Error("P3E_CONCURRENCY_FIXTURE_UNPROVEN_LEDGER_PRESERVED");
    await db.admin
      .sql`DELETE FROM qf.product_version WHERE id=ANY(${db.admin.sql.array([...versionIds])}::uuid[]) AND created_by=${auth.id}`;
    await db.admin
      .sql`DELETE FROM qf.draft_review WHERE id=ANY(${db.admin.sql.array([...reviewIds])}::uuid[]) AND recorded_by=${auth.id}`;
    const revisions = await db.admin.sql<
      { productId: string; draftId: string; revision: number }[]
    >`SELECT product_id AS "productId",draft_id AS "draftId",revision FROM qf.draft_revision WHERE product_id=${source.scope.productId} AND created_by=${auth.id}`;
    await assertNoRetainedInternalReferences(lock, {
      revisions,
      imports: [],
      validations: [],
      blobSha256: files.map((f) => path.basename(f.file, ".blob")),
    });
    for (const f of files) await removeOwned(f.file, f.inode);
  } finally {
    await lock.close();
  }
  await resetDomainDatabase(db);
});
afterAll(async () => {
  await db?.close();
});
const scope = () => ({
  productId: source.scope.productId,
  draftId: initial.application.draftId,
  revision: 1,
});
async function operation<T>(
  work: (
    s: ProductInternalVersionService,
    d: P2aDatabase,
    b: DatabaseBudget,
  ) => Promise<T>,
) {
  const clock = createStudioRequestBudget(new AbortController().signal),
    connection = await createDatabase(db.config, clock.budget),
    owner = createInternalVersionOwner(connection, clock);
  try {
    return await work(
      createProductInternalVersionService(owner),
      connection,
      clock.budget,
    );
  } finally {
    await owner.closeIfNotTransferred();
  }
}
async function record(value = input, credentials = auth.credentials) {
  const result = await operation((s, d, b) =>
    s.recordBaseline(d, credentials, scope(), value, b),
  );
  reviewIds.add(result.review.id);
  return result;
}
function sealInput(review: InternalReviewReceipt): SealInternalVersionInput {
  return {
    schemaVersion: "quizforge.internal-version-seal.v1",
    idempotencyKey: randomUUID(),
    target: input.target,
    reviewId: review.id,
    reviewSha256: review.reviewSha256,
    renderer: rendererIdentitySchema.parse(
      implementationIdentity(IMPLEMENTATION_DESCRIPTORS.renderers[0]!),
    ),
    engine: engineIdentitySchema.parse(
      implementationIdentity(
        IMPLEMENTATION_DESCRIPTORS.engines.find(
          (e) => e.descriptor.id === "archetype",
        )!,
      ),
    ),
  };
}
async function seal(value: SealInternalVersionInput) {
  const result = await operation((s, d, b) =>
    s.sealInternalVersion(
      d,
      auth.credentials,
      source.scope.productId,
      value,
      b,
    ),
  );
  versionIds.add(result.version.id);
  return result;
}
async function counts() {
  const [r] = await db.admin.sql<
    { reviews: number; versions: number; audits: number }[]
  >`SELECT (SELECT count(*)::int FROM qf.draft_review) AS reviews,(SELECT count(*)::int FROM qf.product_version) AS versions,(SELECT count(*)::int FROM qf.audit_event WHERE action::text IN ('draft_baseline_recorded','internal_version_sealed')) AS audits`;
  return r;
}
it("concurrent real new keys converge on one review and one sealed version with exact loser proofs", async () => {
  let arrived = 0,
    release = () => {};
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalReview = repository.reviewByKey;
  vi.spyOn(repository, "reviewByKey").mockImplementation(async (...args) => {
    const value = await originalReview(...args);
    if (arrived < 2) {
      arrived++;
      if (arrived === 2) release();
      await gate;
    }
    return value;
  });
  const inputs = [input, { ...input, idempotencyKey: randomUUID() }];
  const attempts = await Promise.allSettled(
    inputs.map((value) => record(value)),
  );
  expect(arrived).toBe(2);
  vi.restoreAllMocks();
  for (const r of attempts)
    if (r.status === "rejected")
      expect(["WRITE_BUSY", "REVIEW_ALREADY_RECORDED"]).toContain(
        r.reason.code,
      );
  const recorded = attempts.filter((r) => r.status === "fulfilled");
  expect(recorded).toHaveLength(1);
  const winner = recorded[0]!;
  if (winner.status !== "fulfilled") throw Error("REVIEW_WINNER_EXPECTED");
  expect(winner.value.created).toBe(true);
  const lostIndex = attempts.findIndex((r) => r.status === "rejected");
  const reviewProof = await operation((s, d) =>
    s.resolveReview(d, auth.session.raw, {
      productId: source.scope.productId,
      ...inputs[lostIndex]!,
    }),
  );
  expect(reviewProof.kind).toBe("not-recorded-target-used");
  const requests = [
    sealInput(winner.value.review),
    sealInput(winner.value.review),
  ];
  arrived = 0;
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalVersion = repository.versionByKey;
  vi.spyOn(repository, "versionByKey").mockImplementation(async (...args) => {
    const value = await originalVersion(...args);
    if (arrived < 2) {
      arrived++;
      if (arrived === 2) release();
      await gate;
    }
    return value;
  });
  const sealed = await Promise.allSettled(requests.map((value) => seal(value)));
  expect(arrived).toBe(2);
  vi.restoreAllMocks();
  for (const r of sealed)
    if (r.status === "rejected")
      expect(["WRITE_BUSY", "VERSION_ALREADY_SEALED"]).toContain(r.reason.code);
  expect(sealed.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const failed = sealed.findIndex((r) => r.status === "rejected");
  const proof = await operation((s, d) =>
    s.resolveVersion(d, auth.session.raw, {
      productId: source.scope.productId,
      ...requests[failed]!,
    }),
  );
  expect(proof.kind).toBe("not-sealed-target-used");
  expect(await counts()).toEqual({ reviews: 1, versions: 1, audits: 2 });
});
