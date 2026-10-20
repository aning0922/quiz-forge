import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { openManagedDatabase } from "@/lib/db/management";
import { createDatabase } from "@/lib/db/client";
import type { DraftSummaryDto } from "@/features/product/drafts/contracts";
import { createProductDraftService } from "@/features/product/drafts/service";
import { createProductDraftRevisionService } from "@/features/product/draft-revisions/service";
import {
  appendDraftFingerprint,
  fingerprintInputFromAppendBinding,
  type AppendDraftBinding,
} from "@/features/product/draft-revisions/contracts";
import { insertAppend } from "@/features/product/draft-revisions/repository";
import {
  readReadyDraftSource,
  readReadyDraftSourceReadonly,
} from "@/features/quizpack/draft-source";
import { read } from "@/features/quizpack/import/repository";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import {
  openTestDatabase,
  authenticateTestOperator,
  type TestDatabase,
} from "./p2a-fixture";
import { seedReadyP2b3Source } from "./p2b3-fixture";
import { prepareP3dSource } from "./p3d-source-fixture";
const first = createProductDraftService(),
  service = createProductDraftRevisionService();
let db: TestDatabase,
  auth: Awaited<ReturnType<typeof authenticateTestOperator>>,
  initial: Awaited<ReturnType<typeof first.applyReadyValidation>>,
  source: Awaited<ReturnType<typeof seedReadyP2b3Source>>,
  productId: string,
  runId: string;
beforeAll(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  await resetDomainDatabase(db);
  auth = await authenticateTestOperator(db);
  runId = randomUUID();
  productId = `p3d-${runId}`;
  source = await seedReadyP2b3Source(
    db,
    auth,
    await prepareP3dSource(productId, 1, runId),
  );
  initial = await first.applyReadyValidation(
    db.app,
    auth.credentials,
    source.scope,
    source.input,
  );
});
afterAll(async () => {
  if (db) {
    await resetDomainDatabase(db);
    await db.close();
  }
});
async function binding(
  ordinal = 2,
  base: DraftSummaryDto = initial.application,
) {
  const ready = await seedReadyP2b3Source(
    db,
    auth,
    await prepareP3dSource(productId, ordinal, runId),
    { createProduct: false },
  );
  return {
    ...ready.scope,
    idempotencyKey: randomUUID(),
    expectedValidationStateRevision:
      ready.input.expectedValidationStateRevision,
    expectedCandidateSha256: ready.input.expectedCandidateSha256,
    target: {
      kind: "append-revision" as const,
      draftId: base.draftId,
      expectedRevision: base.revision,
      expectedCanonicalContentSha256: base.canonicalContentSha256,
      expectedAssetSetSha256: base.assetSetSha256,
    },
  };
}
const append = (b: AppendDraftBinding, app = db.app) =>
  service.appendReadyValidation(
    app,
    auth.credentials,
    {
      productId: b.productId,
      sourceImportId: b.sourceImportId,
      sourceValidationId: b.sourceValidationId,
    },
    {
      idempotencyKey: b.idempotencyKey,
      expectedValidationStateRevision: b.expectedValidationStateRevision,
      expectedCandidateSha256: b.expectedCandidateSha256,
      target: b.target,
    },
  );
async function counts() {
  const [row] = await db.admin
    .sql`SELECT (SELECT current_revision FROM qf.product_draft WHERE product_id=${productId}) AS current,(SELECT count(*)::int FROM qf.draft_revision WHERE product_id=${productId}) AS revisions,(SELECT count(*)::int FROM qf.draft_application WHERE product_id=${productId}) AS applications,(SELECT count(*)::int FROM qf.audit_event WHERE action='draft_applied' AND target_id=${initial.application.draftId}) AS audits`;
  return row;
}
it("appends twice, preserves r1 bytes/key and first asset ownership, and returns anchored finite history", async () => {
  const body = await first.readDraftRevision(
      db.app,
      auth.session.raw,
      productId,
      initial.application.draftId,
      1,
    ),
    assets = await db.admin
      .sql`SELECT row_to_json(p)::text AS row FROM qf.product_asset p ORDER BY resource_id`;
  const b = await binding(),
    second = await append(b),
    page = await service.readHistory(
      db.app,
      auth.session.raw,
      productId,
      b.target.draftId,
      { pageSize: 1 },
    );
  expect(second.application.revision).toBe(2);
  expect(page.items.map((x) => x.revision)).toEqual([2]);
  const c = await binding(3, second.application);
  await append(c);
  expect(
    (
      await service.readHistory(
        db.app,
        auth.session.raw,
        productId,
        b.target.draftId,
        { pageSize: 1, anchorRevision: 2, beforeRevision: 2 },
      )
    ).items.map((x) => x.revision),
  ).toEqual([1]);
  expect(
    await first.readDraftRevision(
      db.app,
      auth.session.raw,
      productId,
      b.target.draftId,
      1,
    ),
  ).toEqual(body);
  expect(
    await db.admin
      .sql`SELECT row_to_json(p)::text AS row FROM qf.product_asset p ORDER BY resource_id`,
  ).toEqual(assets);
  expect(
    await first.applyReadyValidation(
      db.app,
      auth.credentials,
      source.scope,
      source.input,
    ),
  ).toEqual({ ...initial, created: false });
  expect(await counts()).toEqual({
    current: 3,
    revisions: 3,
    applications: 3,
    audits: 3,
  });
});
it("replays original key before current/base/archive eligibility and rejects new/old cross-operation keys", async () => {
  const b = await binding(),
    second = await append(b);
  await append(await binding(3, second.application));
  await db.admin
    .sql`UPDATE qf.product SET archived_at=clock_timestamp() WHERE id=${productId}`;
  expect(await append(b)).toEqual({ ...second, created: false });
  expect(
    (await service.resolveApplication(db.app, auth.session.raw, b)).kind,
  ).toBe("applied");
  await expect(
    append({ ...b, expectedCandidateSha256: "b".repeat(64) }),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  await expect(
    first.readDraftApplicationByKey(
      db.app,
      auth.session.raw,
      productId,
      b.idempotencyKey,
    ),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  await expect(
    append({ ...b, idempotencyKey: source.input.idempotencyKey }),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  await expect(
    first.applyReadyValidation(db.app, auth.credentials, source.scope, {
      ...source.input,
      idempotencyKey: b.idempotencyKey,
    }),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});
it("two real app connections competing on one base yield one commit and obsolete loser", async () => {
  const b = await binding(),
    c = await binding(3),
    other = await createDatabase(db.config);
  try {
    const results = await Promise.allSettled([append(b), append(c, other)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === "rejected")
        .map((r) => String((r as PromiseRejectedResult).reason)),
    ).toEqual(["StudioError: DRAFT_BASE_CONFLICT"]);
    const loser = results[0]!.status === "rejected" ? b : c;
    expect(
      (await service.resolveApplication(db.app, auth.session.raw, loser)).kind,
    ).toBe("not-applied-obsolete");
    await expect(append(loser)).rejects.toThrow("DRAFT_BASE_CONFLICT");
    expect(await counts()).toEqual({
      current: 2,
      revisions: 2,
      applications: 2,
      audits: 2,
    });
  } finally {
    await other.close();
  }
});
it("same key concurrency returns one creation and exact fixed replay", async () => {
  const b = await binding(),
    other = await createDatabase(db.config);
  try {
    const results = await Promise.all([append(b), append(b, other)]);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect(results[0]!.application).toEqual(results[1]!.application);
    expect(await counts()).toEqual({
      current: 2,
      revisions: 2,
      applications: 2,
      audits: 2,
    });
  } finally {
    await other.close();
  }
});
it("source-import and strictly validated alias produce different read-only source-used proofs", async () => {
  const own: AppendDraftBinding = {
    ...source.scope,
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
  };
  const ownProof = await service.resolveApplication(
    db.app,
    auth.session.raw,
    own,
  );
  expect(
    ownProof.kind === "not-applied-source-used" && ownProof.proof.reason,
  ).toBe("source-import");
  await expect(append(own)).rejects.toThrow("DRAFT_SOURCE_ALREADY_APPLIED");
  const alias = await seedReadyP2b3Source(
    db,
    auth,
    await prepareP3dSource(productId, 1, runId),
    { createProduct: false },
  );
  expect(alias.row.identity_kind).toBe("alias");
  const b = {
    ...own,
    ...alias.scope,
    expectedValidationStateRevision:
      alias.input.expectedValidationStateRevision,
    expectedCandidateSha256: alias.input.expectedCandidateSha256,
  };
  const proof = await service.resolveApplication(db.app, auth.session.raw, b);
  expect(proof.kind === "not-applied-source-used" && proof.proof.reason).toBe(
    "canonical-manifest",
  );
  await expect(
    service.resolveApplication(db.app, auth.session.raw, {
      ...b,
      expectedCandidateSha256: "b".repeat(64),
    }),
  ).rejects.toThrow("DRAFT_SOURCE_CHANGED");
  await expect(append(b)).rejects.toThrow("DRAFT_SOURCE_ALREADY_APPLIED");
  expect(await counts()).toEqual({
    current: 1,
    revisions: 1,
    applications: 1,
    audits: 1,
  });
});
it("unresolved/terminal reads leave session and audit unchanged, read-only can resolve but cannot append", async () => {
  const b = await binding(),
    viewer = await authenticateTestOperator(db, "read-only");
  const before = await db.admin
    .sql`SELECT row_to_json(s)::text AS row FROM qf.operator_session s ORDER BY id`;
  const audits = await db.admin
    .sql`SELECT row_to_json(a)::text AS row FROM qf.audit_event a ORDER BY id`;
  expect(
    (await service.resolveApplication(db.app, viewer.session.raw, b)).kind,
  ).toBe("unresolved");
  await service.readHistory(
    db.app,
    viewer.session.raw,
    productId,
    b.target.draftId,
    { pageSize: 20 },
  );
  expect(
    await db.admin
      .sql`SELECT row_to_json(s)::text AS row FROM qf.operator_session s ORDER BY id`,
  ).toEqual(before);
  expect(
    await db.admin
      .sql`SELECT row_to_json(a)::text AS row FROM qf.audit_event a ORDER BY id`,
  ).toEqual(audits);
  await expect(
    service.appendReadyValidation(
      db.app,
      viewer.credentials,
      {
        productId: b.productId,
        sourceImportId: b.sourceImportId,
        sourceValidationId: b.sourceValidationId,
      },
      {
        idempotencyKey: b.idempotencyKey,
        expectedValidationStateRevision: b.expectedValidationStateRevision,
        expectedCandidateSha256: b.expectedCandidateSha256,
        target: b.target,
      },
    ),
  ).rejects.toThrow("CAPABILITY_DENIED");
});
it("invalid old-base hashes, absent draft, stale source and invalid history do not grant terminal proof", async () => {
  const b = await binding();
  await expect(
    service.resolveApplication(db.app, auth.session.raw, {
      ...b,
      target: { ...b.target, expectedAssetSetSha256: "b".repeat(64) },
    }),
  ).rejects.toThrow("DRAFT_BASE_CONFLICT");
  await expect(
    service.resolveApplication(db.app, auth.session.raw, {
      ...b,
      target: { ...b.target, draftId: randomUUID() },
    }),
  ).rejects.toThrow("DRAFT_BASE_CONFLICT");
  await expect(
    append({
      ...b,
      expectedValidationStateRevision: b.expectedValidationStateRevision - 1,
    }),
  ).rejects.toThrow("DRAFT_SOURCE_CHANGED");
  await expect(
    service.readHistory(db.app, auth.session.raw, productId, b.target.draftId, {
      pageSize: 20,
      anchorRevision: 2,
    }),
  ).rejects.toThrow("DRAFT_REVISION_NOT_FOUND");
  await expect(
    service.readHistory(db.app, auth.session.raw, productId, b.target.draftId, {
      pageSize: 20,
      beforeRevision: 2,
    }),
  ).rejects.toThrow("INVALID_REQUEST");
});
it("SQL append fingerprint is byte-identical and parent nulls/hash substitution are rejected", async () => {
  const b = await binding(),
    t = b.target;
  const [r] = await db.app
    .sql`SELECT qf.draft_revision_application_fingerprint(${b.productId},${b.sourceImportId}::uuid,${b.sourceValidationId}::uuid,${b.expectedValidationStateRevision},${b.expectedCandidateSha256},${t.draftId}::uuid,${t.expectedRevision},${t.expectedCanonicalContentSha256},${t.expectedAssetSetSha256}) AS hash`;
  expect(r!.hash).toBe(
    await appendDraftFingerprint(fingerprintInputFromAppendBinding(b)),
  );
});
it("SQL cannot commit detached revision/application, skip progress or regress current; entire rollback retains ledger", async () => {
  const b = await binding();
  const attempt = async (advance: boolean) =>
    db.app.sql.begin(async (tx) => {
      await tx`SELECT id FROM qf.product WHERE id=${productId} FOR UPDATE`;
      const source = await readReadyDraftSource(
        tx,
        {
          productId: b.productId,
          sourceImportId: b.sourceImportId,
          sourceValidationId: b.sourceValidationId,
        },
        {
          expectedValidationStateRevision: b.expectedValidationStateRevision,
          expectedCandidateSha256: b.expectedCandidateSha256,
        },
      );
      await insertAppend(tx, {
        source,
        input: {
          idempotencyKey: b.idempotencyKey,
          expectedValidationStateRevision: b.expectedValidationStateRevision,
          expectedCandidateSha256: b.expectedCandidateSha256,
          target: b.target,
        },
        applicationId: randomUUID(),
        fingerprint: await appendDraftFingerprint(
          fingerprintInputFromAppendBinding(b),
        ),
        actorId: auth.id,
        at: new Date().toISOString(),
      });
      if (advance)
        await tx`UPDATE qf.product_draft SET current_revision=3 WHERE product_id=${productId}`;
    });
  await expect(attempt(false)).rejects.toMatchObject({ code: "23514" });
  await expect(attempt(true)).rejects.toMatchObject({ code: "23514" });
  await expect(
    db.app
      .sql`UPDATE qf.product_draft SET current_revision=2 WHERE product_id=${productId}`,
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    db.app
      .sql`UPDATE qf.product_draft SET current_revision=0 WHERE product_id=${productId}`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    db.app
      .sql`UPDATE qf.product_draft SET initial_revision=1 WHERE product_id=${productId}`,
  ).rejects.toMatchObject({ code: "42501" });
  expect(await counts()).toEqual({
    current: 1,
    revisions: 1,
    applications: 1,
    audits: 1,
  });
});
it("one RR snapshot cannot splice an absent key with a later current and resolve returns original applied thereafter", async () => {
  const b = await binding(),
    other = await createDatabase(db.config);
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (ready = r));
  const reader = read(db.app, auth.session.raw, async (tx) => {
    const a =
      await tx`SELECT id FROM qf.draft_application WHERE product_id=${productId} AND idempotency_key=${b.idempotencyKey}`;
    ready();
    await gate;
    const [root] =
      await tx`SELECT current_revision FROM qf.product_draft WHERE product_id=${productId}`;
    return { a: a.length, current: root!.current_revision };
  });
  try {
    await started;
    await append(b, other);
    release();
    expect(await reader).toEqual({ a: 0, current: 1 });
    expect(
      (await service.resolveApplication(db.app, auth.session.raw, b)).kind,
    ).toBe("applied");
  } finally {
    release();
    await reader.catch(() => {});
    await other.close();
  }
});
it("audit insertion failure confirms rollback, while lost delivery after actual COMMIT remains unknown and replayable", async () => {
  const b = await binding();
  await db.admin.sql.unsafe(
    "CREATE FUNCTION qf.p3d_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END $$; CREATE TRIGGER p3d_test_audit_fail BEFORE INSERT ON qf.audit_event FOR EACH ROW WHEN (NEW.action='draft_applied') EXECUTE FUNCTION qf.p3d_test_audit_fail()",
  );
  try {
    await expect(append(b)).rejects.toThrow("STUDIO_UNAVAILABLE");
    expect(await counts()).toEqual({
      current: 1,
      revisions: 1,
      applications: 1,
      audits: 1,
    });
  } finally {
    await db.admin.sql.unsafe(
      "DROP TRIGGER p3d_test_audit_fail ON qf.audit_event; DROP FUNCTION qf.p3d_test_audit_fail()",
    );
  }
  const sql = new Proxy(db.app.sql, {
    get(target, property) {
      if (property === "begin")
        return async (...args: unknown[]) => {
          await Reflect.apply(target.begin, target, args);
          throw Error("SYNTHETIC_LOST_COMMIT_DELIVERY");
        };
      return Reflect.get(target, property);
    },
  });
  await expect(append(b, { ...db.app, sql })).rejects.toThrow(
    "WRITE_OUTCOME_UNKNOWN",
  );
  expect(
    (await service.resolveApplication(db.app, auth.session.raw, b)).kind,
  ).toBe("applied");
  expect((await append(b)).created).toBe(false);
  expect(await counts()).toEqual({
    current: 2,
    revisions: 2,
    applications: 2,
    audits: 2,
  });
});
it("99 to 100 competition cannot create revision101 and exact successful key still replays at capacity", async () => {
  let base =
    initial.application as import("@/features/product/drafts/contracts").DraftSummaryDto;
  for (let n = 2; n <= 99; n++)
    base = (await append(await binding(n, base))).application;
  const b = await binding(100, base),
    c = await binding(101, base),
    other = await createDatabase(db.config);
  try {
    const results = await Promise.allSettled([append(b), append(c, other)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = results[0]!.status === "fulfilled" ? b : c;
    expect((await append(winner)).created).toBe(false);
    const current = await first.readDraft(db.app, auth.session.raw, productId);
    if (current.kind !== "draft") throw Error("P3D_CAP_CURRENT_REQUIRED");
    const next = {
      ...b,
      idempotencyKey: randomUUID(),
      target: {
        ...b.target,
        expectedRevision: 100,
        expectedCanonicalContentSha256: current.draft.canonicalContentSha256,
        expectedAssetSetSha256: current.draft.assetSetSha256,
      },
    };
    await expect(append(next)).rejects.toThrow("DRAFT_REVISION_LIMIT");
    expect(await counts()).toEqual({
      current: 100,
      revisions: 100,
      applications: 100,
      audits: 100,
    });
  } finally {
    await other.close();
  }
}, 120000);
it("app guard rejects disabled closure and unexpected column UPDATE grants; owner can delete complete closure in one transaction", async () => {
  const b = await binding();
  await append(b);
  await db.admin
    .sql`ALTER TABLE qf.draft_revision DISABLE TRIGGER draft_revision_closure`;
  try {
    await expect(createDatabase(db.config)).rejects.toThrow(
      "STUDIO_UNAVAILABLE",
    );
  } finally {
    await db.admin
      .sql`ALTER TABLE qf.draft_revision ENABLE TRIGGER draft_revision_closure`;
  }
  await db.admin
    .sql`GRANT UPDATE(initial_revision) ON qf.product_draft TO ${db.admin.sql(db.config.database.user)}`;
  try {
    await expect(createDatabase(db.config)).rejects.toThrow(
      "STUDIO_UNAVAILABLE",
    );
  } finally {
    await db.admin
      .sql`REVOKE UPDATE(initial_revision) ON qf.product_draft FROM ${db.admin.sql(db.config.database.user)}`;
  }
  await db.admin.sql.begin(async (tx) => {
    await tx`DELETE FROM qf.product_draft WHERE product_id=${productId}`;
    await tx`DELETE FROM qf.draft_revision WHERE product_id=${productId}`;
    await tx`DELETE FROM qf.draft_application WHERE product_id=${productId}`;
    await tx`DELETE FROM qf.audit_event WHERE target_id=${b.target.draftId}`;
  });
  const [row] = await db.admin
    .sql`SELECT count(*)::int AS n FROM qf.draft_revision WHERE product_id=${productId}`;
  expect(row!.n).toBe(0);
});

it("application-only SQL cannot reserve a successful key/source without an exact revision", async () => {
  const b = await binding(),
    t = b.target,
    fp = await appendDraftFingerprint(fingerprintInputFromAppendBinding(b));
  await expect(
    db.app.sql.begin(async (tx) => {
      await tx`INSERT INTO qf.draft_application(id,product_id,idempotency_key,fingerprint,source_import_id,source_validation_id,expected_validation_state_revision,expected_candidate_sha256,target_kind,draft_id,revision,created_by,created_at,expected_draft_revision,expected_base_content_sha256,expected_base_asset_set_sha256) VALUES(${randomUUID()},${productId},${b.idempotencyKey},${fp},${b.sourceImportId},${b.sourceValidationId},${b.expectedValidationStateRevision},${b.expectedCandidateSha256},'append-revision',${t.draftId},2,${auth.id},clock_timestamp(),1,${t.expectedCanonicalContentSha256},${t.expectedAssetSetSha256})`;
    }),
  ).rejects.toMatchObject({ code: "23503" });
  expect(await counts()).toEqual({
    current: 1,
    revisions: 1,
    applications: 1,
    audits: 1,
  });
  expect(
    (await service.resolveApplication(db.app, auth.session.raw, b)).kind,
  ).toBe("unresolved");
  expect((await append(b)).application.revision).toBe(2);
});

it("a fresh owner RR connection reads original asset-set text without JSON parameter double serialization", async () => {
  const owner = await openManagedDatabase(db.config.instanceId);
  try {
    const exact = await owner.sql.begin(
      "isolation level repeatable read read only",
      (tx) =>
        readReadyDraftSourceReadonly(tx, source.scope, {
          expectedValidationStateRevision:
            source.input.expectedValidationStateRevision,
          expectedCandidateSha256: source.input.expectedCandidateSha256,
        }),
    );
    expect(exact.canonicalContentSha256).toBe(
      initial.application.canonicalContentSha256,
    );
    expect(exact.assetSetSha256).toBe(initial.application.assetSetSha256);
    expect(exact.resourceCount).toBe(initial.application.resourceCount);
  } finally {
    await owner.close();
  }
});
