import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { configureImports } from "@/features/quizpack/import/config-management";
import { createQuizpackValidationService } from "@/features/quizpack/validation/service";
import { serviceRequest } from "./p2b2b-service-support";
import { createProductDraftService } from "@/features/product/drafts/service";
import {
  validationRowDto,
  legacyValidationActivity,
  parseValidationAttempts,
} from "@/features/quizpack/validation/repository";
import {
  retryValidationClaim,
  recoverValidationClaim,
  acknowledgeValidationFileStop,
  interruptValidation,
} from "@/features/quizpack/validation/transactions";
import {
  openTestDatabase,
  authenticateTestOperator,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import {
  resetDomainDatabase,
  syntheticFileStopProof,
} from "./p2b2b-domain-fixture";
import { prepareP2b3Source, seedReadyP2b3Source } from "./p2b3-fixture";
import {
  historicalTransaction,
  seedLegacySource,
  seedLegacyDraft,
} from "./p3b-history-fixture";

let db: TestDatabase;
let originalImportsEnabled: boolean;
let auth: Awaited<ReturnType<typeof authenticateTestOperator>>;
const service = createProductDraftService();
beforeAll(async () => {
  db = await openTestDatabase();
  originalImportsEnabled = db.config.imports.enabled;
  await db.close();
  await configureImports(db.config.instanceId, false);
  db = await openTestDatabase();
});
beforeEach(async () => {
  await resetDomainDatabase(db);
  auth = await authenticateTestOperator(db);
});
afterAll(async () => {
  if (db) {
    try {
      await resetDomainDatabase(db);
    } finally {
      await db.close();
      await configureImports(db.config.instanceId, originalImportsEnabled);
    }
  }
});
it("old ready remains a read-only fact and cannot authorize a new application, retry, recovery or ACK", async () => {
  const p = await prepareP2b3Source(`history-${randomUUID()}`, {
    legacy: true,
  });
  const old = await historicalTransaction(db, (tx) =>
    seedLegacySource(tx, auth, p),
  );
  const before = JSON.stringify(
    await safe(
      () =>
        db.admin
          .sql`SELECT row_to_json(v)::text AS row FROM qf.quizpack_validation v WHERE id=${old.row.id}`,
    ),
  );
  const dto = await db.app.sql.begin((tx) => validationRowDto(tx, old.row));
  expect(dto.status).toBe("ready");
  expect(dto.readOnly).toBe(true);
  // Real old row + actual authorization/SQL, with imports disabled in this test
  // instance. These calls must reject policy before consulting that configuration.
  expect(db.config.imports.enabled).toBe(false);
  const validations = createQuizpackValidationService();
  for (const method of ["recoverValidation", "retryValidation"] as const)
    await expect(
      serviceRequest(db, (connection, context) =>
        validations[method](
          connection,
          auth.credentials,
          old.scope.productId,
          old.scope.sourceImportId,
          old.row.id,
          { expectedStateRevision: old.row.state_revision },
          context,
        ),
      ),
    ).rejects.toThrow("VALIDATION_REVALIDATION_REQUIRED");
  const activity = await db.app.sql.begin((tx) => legacyValidationActivity(tx));
  expect(activity).toHaveLength(1);
  expect(Object.keys(activity[0]!).sort()).toEqual(
    [
      "status",
      "storage_condition",
      "reserved_bytes",
      "lease_until",
      "attempts_text",
      "archive_policy_version",
    ].sort(),
  );
  expect(activity[0]).toMatchObject({
    status: "ready",
    storage_condition: "clean",
    reserved_bytes: "0",
    lease_until: null,
    attempts_text: old.row.attempts_text,
    archive_policy_version: "quizpack-private-archive.v2",
  });

  await expect(
    service.applyReadyValidation(
      db.app,
      auth.credentials,
      old.scope,
      old.input,
    ),
  ).rejects.toThrow("DRAFT_SOURCE_INVALID");
  const scope = {
    productId: old.scope.productId,
    importId: old.scope.sourceImportId,
  };
  const authority = {
    validationId: old.row.id,
    expectedStateRevision: old.row.state_revision,
    fence: old.row.fence,
    attemptId: old.row.current_attempt_id,
  };
  await expect(
    retryValidationClaim(db.app, auth.credentials, scope, old.row.id, {
      expectedStateRevision: old.row.state_revision,
      binding: old.binding,
      owner: p.owner,
    }),
  ).rejects.toThrow("VALIDATION_REVALIDATION_REQUIRED");
  await expect(
    acknowledgeValidationFileStop(db.app, auth.credentials, scope, {
      authority,
      proof: syntheticFileStopProof(old.row, "confirmed"),
    }),
  ).rejects.toThrow("VALIDATION_REVALIDATION_REQUIRED");
  // Ready recovery is an unchanged durable-completion read, not authority for a new write.
  expect(
    await recoverValidationClaim(db.app, auth.credentials, scope, {
      authority,
      settledAttempts: [],
      storageCondition: "clean",
      accountedBytes: 0,
      errorCode: null,
    }),
  ).toMatchObject({
    id: old.row.id,
    status: old.row.status,
    state_revision: old.row.state_revision,
    attempts_text: old.row.attempts_text,
  });
  expect(
    JSON.stringify(
      await safe(
        () =>
          db.admin
            .sql`SELECT row_to_json(v)::text AS row FROM qf.quizpack_validation v WHERE id=${old.row.id}`,
      ),
    ),
  ).toBe(before);
  expect(
    await service.readDraft(db.app, auth.session.raw, p.productId),
  ).toEqual({ kind: "empty", productId: p.productId });
});
it("original successful application key replays its immutable legacy receipt and exact historical body even after archival", async () => {
  const p = await prepareP2b3Source(`history-${randomUUID()}`, {
    legacy: true,
  });
  const { old, draftId } = await historicalTransaction(db, async (tx) => {
    const old = await seedLegacySource(tx, auth, p);
    return { old, draftId: await seedLegacyDraft(tx, auth, p, old) };
  });
  const first = await service.readDraftApplicationByKey(
    db.app,
    auth.session.raw,
    p.productId,
    old.input.idempotencyKey,
  );
  expect(first.kind).toBe("applied");
  const replay = await service.applyReadyValidation(
    db.app,
    auth.credentials,
    old.scope,
    old.input,
  );
  expect(replay.created).toBe(false);
  if (first.kind !== "applied") throw Error("HISTORICAL_RECEIPT_REQUIRED");
  expect(replay.application).toEqual(first.application);
  const revision = await service.readDraftRevision(
    db.app,
    auth.session.raw,
    p.productId,
    draftId,
    1,
  );
  expect(revision.canonicalContentText).toBe(
    p.candidate.facts.canonicalContentText,
  );
  expect(revision.assetSetText).toBe(p.candidate.facts.assetSetText);
  expect(revision.draft.contentSchemaVersion).toBe("quizpack-content.v1");
  await safe(
    () =>
      db.admin
        .sql`UPDATE qf.product SET archived_at=clock_timestamp(),metadata_revision=metadata_revision+1,updated_at=clock_timestamp() WHERE id=${p.productId}`,
  );
  expect(
    await service.applyReadyValidation(
      db.app,
      auth.credentials,
      old.scope,
      old.input,
    ),
  ).toEqual(replay);
  await expect(
    service.applyReadyValidation(
      db.app,
      auth.credentials,
      { ...old.scope, sourceValidationId: randomUUID() },
      old.input,
    ),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  const [counts] = await safe(
    () =>
      db.admin.sql<
        { drafts: number; revisions: number; applications: number }[]
      >`SELECT (SELECT count(*)::int FROM qf.product_draft) drafts,(SELECT count(*)::int FROM qf.draft_revision) revisions,(SELECT count(*)::int FROM qf.draft_application) applications`,
  );
  expect(counts).toEqual({ drafts: 1, revisions: 1, applications: 1 });
});
it.each(["ready", "validated"] as const)(
  "same received bytes revalidate an old %s canonical as a new alias with its own identity, evidence and ACK",
  async (mode) => {
    const productId = `history-${randomUUID()}`,
      oldP = await prepareP2b3Source(productId, { legacy: true });
    const old = await historicalTransaction(db, (tx) =>
      seedLegacySource(tx, auth, oldP, mode),
    );
    const currentP = await prepareP2b3Source(productId);
    const next = await seedReadyP2b3Source(db, auth, currentP, {
      createProduct: false,
      importId: old.scope.sourceImportId,
    });
    expect(next.row.identity_kind).toBe("alias");
    expect(next.row.canonical_validation_id).toBe(old.row.id);
    expect(next.row.id).not.toBe(old.row.id);
    expect(next.row.validation_key).not.toBe(old.row.validation_key);
    expect(next.row.identity_text).not.toBe(old.row.identity_text);
    expect(next.row.evidence_text).not.toBe(old.row.evidence_text);
    expect(next.row.candidate_sha256).not.toBe(old.row.candidate_sha256);
    const proof = parseValidationAttempts(next.row.attempts_text)[0]!
      .fileStopProof;
    expect(proof?.validationId).toBe(next.row.id);
    expect(proof?.validationId).not.toBe(old.row.id);
    const assets = await safe(
      () =>
        db.admin
          .sql`SELECT source_validation_id,declaration_text FROM qf.product_asset WHERE product_id=${productId}`,
    );
    expect(assets).toHaveLength(4);
    // A static validated canonical has no archived resources; only ready history owns reusable assets.
    expect(
      assets.every(
        (a) =>
          a.source_validation_id ===
          (mode === "ready" ? old.row.id : next.row.id),
      ),
    ).toBe(true);
    const applied = await service.applyReadyValidation(
      db.app,
      auth.credentials,
      next.scope,
      next.input,
    );
    expect(applied.created).toBe(true);
    expect(applied.application.sourceValidationId).toBe(next.row.id);
    const stored = await safe(
      () =>
        db.admin
          .sql`SELECT status,attempts_text,identity_text,evidence_text FROM qf.quizpack_validation WHERE id=${old.row.id}`,
    );
    expect(stored[0]).toEqual({
      status: old.row.status,
      attempts_text: old.row.attempts_text,
      identity_text: old.row.identity_text,
      evidence_text: old.row.evidence_text,
    });
  },
);
it("20 clean released historical failures consume total rows but no current pending slots", async () => {
  const productId = `history-${randomUUID()}`,
    p = await prepareP2b3Source(productId, { legacy: true });
  const old = await historicalTransaction(db, async (tx) => {
    let first: Awaited<ReturnType<typeof seedLegacySource>> | undefined;
    for (let i = 0; i < 20; i++) {
      const row = await seedLegacySource(tx, auth, p, "retryable-failed");
      first ??= row;
    }
    return first!;
  });
  const current = await seedReadyP2b3Source(
    db,
    auth,
    await prepareP2b3Source(productId),
    { createProduct: false, importId: old.scope.sourceImportId },
  );
  expect(current.row.status).toBe("ready");
  const [counts] = await safe(
    () =>
      db.admin.sql<
        { historical: number; total: number }[]
      >`SELECT count(*) FILTER(WHERE archive_policy_version='quizpack-private-archive.v2')::int historical,count(*)::int total FROM qf.quizpack_validation`,
  );
  expect(counts).toEqual({ historical: 20, total: 21 });
});

it("1023 historical rows allow one new validation, then 1024 total blocks new keys while exact historical replay still works", async () => {
  const productId = `history-${randomUUID()}`,
    legacy = await prepareP2b3Source(productId, { legacy: true });
  const first = await historicalTransaction(db, async (tx) => {
    let first: Awaited<ReturnType<typeof seedLegacySource>> | undefined;
    for (let n = 0; n < 1023; n++) {
      const old = await seedLegacySource(tx, auth, legacy, "retryable-failed");
      first ??= old;
    }
    return first!;
  });
  const p = await prepareP2b3Source(productId);
  const next = await seedReadyP2b3Source(db, auth, p, {
    createProduct: false,
    importId: first.scope.sourceImportId,
  });
  expect(next.row.status).toBe("ready");
  await expect(
    seedReadyP2b3Source(db, auth, p, { createProduct: false }),
  ).rejects.toThrow("VALIDATION_SCAN_LIMIT");
  const { claimValidation } =
    await import("@/features/quizpack/validation/transactions");
  const replay = await claimValidation(
    db.app,
    auth.credentials,
    { productId, importId: first.scope.sourceImportId },
    {
      expectedImportStateRevision: 123,
      expectedValidationKey: first.binding.validationKey,
      binding: first.binding,
      owner: legacy.owner,
    },
  );
  expect(replay.created).toBe(false);
  expect(replay.row.id).toBe(first.row.id);
  expect(replay.row.status).toBe("retryable-failed");
  expect(replay.row.attempts_text).toBe(first.row.attempts_text);
  const [count] = await safe(
    () =>
      db.admin.sql<
        { total: number }[]
      >`SELECT count(*)::int total FROM qf.quizpack_validation`,
  );
  expect(count?.total).toBe(1024);
}, 60000);

it("a different archive SHA under the same legacy pack/version is rejected, without reassigning the canonical or resource source", async () => {
  const productId = `history-${randomUUID()}`,
    legacy = await prepareP2b3Source(productId, { legacy: true });
  const old = await historicalTransaction(db, (tx) =>
    seedLegacySource(tx, auth, legacy),
  );
  const changed = await prepareP2b3Source(productId, {
    archiveLabel: "Explicit different no-file synthetic archive",
  });
  await expect(
    seedReadyP2b3Source(db, auth, changed, { createProduct: false }),
  ).rejects.toThrow("VALIDATION_STATE_CONFLICT");
  const [conflict] = await safe(
    () =>
      db.admin.sql<
        import("@/features/quizpack/validation/repository").ValidationRow[]
      >`SELECT * FROM qf.quizpack_validation WHERE product_id=${productId} AND archive_sha256=${changed.archiveSha256}`,
  );
  if (!conflict) throw Error("SYNTHETIC_CONFLICT_REQUIRED");
  expect(conflict).toMatchObject({
    status: "rejected",
    identity_kind: "conflict",
    last_error_code: "PACK_IDENTITY_CONFLICT",
    pack_id: old.row.pack_id,
    pack_version: old.row.pack_version,
  });
  const scope = { productId, importId: conflict.import_id };
  const authority = (r: typeof conflict) => ({
    validationId: r.id,
    expectedStateRevision: r.state_revision,
    fence: r.fence,
    attemptId: r.current_attempt_id,
  });
  const acknowledged = await acknowledgeValidationFileStop(
    db.app,
    auth.credentials,
    scope,
    {
      authority: authority(conflict),
      proof: syntheticFileStopProof(conflict, "confirmed"),
    },
  );
  const a = parseValidationAttempts(acknowledged.attempts_text)[0]!;
  if (!a.fileStopProof) throw Error("SYNTHETIC_CONFLICT_ACK_REQUIRED");
  const released = await interruptValidation(db.app, auth.credentials, scope, {
    authority: authority(acknowledged),
    settledAttempts: [
      {
        attemptId: a.attemptId,
        mediaStop: "confirmed",
        fileStopProof: a.fileStopProof,
      },
    ],
    storageCondition: "clean",
    accountedBytes: 0,
    errorCode: "PACK_IDENTITY_CONFLICT",
  });
  expect(released).toMatchObject({
    status: "rejected",
    reserved_bytes: "0",
    storage_condition: "clean",
  });
  const canonical = await safe(
    () =>
      db.admin
        .sql`SELECT id FROM qf.quizpack_validation WHERE product_id=${productId} AND identity_kind='canonical'`,
  );
  expect(canonical).toEqual([{ id: old.row.id }]);
  const assets = await safe(
    () =>
      db.admin
        .sql`SELECT source_validation_id FROM qf.product_asset WHERE product_id=${productId}`,
  );
  expect(assets).toHaveLength(4);
  expect(assets.every((a) => a.source_validation_id === old.row.id)).toBe(true);
  await expect(
    service.applyReadyValidation(
      db.app,
      auth.credentials,
      {
        productId,
        sourceImportId: conflict.import_id,
        sourceValidationId: conflict.id,
      },
      {
        ...old.input,
        expectedValidationStateRevision: released.state_revision,
        expectedCandidateSha256: released.candidate_sha256!,
      },
    ),
  ).rejects.toThrow("DRAFT_SOURCE_INVALID");
});

it("historical fixture rejects demo purpose before entering the owner transaction", async () => {
  let entered = false;
  await expect(
    historicalTransaction(
      { ...db, config: { ...db.config, purpose: "demo" } },
      async () => {
        entered = true;
      },
    ),
  ).rejects.toThrow("P3B_PURPOSE_TEST_REQUIRED");
  expect(entered).toBe(false);
  // The original managed test/ci connection and configuration remain untouched.
  const [row] = await safe(
    () => db.app.sql<{ alive: number }[]>`SELECT 1::int AS alive`,
  );
  expect(row?.alive).toBe(1);
});
