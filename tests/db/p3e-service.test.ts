import { constants, type Stats } from "node:fs";
import { open, rename, readFile } from "node:fs/promises";
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
import { StudioError } from "@/lib/http-security/errors";
import * as writes from "@/lib/auth/write";
import * as reads from "@/features/quizpack/import/repository";
import { createProductDraftService } from "@/features/product/drafts/service";
import { createProductDraftRevisionService } from "@/features/product/draft-revisions/service";
import {
  ensureStorage,
  blobPath,
  removeOwned,
} from "@/features/quizpack/import/storage";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { StorageReadGuard } from "@/features/quizpack/resource-read/guard";
import type postgres from "postgres";
import { readReadyDraftSourceEvidenceReadonly } from "@/features/quizpack/draft-source-evidence";
import { buildInternalSnapshot } from "@/features/product/internal-versions/snapshot";
import { ResourceReadTask } from "@/features/quizpack/resource-read/task";
import { createInternalVersionOwner } from "@/features/product/internal-versions/lifecycle";
import { createProductInternalVersionService } from "@/features/product/internal-versions/service";
import {
  assertNoRetainedInternalReferences,
  assertOnlyOwnedInternalReferences,
} from "@/features/product/internal-versions/retention";
import { matchRegisteredBaseline } from "@/features/product/internal-versions/baseline-registry";
import {
  IMPLEMENTATION_DESCRIPTORS,
  implementationIdentity,
} from "@/features/product/internal-versions/implementation-catalog";
import * as executions from "@/features/product/internal-versions/implementation-server";
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
      throw Error("P3E_SERVICE_FIXTURE_UNPROVEN_LEDGER_PRESERVED");
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
it("records the exact synthetic baseline, seals actual private pixels and font bytes, and reads immutable detail/list/state", async () => {
  const review = await record();
  expect(review.created).toBe(true);
  expect(review.review.facts.approval.kind).toBe("synthetic-test");
  const request = sealInput(review.review),
    version = await seal(request);
  expect(version.created).toBe(true);
  expect(version.version.slot).toBe(1);
  const detail = await operation((s, d) =>
    s.readVersion(
      d,
      auth.session.raw,
      source.scope.productId,
      version.version.id,
    ),
  );
  expect(detail.snapshot.logicHash).toBe(
    "97cb6ba14a3f52a47d6834812641d3a790d26833f5889dd94c16037b002ddddf",
  );
  expect(detail.snapshot.validation.sourceValidationId).toBe(
    source.scope.sourceValidationId,
  );
  expect(detail.snapshot.publicationApproved).toBe(false);
  const list = await operation((s, d) =>
    s.readVersions(d, auth.session.raw, source.scope.productId),
  );
  expect(list.versions.map((v) => v.id)).toEqual([version.version.id]);
  const state = await operation((s, d) =>
    s.readReviewState(d, auth.session.raw, scope()),
  );
  expect(state.review).toEqual(review.review);
  expect(state.rendererChoices).toHaveLength(1);
  expect(state.engine).toEqual(request.engine);
  expect(await counts()).toEqual({ reviews: 1, versions: 1, audits: 2 });
});
it("keeps original keys first when all slots are occupied, execution is unavailable and Product is archived", async () => {
  const review = await record(),
    request = sealInput(review.review),
    version = await seal(request);
  await db.admin
    .sql`UPDATE qf.product SET archived_at=clock_timestamp() WHERE id=${source.scope.productId}`;
  const tasks = Array.from({ length: 4 }, () =>
    ResourceReadTask.acquire(new AbortController().signal),
  );
  const streams = await Promise.all(
    tasks.map((t) => t.run(async () => t.body(Buffer.from("synthetic")))),
  );
  vi.spyOn(executions, "resolveRendererServer").mockReturnValue(null);
  vi.spyOn(executions, "resolveEngineImplementation").mockReturnValue(null);
  try {
    expect(await record()).toEqual({ ...review, created: false });
    expect(await seal(request)).toEqual({ ...version, created: false });
  } finally {
    await Promise.all(streams.map((s) => s.cancel()));
  }
  expect(await counts()).toEqual({ reviews: 1, versions: 1, audits: 2 });
});
it("rejects re-bound keys and new duplicate targets, and returns exact permanent target-used observations", async () => {
  const review = await record(),
    request = sealInput(review.review),
    version = await seal(request);
  await expect(
    record({
      ...input,
      baseline: { ...input.baseline, entrySha256: "f".repeat(64) },
    }),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  await expect(
    record({ ...input, idempotencyKey: randomUUID() }),
  ).rejects.toThrow("REVIEW_ALREADY_RECORDED");
  await expect(
    seal({ ...request, idempotencyKey: randomUUID() }),
  ).rejects.toThrow("VERSION_ALREADY_SEALED");
  const a = await operation((s, d) =>
    s.resolveReview(d, auth.session.raw, {
      productId: source.scope.productId,
      ...input,
      idempotencyKey: randomUUID(),
    }),
  );
  expect(a.kind).toBe("not-recorded-target-used");
  const b = await operation((s, d) =>
    s.resolveVersion(d, auth.session.raw, {
      productId: source.scope.productId,
      ...request,
      idempotencyKey: randomUUID(),
    }),
  );
  expect(b.kind).toBe("not-sealed-target-used");
  if (b.kind === "not-sealed-target-used")
    expect(b.consumed.id).toBe(version.version.id);
});
it("history and target-used reconstruction do not require current executable code or font files", async () => {
  const review = await record(),
    request = sealInput(review.review),
    version = await seal(request),
    font = path.join(
      process.cwd(),
      "public",
      IMPLEMENTATION_DESCRIPTORS.renderers[0]!.descriptor.font.file,
    ),
    missing = font + ".p3e-owned-test";
  vi.spyOn(executions, "resolveRendererServer").mockReturnValue(null);
  vi.spyOn(executions, "resolveEngineImplementation").mockReturnValue(null);
  await rename(font, missing);
  try {
    expect(
      (
        await operation((s, d) =>
          s.readVersion(
            d,
            auth.session.raw,
            source.scope.productId,
            version.version.id,
          ),
        )
      ).version.id,
    ).toBe(version.version.id);
    expect(
      (
        await operation((s, d) =>
          s.resolveVersion(d, auth.session.raw, {
            productId: source.scope.productId,
            ...request,
            idempotencyKey: randomUUID(),
          }),
        )
      ).kind,
    ).toBe("not-sealed-target-used");
  } finally {
    await rename(missing, font);
  }
});
it("missing static font or private blob prevents a new seal and writes no version/audit", async () => {
  const review = await record(),
    request = sealInput(review.review),
    font = path.join(
      process.cwd(),
      "public",
      IMPLEMENTATION_DESCRIPTORS.renderers[0]!.descriptor.font.file,
    ),
    fontTemp = font + ".p3e-owned-test";
  await rename(font, fontTemp);
  try {
    await expect(seal(request)).rejects.toThrow(
      "VERSION_DEPENDENCY_UNAVAILABLE",
    );
  } finally {
    await rename(fontTemp, font);
  }
  const image = files[0]!.file,
    temp = image + ".p3e-owned-test";
  await rename(image, temp);
  try {
    await expect(seal(request)).rejects.toThrow("PREVIEW_RESOURCE_UNAVAILABLE");
  } finally {
    await rename(temp, image);
  }
  expect(await counts()).toEqual({ reviews: 1, versions: 0, audits: 1 });
});
it("denies read-only writes and forged CSRF before new resource work", async () => {
  const reader = await authenticateTestOperator(db, "read-only");
  await expect(record(input, reader.credentials)).rejects.toThrow(
    "CAPABILITY_DENIED",
  );
  await expect(
    record(input, { ...auth.credentials, csrfToken: "synthetic-invalid" }),
  ).rejects.toThrow("CSRF_REJECTED");
  expect(await counts()).toEqual({ reviews: 0, versions: 0, audits: 0 });
});
it("fresh authorization after a readonly observation rejects a revoked actor instead of returning the proof", async () => {
  const realRead = reads.read;
  let observations = 0;
  vi.spyOn(reads, "read").mockImplementation(async (...args) => {
    const value = await realRead(...args);
    if (++observations === 1)
      await db.admin
        .sql`UPDATE qf.operator SET status='disabled',disabled_at=clock_timestamp() WHERE id=${auth.id}`;
    return value;
  });
  try {
    await expect(
      operation((s, d) =>
        s.resolveReview(d, auth.session.raw, {
          productId: source.scope.productId,
          ...input,
        }),
      ),
    ).rejects.toThrow("UNAUTHENTICATED");
  } finally {
    await db.admin
      .sql`UPDATE qf.operator SET status='active',disabled_at=NULL WHERE id=${auth.id}`;
  }
});
it("late delivery uncertainty is recovered only by original-key resolve, without duplicate audit", async () => {
  const realWrite = writes.withStudioWrite;
  const spy = vi
    .spyOn(writes, "withStudioWrite")
    .mockImplementation(async (...args) => {
      await realWrite(...args);
      throw new StudioError("WRITE_OUTCOME_UNKNOWN");
    });
  await expect(record()).rejects.toThrow("WRITE_OUTCOME_UNKNOWN");
  spy.mockRestore();
  const resolved = await operation((s, d) =>
    s.resolveReview(d, auth.session.raw, {
      productId: source.scope.productId,
      ...input,
    }),
  );
  expect(resolved.kind).toBe("recorded");
  if (resolved.kind === "recorded") reviewIds.add(resolved.review.id);
  expect((await record()).created).toBe(false);
  expect(await counts()).toEqual({ reviews: 1, versions: 0, audits: 1 });
});
it("real backend termination during the business transaction remains UNKNOWN and original-key resolve stays unresolved", async () => {
  const actual = repository.auditInternalReference;
  const spy = vi
    .spyOn(repository, "auditInternalReference")
    .mockImplementation(async (tx, ...args) => {
      await actual(tx, ...args);
      await tx`SELECT pg_terminate_backend(pg_backend_pid())`;
    });
  await expect(record()).rejects.toThrow("WRITE_OUTCOME_UNKNOWN");
  spy.mockRestore();
  expect(
    (
      await operation((s, d) =>
        s.resolveReview(d, auth.session.raw, {
          productId: source.scope.productId,
          ...input,
        }),
      )
    ).kind,
  ).toBe("unresolved");
  expect(await counts()).toEqual({ reviews: 0, versions: 0, audits: 0 });
});
it("keeps one RR business snapshot while another transaction advances head; the next observation may prove obsolete", async () => {
  const actual = repository.reviewByKey;
  let advanced = false;
  const spy = vi
    .spyOn(repository, "reviewByKey")
    .mockImplementation(async (...args) => {
      const value = await actual(...args);
      if (!advanced) {
        advanced = true;
        const next = await seedReadyP2b3Source(
          db,
          auth,
          await prepareP3eSource(randomUUID(), 2),
          { createProduct: false },
        );
        await createProductDraftRevisionService().appendReadyValidation(
          db.app,
          auth.credentials,
          next.scope,
          {
            idempotencyKey: randomUUID(),
            expectedValidationStateRevision:
              next.input.expectedValidationStateRevision,
            expectedCandidateSha256: next.input.expectedCandidateSha256,
            target: {
              kind: "append-revision",
              draftId: initial.application.draftId,
              expectedRevision: 1,
              expectedCanonicalContentSha256:
                initial.application.canonicalContentSha256,
              expectedAssetSetSha256: initial.application.assetSetSha256,
            },
          },
        );
      }
      return value;
    });
  expect(
    (
      await operation((s, d) =>
        s.resolveReview(d, auth.session.raw, {
          productId: source.scope.productId,
          ...input,
        }),
      )
    ).kind,
  ).toBe("unresolved");
  spy.mockRestore();
  expect(
    (
      await operation((s, d) =>
        s.resolveReview(d, auth.session.raw, {
          productId: source.scope.productId,
          ...input,
        }),
      )
    ).kind,
  ).toBe("not-recorded-obsolete");
  expect((await readFile(files[0]!.file)).length).toBeGreaterThan(0);
});

it("an external immutable ledger blocks actual unlink and retains both original files and DB facts", async () => {
  const review = await record();
  const version = await seal(sealInput(review.review));
  const bytes = await readFile(files[0]!.file),
    before = await counts();
  const lock = await StorageLock.acquire(db.config);
  try {
    const exact = {
      revisions: [
        {
          productId: source.scope.productId,
          draftId: initial.application.draftId,
          revision: 1,
        },
      ],
      imports: [],
      validations: [],
      blobSha256: files.map((f) => path.basename(f.file, ".blob")),
    };
    await assertOnlyOwnedInternalReferences(lock, exact, {
      reviews: [review.review],
      versions: [version.version],
    });
    await expect(
      assertOnlyOwnedInternalReferences(lock, exact, {
        reviews: [review.review],
        versions: [],
      }),
    ).rejects.toThrow("INTERNAL_VERSION_REFERENCE_RETAINED");
    await expect(
      assertOnlyOwnedInternalReferences(lock, exact, {
        reviews: [{ ...review.review, recordedBy: randomUUID() }],
        versions: [version.version],
      }),
    ).rejects.toThrow("INTERNAL_VERSION_REFERENCE_RETAINED");
    await expect(
      (async () => {
        await assertNoRetainedInternalReferences(lock, {
          revisions: [
            {
              productId: source.scope.productId,
              draftId: initial.application.draftId,
              revision: 1,
            },
          ],
          imports: [],
          validations: [],
          blobSha256: files.map((f) => path.basename(f.file, ".blob")),
        });
        for (const file of files) await removeOwned(file.file, file.inode);
      })(),
    ).rejects.toThrow("INTERNAL_VERSION_REFERENCE_RETAINED");
    expect(await readFile(files[0]!.file)).toEqual(bytes);
    expect(await counts()).toEqual(before);
  } finally {
    await lock.close();
  }
});

it("uses the immutable 100-slot facts for capacity proof; a finite VERSION_LIMIT alone grants no proof", async () => {
  const review = await record(),
    request = sealInput(review.review);
  const fixed = await reads.read(db.app, auth.session.raw, async (tx) =>
    buildInternalSnapshot(
      { productId: source.scope.productId, ...request },
      review.review,
      await readReadyDraftSourceEvidenceReadonly(tx, source.scope, {
        expectedValidationStateRevision:
          source.input.expectedValidationStateRevision,
        expectedCandidateSha256: source.input.expectedCandidateSha256,
      }),
    ),
  );
  // Trusted-DB constraint fixture only: these synthetic font identities do NOT register executable implementations.
  await writes.withStudioWrite(
    db.app,
    auth.credentials,
    "version:seal-internal",
    async (tx, actor) => {
      for (let slot = 1; slot <= 100; slot++) {
        const version = await repository.insertVersion(
          tx,
          {
            productId: source.scope.productId,
            ...request,
            idempotencyKey: randomUUID(),
          },
          {
            ...fixed.snapshot,
            font: {
              ...fixed.snapshot.font,
              id: `capacity-fixture-font-${slot}`,
            },
          },
          slot,
          actor,
        );
        versionIds.add(version.id);
      }
    },
  );
  await expect(seal(request)).rejects.toThrow("VERSION_LIMIT");
  const result = await operation((s, d) =>
    s.resolveVersion(d, auth.session.raw, {
      productId: source.scope.productId,
      ...request,
    }),
  );
  expect(result.kind).toBe("not-sealed-capacity-exhausted");
  if (result.kind === "not-sealed-capacity-exhausted")
    expect([
      result.limit,
      result.occupiedCount,
      result.observedCurrentRevision,
    ]).toEqual([100, 100, 1]);
});

it("a real outer-guard disconnect cannot let maintenance cross the transaction/COMMIT window", async () => {
  const acquire = StorageReadGuard.acquire,
    write = writes.withStudioWrite;
  let guard: StorageReadGuard | undefined;
  vi.spyOn(StorageReadGuard, "acquire").mockImplementation(
    async (...args) => (guard = await acquire(...args)),
  );
  const spy = vi
    .spyOn(writes, "withStudioWrite")
    .mockImplementation((database, credentials, capability, callback) =>
      write(database, credentials, capability, async (tx, actor) => {
        const value = await callback(tx, actor);
        // Service has completed its final guard.check; xact SHARE must now bridge through COMMIT.
        const connection = (
          guard as unknown as { connection: postgres.ReservedSql }
        ).connection;
        await Promise.resolve(
          connection`SELECT pg_terminate_backend(pg_backend_pid())`,
        ).catch(() => undefined);
        await guard!.check().catch(() => undefined);
        await expect(StorageLock.acquire(db.config)).rejects.toThrow(
          "RECEIVE_BUSY",
        );
        const [held] = await tx<
          { held: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND mode='ShareLock' AND granted) AS held`;
        expect(held?.held).toBe(true);
        return value;
      }),
    );
  await expect(record()).rejects.toThrow("WRITE_OUTCOME_UNKNOWN");
  spy.mockRestore();
  const resolved = await operation((s, d) =>
    s.resolveReview(d, auth.session.raw, {
      productId: source.scope.productId,
      ...input,
    }),
  );
  expect(resolved.kind).toBe("recorded");
  if (resolved.kind === "recorded") reviewIds.add(resolved.review.id);
  const lock = await StorageLock.acquire(db.config);
  try {
    await lock.check();
  } finally {
    await lock.close();
  }
  expect(await counts()).toEqual({ reviews: 1, versions: 0, audits: 1 });
});
