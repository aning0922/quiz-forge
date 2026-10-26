import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { afterEach, expect, it, vi } from "vitest";
import type { P2aDatabase } from "@/lib/db/client";
import * as writes from "@/lib/auth/write";
import { verifiedActor } from "@/lib/auth/capabilities";
import * as reads from "@/features/quizpack/import/repository";
import * as catalog from "../workspace/repository";
import * as sources from "@/features/quizpack/draft-source";
import * as repository from "./repository";
import {
  draftApplicationFingerprint,
  type DraftApplicationDto,
} from "./contracts";
import { StudioError } from "@/lib/http-security/errors";
import { createProductDraftService } from "./service";
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const productId = "synthetic-product",
    sourceImportId = randomUUID(),
    sourceValidationId = randomUUID();
  const scope = { productId, sourceImportId, sourceValidationId };
  const input = {
    idempotencyKey: randomUUID(),
    expectedValidationStateRevision: 5,
    expectedCandidateSha256: "a".repeat(64),
    target: { kind: "new-draft" as const },
  };
  const fingerprint = await draftApplicationFingerprint({
    ...scope,
    expectedValidationStateRevision: input.expectedValidationStateRevision,
    expectedCandidateSha256: input.expectedCandidateSha256,
    target: input.target,
  });
  const actor = verifiedActor({
    id: randomUUID(),
    loginName: "synthetic-test",
    displayName: "Synthetic test",
    accountRevision: 1,
    role: "operator",
    sessionId: randomUUID(),
    idleExpiresAt: new Date("2026-10-16"),
    absoluteExpiresAt: new Date("2026-10-16"),
  });
  const versions = {
    contentVersion: "1.0.0",
    visualVersion: "1.0.0",
    reportVersion: "1.0.0",
    resourceVersion: "1.0.0",
    componentVersion: "1.0.0",
    engine: { id: "dimensions" as const, version: "1.0.0" as const },
  };
  const source: sources.ReadyDraftSource = {
    ...scope,
    sourceValidationStateRevision: 5,
    canonicalContentText: "{}",
    canonicalContentSha256: "b".repeat(64),
    assetSetText: "{}",
    assetSetSha256: "c".repeat(64),
    canonicalManifestSha256: "d".repeat(64),
    candidateSha256: input.expectedCandidateSha256,
    containerSchemaVersion: "quizpack.v1",
    contentSchemaVersion: "quizpack-content.v1",
    contentKind: "synthetic",
    packId: "synthetic-pack",
    packVersion: "1.0.0",
    resourceCount: 4,
    versions,
  };
  const application: DraftApplicationDto = {
    ...scope,
    draftId: randomUUID(),
    revision: 1,
    applicationId: randomUUID(),
    canonicalContentSha256: source.canonicalContentSha256,
    assetSetSha256: source.assetSetSha256,
    canonicalManifestSha256: source.canonicalManifestSha256,
    candidateSha256: source.candidateSha256,
    containerSchemaVersion: source.containerSchemaVersion,
    contentSchemaVersion: source.contentSchemaVersion,
    contentKind: source.contentKind,
    packId: source.packId,
    packVersion: source.packVersion,
    versions,
    resourceCount: 4,
    createdAt: "2026-10-15T00:00:00.000Z",
    createdBy: actor.id,
    platformApproval: "unverified",
    publishable: false,
    ...input,
    fingerprint,
  };
  const tx = vi
    .fn()
    .mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join("").includes("pg_try_advisory_xact_lock_shared")
        ? [{ locked: true }]
        : [{ at: application.createdAt }],
    ) as unknown as postgres.TransactionSql;
  const db = {} as P2aDatabase;
  const credentials = {
    sessionToken: null,
    csrfToken: null,
    requestId: randomUUID(),
  };
  const write = vi
    .spyOn(writes, "withStudioWrite")
    .mockImplementation(async (_db, _c, capability, work) => {
      expect(capability).toBe("draft:write");
      return work(tx, actor);
    });
  vi.spyOn(reads, "read").mockImplementation(async (_db, _token, work) =>
    work(tx, actor),
  );
  const product = { id: productId, archived_at: null } as catalog.ProductRow;
  vi.spyOn(catalog, "productRow").mockResolvedValue(product);
  const sourceRead = vi
    .spyOn(sources, "readReadyDraftSource")
    .mockResolvedValue(source);
  const keyRead = vi
    .spyOn(repository, "applicationByKey")
    .mockResolvedValue(null);
  const rootRead = vi.spyOn(repository, "draftRoot").mockResolvedValue(null);
  const insert = vi.spyOn(repository, "insertFirstDraft").mockResolvedValue();
  const audit = vi.spyOn(repository, "auditDraftApplied").mockResolvedValue();
  vi.spyOn(repository, "applicationDto").mockReturnValue(application);
  const service = createProductDraftService();
  return {
    scope,
    input,
    fingerprint,
    actor,
    source,
    application,
    tx,
    db,
    credentials,
    write,
    product,
    sourceRead,
    keyRead,
    rootRead,
    insert,
    audit,
    service,
  };
}
it("same-key replay precedes archived/source checks and produces no insert or second audit", async () => {
  const f = await setup();
  f.product.archived_at = f.application.createdAt;
  f.keyRead.mockResolvedValue({
    target_kind: "new-draft",
    fingerprint: f.fingerprint,
  } as repository.ApplicationRow);
  const result = await f.service.applyReadyValidation(
    f.db,
    f.credentials,
    f.scope,
    f.input,
  );
  expect(result).toEqual({ created: false, application: f.application });
  expect(f.sourceRead).not.toHaveBeenCalled();
  expect(f.rootRead).not.toHaveBeenCalled();
  expect(f.insert).not.toHaveBeenCalled();
  expect(f.audit).not.toHaveBeenCalled();
  expect(f.tx).not.toHaveBeenCalled();
});
it("same-key different fingerprint refuses before source IO or new business writes", async () => {
  const f = await setup();
  f.keyRead.mockResolvedValue({
    target_kind: "new-draft",
    fingerprint: "f".repeat(64),
  } as repository.ApplicationRow);
  await expect(
    f.service.applyReadyValidation(f.db, f.credentials, f.scope, f.input),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(f.sourceRead).not.toHaveBeenCalled();
  expect(f.insert).not.toHaveBeenCalled();
});
it("a confirmed new result is built inside the one transaction, with immutable source facts and one audit", async () => {
  const f = await setup();
  const result = await f.service.applyReadyValidation(
    f.db,
    f.credentials,
    f.scope,
    f.input,
  );
  expect(result.created).toBe(true);
  expect(result.application.sourceValidationId).toBe(
    f.scope.sourceValidationId,
  );
  expect(result.application.versions).toEqual(f.source.versions);
  expect(f.insert).toHaveBeenCalledOnce();
  expect(f.audit).toHaveBeenCalledOnce();
  expect(f.keyRead).toHaveBeenCalledOnce();
  expect(f.insert.mock.invocationCallOrder[0]).toBeLessThan(
    f.audit.mock.invocationCallOrder[0]!,
  );
});
it("unknown COMMIT propagates without a post-commit read or implicit re-execution", async () => {
  const f = await setup();
  f.write.mockImplementation(async (_db, _c, _capability, work) => {
    await work(f.tx, f.actor);
    throw new StudioError("WRITE_OUTCOME_UNKNOWN");
  });
  await expect(
    f.service.applyReadyValidation(f.db, f.credentials, f.scope, f.input),
  ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
  expect(f.insert).toHaveBeenCalledOnce();
  expect(f.audit).toHaveBeenCalledOnce();
  expect(f.keyRead).toHaveBeenCalledOnce();
});
it("an existing draft or invalid source never yields a second first revision", async () => {
  const f = await setup();
  f.rootRead.mockResolvedValue({ id: randomUUID() } as repository.DraftRootRow);
  await expect(
    f.service.applyReadyValidation(f.db, f.credentials, f.scope, f.input),
  ).rejects.toMatchObject({ code: "DRAFT_ALREADY_EXISTS" });
  expect(f.insert).not.toHaveBeenCalled();
  expect(f.audit).not.toHaveBeenCalled();
});
it("fixed revision reads query the requested identity and never follow the current pointer", async () => {
  const f = await setup();
  const body = vi.spyOn(repository, "revisionBody").mockResolvedValue(null);
  const draftId = randomUUID();
  await expect(
    f.service.readDraftRevision(f.db, null, f.scope.productId, draftId, 2),
  ).rejects.toMatchObject({ code: "DRAFT_REVISION_NOT_FOUND" });
  expect(body).toHaveBeenCalledWith(f.tx, f.scope.productId, draftId, 2);
  expect(f.rootRead).not.toHaveBeenCalled();
  expect(f.sourceRead).not.toHaveBeenCalled();
});
