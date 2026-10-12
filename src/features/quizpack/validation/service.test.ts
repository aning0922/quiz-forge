import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { P2aDatabase } from "@/lib/db/client";
import { StudioError } from "@/lib/http-security/errors";
import { canonicalP1Json } from "../v1/canonical";
import { runtimeIdentity } from "../server/validation/identity";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  requestMediaOperationStop,
  type MediaOperationContext,
} from "../server/media";
const mocks = vi.hoisted(() => ({
  product: vi.fn(),
  original: vi.fn(),
  exact: vi.fn(),
  row: vi.fn(),
  dto: vi.fn(),
  config: vi.fn(),
  acquire: vi.fn(),
  scan: vi.fn(),
  held: vi.fn(),
  prepare: vi.fn(),
  raw: vi.fn(),
  archive: vi.fn(),
  candidate: vi.fn(),
  restore: vi.fn(),
  receipt: vi.fn(),
  publication: vi.fn(),
  ack: vi.fn(),
  append: vi.fn(),
  interrupt: vi.fn(),
  claim: vi.fn(),
  recover: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@/features/product/workspace/repository", async (actual) => ({
  ...(await actual<typeof import("@/features/product/workspace/repository")>()),
  productRow: mocks.product,
}));
vi.mock("../import/repository", async (actual) => ({
  ...(await actual<typeof import("../import/repository")>()),
  importRow: mocks.original,
  read: (_db: unknown, _token: unknown, work: (tx: unknown) => unknown) =>
    work({}),
}));
vi.mock("../import/service", () => ({ currentConfig: mocks.config }));
vi.mock("../import/storage-lock", () => ({
  StorageLock: { acquire: mocks.acquire },
}));
vi.mock("../import/storage", async (actual) => ({
  ...(await actual<typeof import("../import/storage")>()),
  scanStorage: mocks.scan,
  assertNoConfigGuard: async () => {},
}));
vi.mock("./storage-ledger", () => ({ readHeldStorageRows: mocks.held }));
vi.mock("./repository", async (actual) => ({
  ...(await actual<typeof import("./repository")>()),
  exactValidation: mocks.exact,
  validationRow: mocks.row,
  validationRowDto: mocks.dto,
  validationDto: (row: ValidationRow) => ({ id: row.id, status: row.status }),
  archivedResourceCount: async () => 0,
}));
vi.mock("../server/validation", async (actual) => ({
  ...(await actual<typeof import("../server/validation")>()),
  prepareValidationIdentity: mocks.prepare,
  validateArchiveCandidate: mocks.candidate,
  restoreValidatedCandidate: mocks.restore,
}));
vi.mock("./storage", () => ({
  createArchiveStorage: () => ({
    readArchive: mocks.raw,
    archiveBlob: mocks.archive,
  }),
}));
vi.mock("./receipt", () => ({
  writeValidationStopped: mocks.receipt,
  validationFileStopPublication: mocks.publication,
}));
vi.mock("./transactions", () => ({
  validationTransactions: {
    claimValidation: mocks.claim,
    acknowledgeValidationFileStop: mocks.ack,
    appendValidationEvidence: mocks.append,
    interruptValidation: mocks.interrupt,
    recoverValidationClaim: mocks.recover,
    retryValidationClaim: mocks.retry,
  },
}));
import { createQuizpackValidationService } from "./service";
import {
  validationKey,
  serializeValidationAttempts,
  parseValidationAttempts,
} from "./repository";
import type { ArchiveOperation } from "./operation";
import type { ValidationAttempt, ValidationRow } from "./repository";
import { VALIDATION_RESERVATION_BYTES } from "./limits";
import { ARCHIVE_POLICY_VERSION, archivePolicySha256 } from "./policy";
const productId = "synthetic-dimensions",
  importId = randomUUID(),
  hash = "a".repeat(64);
const identity = runtimeIdentity({
  schema: "quizpack-media-runtime-binding.v1",
  platform: "darwin-arm64",
  componentId: hash,
  deploymentId: "b".repeat(64),
  runtimeBundleHash: "c".repeat(64),
  limitsHash: "d".repeat(64),
});
const credentials = {
    sessionToken: null,
    csrfToken: null,
    requestId: randomUUID(),
  },
  contexts: MediaOperationContext[] = [];
const input = () => ({
  expectedImportStateRevision: 1,
  expectedValidationKey: validationKey({
    productId,
    importId,
    archiveSha256: hash,
    archiveBytes: 10,
    identitySha256: identity.identitySha256,
    archivePolicyVersion: ARCHIVE_POLICY_VERSION,
    archivePolicySha256,
  }),
});
function context() {
  const value = createMediaOperationContext({
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 60000,
  });
  contexts.push(value);
  return value;
}
const db = { sql: { end: vi.fn(async () => {}) } } as unknown as P2aDatabase;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.product.mockResolvedValue({ id: productId, archived_at: null });
  mocks.original.mockResolvedValue({
    id: importId,
    product_id: productId,
    status: "received",
    actual_archive_sha256: hash,
    actual_archive_bytes: 10,
    state_revision: 1,
  });
  mocks.config.mockResolvedValue({ imports: { enabled: true } });
  mocks.acquire.mockImplementation(async () => ({
    controller: new AbortController(),
    assert: () => {},
    close: async () => true,
  }));
  mocks.scan.mockResolvedValue({ bytes: 0, entries: 3, files: new Map() });
  mocks.held.mockResolvedValue([]);
  mocks.exact.mockResolvedValue(null);
  mocks.prepare.mockResolvedValue({
    outcome: "prepared",
    identity,
    prepared: Object.freeze({}),
    completion: {
      mediaStopped: "not-started",
      relatedIo: "settled",
      maintenanceRequired: false,
    },
    runtimeFailure: null,
  });
  mocks.receipt.mockResolvedValue(false);
});
afterEach(() => {
  for (const ctx of contexts.splice(0)) disposeMediaOperationContext(ctx);
});
it("exact key replay precedes current runtime, scan and stale import revision admission", async () => {
  const row = {
    id: randomUUID(),
    validation_key: input().expectedValidationKey,
  };
  mocks.exact.mockResolvedValue(row);
  mocks.dto.mockResolvedValue({ id: row.id, status: "retryable-failed" });
  mocks.prepare.mockRejectedValue(new Error("NO_CURRENT_PLATFORM"));
  mocks.scan.mockRejectedValue(new Error("NO_ADMISSION"));
  const result = await createQuizpackValidationService().startValidation(
    db,
    credentials,
    productId,
    importId,
    { ...input(), expectedImportStateRevision: 999 },
    context(),
  );
  expect(result).toMatchObject({
    outcome: "record",
    created: false,
    validation: { id: row.id },
  });
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.scan).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
});
it("prepare returns safe exact tuple without archive or claim IO", async () => {
  const result = await createQuizpackValidationService().prepareValidation(
    db,
    credentials,
    productId,
    importId,
    { expectedImportStateRevision: 1 },
    context(),
  );
  expect(result).toEqual({
    productId,
    importId,
    expectedImportStateRevision: 1,
    archiveSha256: hash,
    archiveBytes: 10,
    identitySha256: identity.identitySha256,
    validationKey: input().expectedValidationKey,
  });
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.raw).not.toHaveBeenCalled();
  expect(mocks.scan).not.toHaveBeenCalled();
});
it("disabled preclaim closes the operation and returns explicit not-started only after related work settles", async () => {
  mocks.config.mockResolvedValue({ imports: { enabled: false } });
  const result = await createQuizpackValidationService().startValidation(
    db,
    credentials,
    productId,
    importId,
    input(),
    context(),
  );
  expect(result).toEqual({
    outcome: "not-started",
    execution: "not-started",
    productId,
    importId,
    ...input(),
    code: "IMPORTS_DISABLED",
  });
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.raw).not.toHaveBeenCalled();
});
it("identity mismatch never claims or silently changes the expected key", async () => {
  const value = { ...input(), expectedValidationKey: "f".repeat(64) };
  const result = await createQuizpackValidationService().startValidation(
    db,
    credentials,
    productId,
    importId,
    value,
    context(),
  );
  expect(result).toMatchObject({
    outcome: "not-started",
    expectedValidationKey: value.expectedValidationKey,
    code: "VALIDATION_IDENTITY_CHANGED",
  });
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.raw).not.toHaveBeenCalled();
});
it("unknown claim outcome never opens an archive or emits preclaim not-started", async () => {
  mocks.claim.mockRejectedValue(new StudioError("WRITE_OUTCOME_UNKNOWN"));
  await expect(
    createQuizpackValidationService().startValidation(
      db,
      credentials,
      productId,
      importId,
      input(),
      context(),
    ),
  ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
  expect(mocks.raw).not.toHaveBeenCalled();
  expect(mocks.candidate).not.toHaveBeenCalled();
  expect(mocks.archive).not.toHaveBeenCalled();
  expect(mocks.receipt).not.toHaveBeenCalled();
});
it("malformed shared UNKNOWN cannot be downgraded by a later prepared success", async () => {
  const ctx = context();
  mocks.prepare.mockImplementation(async () => {
    requestMediaOperationStop(ctx, "STOP_UNCONFIRMED");
    return {
      outcome: "prepared",
      identity,
      prepared: {},
      completion: {
        mediaStopped: "not-started",
        relatedIo: "settled",
        maintenanceRequired: false,
      },
      runtimeFailure: null,
    };
  });
  await expect(
    createQuizpackValidationService().startValidation(
      db,
      credentials,
      productId,
      importId,
      input(),
      ctx,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_RECOVERY_REQUIRED" });
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.raw).not.toHaveBeenCalled();
});
it("claim's own exact replay avoids archive execution even when the earlier read missed it", async () => {
  const row = {
    id: randomUUID(),
    validation_key: input().expectedValidationKey,
  };
  mocks.claim.mockResolvedValue({ created: false, row });
  mocks.dto.mockResolvedValue({ id: row.id, status: "ready" });
  const result = await createQuizpackValidationService().startValidation(
    db,
    credentials,
    productId,
    importId,
    input(),
    context(),
  );
  expect(result).toMatchObject({
    outcome: "record",
    created: false,
    validation: { id: row.id },
  });
  expect(mocks.raw).not.toHaveBeenCalled();
  expect(mocks.candidate).not.toHaveBeenCalled();
});
it("opaque prepared handle never appears in the prepare DTO serialization", async () => {
  const handle = {
    toJSON() {
      throw new Error("PRIVATE_HANDLE");
    },
  };
  mocks.prepare.mockResolvedValue({
    outcome: "prepared",
    identity,
    prepared: handle,
    completion: {
      mediaStopped: "not-started",
      relatedIo: "settled",
      maintenanceRequired: false,
    },
    runtimeFailure: null,
  });
  const value = await createQuizpackValidationService().prepareValidation(
    db,
    credentials,
    productId,
    importId,
    { expectedImportStateRevision: 1 },
    context(),
  );
  expect(() => canonicalP1Json(value)).not.toThrow();
  expect(Object.keys(value)).not.toContain("prepared");
});

function claimedRow(): ValidationRow {
  const attempt: ValidationAttempt = {
    attemptId: randomUUID(),
    ordinal: 1,
    fence: 1,
    ownerPid: process.pid,
    ownerNonce: "A".repeat(43),
    kind: "validate",
    reservationBytes: VALIDATION_RESERVATION_BYTES,
    disposition: "held",
    mediaStop: "unconfirmed",
    fileStopProof: null,
  };
  return {
    id: randomUUID(),
    product_id: productId,
    import_id: importId,
    status: "validating",
    state_revision: 1,
    fence: 1,
    current_attempt_id: attempt.attemptId,
    attempts_text: serializeValidationAttempts([attempt]),
    archive_bytes: 10,
    archive_sha256: hash,
    identity_sha256: identity.identitySha256,
    evidence_text: null,
    asset_set_text: null,
    last_error_code: null,
  } as ValidationRow;
}
function knownPublisher() {
  mocks.receipt.mockImplementation(async (op: ArchiveOperation) => {
    if (!op.canIssueStoppedReceipt()) return false;
    return op.stoppedReceiptTask(async () => true);
  });
  mocks.publication.mockImplementation(
    (op: ArchiveOperation, id: string, a: ValidationAttempt) => ({
      bytes: 300,
      qualification: op.fileStopAckQualification(),
      proof: {
        schemaVersion: "quizpack-validation-file-stop-proof.v1",
        protocol: "candidate-receipt-db-ack.v1",
        validationId: id,
        attemptId: a.attemptId,
        fence: a.fence,
        ownerPid: a.ownerPid,
        ownerNonce: a.ownerNonce,
        receiptSha256: "e".repeat(64),
        scope: "files-and-media",
        mediaStopped: op.completion().mediaStopped,
        relatedIo: "settled",
      },
    }),
  );
}
it("an active finite raw-file rejection acknowledges settled files before one interrupt with the ACK revision", async () => {
  let row = claimedRow();
  mocks.claim.mockResolvedValue({ row, created: true });
  mocks.raw.mockRejectedValue(new StudioError("VALIDATION_STORAGE_CONFLICT"));
  knownPublisher();
  mocks.ack.mockImplementation(async (_db, _c, _s, input) => {
    expect(input.authority.expectedStateRevision).toBe(1);
    row = {
      ...row,
      state_revision: 2,
      attempts_text: serializeValidationAttempts(
        parseValidationAttempts(row.attempts_text).map((a) => ({
          ...a,
          mediaStop: input.proof.mediaStopped,
          fileStopProof: input.proof,
        })),
      ),
    };
    return row;
  });
  mocks.interrupt.mockImplementation(async (_db, _c, _s, input) => {
    expect(input.authority.expectedStateRevision).toBe(2);
    expect(input.accountedBytes).toBe(300);
    expect(input.settledAttempts[0].fileStopProof).toEqual(
      parseValidationAttempts(row.attempts_text)[0]!.fileStopProof,
    );
    row = { ...row, state_revision: 3, status: "retryable-failed" };
    return row;
  });
  mocks.dto.mockImplementation(async (_tx, row) => ({
    id: row.id,
    status: row.status,
  }));
  const result = await createQuizpackValidationService().startValidation(
    db,
    credentials,
    productId,
    importId,
    input(),
    context(),
  );
  expect(result).toMatchObject({
    outcome: "record",
    created: true,
    validation: { status: "retryable-failed" },
  });
  expect(mocks.ack).toHaveBeenCalledTimes(1);
  expect(mocks.interrupt).toHaveBeenCalledTimes(1);
  expect(mocks.candidate).not.toHaveBeenCalled();
  expect(mocks.archive).not.toHaveBeenCalled();
});
it.each(["cancel", "unknown"] as const)(
  "%s raw-file failure cannot issue ACK or release held reservation",
  async (mode) => {
    const row = claimedRow(),
      ctx = context();
    mocks.claim.mockResolvedValue({ row, created: true });
    knownPublisher();
    mocks.raw.mockImplementation(async (op: ArchiveOperation) => {
      if (mode === "cancel") requestMediaOperationStop(ctx, "CANCELLED");
      else op.markRelatedIoUnknown();
      throw new StudioError("VALIDATION_STORAGE_CONFLICT");
    });
    await expect(
      createQuizpackValidationService().startValidation(
        db,
        credentials,
        productId,
        importId,
        input(),
        ctx,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_STORAGE_CONFLICT" });
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.interrupt).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  },
);
it("unknown ACK stops the request without finalization, fresh transactions or another candidate publication", async () => {
  const row = claimedRow();
  mocks.claim.mockResolvedValue({ row, created: true });
  mocks.raw.mockRejectedValue(new StudioError("VALIDATION_STORAGE_CONFLICT"));
  knownPublisher();
  mocks.ack.mockRejectedValue(new StudioError("WRITE_OUTCOME_UNKNOWN"));
  await expect(
    createQuizpackValidationService().startValidation(
      db,
      credentials,
      productId,
      importId,
      input(),
      context(),
    ),
  ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
  expect(mocks.ack).toHaveBeenCalledTimes(1);
  expect(mocks.interrupt).not.toHaveBeenCalled();
  expect(mocks.receipt).toHaveBeenCalledTimes(1);
});

it("a normal content rejection freezes A evidence then ACK and interrupt, with no decoder retry or blob promotion", async () => {
  let row = claimedRow();
  mocks.claim.mockResolvedValue({ row, created: true });
  mocks.raw.mockResolvedValue(Buffer.from("synthetic"));
  knownPublisher();
  mocks.candidate.mockResolvedValue({
    outcome: "rejected",
    code: "AUTHORED_NOT_SUPPORTED",
    evidence: {
      schemaVersion: "quizpack-candidate-evidence.v1",
      input: {
        status: "snapshotted",
        archiveSha256: hash,
        archiveBytes: 10,
        targetProductId: productId,
      },
      identity: { status: "bound", value: identity },
      report: { status: "not-run", reason: "BACKEND_POLICY_REJECTED" },
      policy: { status: "rejected", code: "AUTHORED_NOT_SUPPORTED" },
      media: [],
      completion: {
        mediaStopped: "not-started",
        relatedIo: "settled",
        maintenanceRequired: false,
      },
      runtimeFailure: null,
    },
  });
  mocks.append.mockImplementation(async (_db, _c, _s, value) => {
    expect(value.candidate).toBeNull();
    expect(value.projection.reportTexts).toEqual([]);
    row = {
      ...row,
      state_revision: 2,
      status: "rejected",
      evidence_text: value.projection.evidenceText,
      attempts_text: value.projection.attemptsControlText,
    };
    return row;
  });
  mocks.ack.mockImplementation(async (_db, _c, _s, value) => {
    expect(value.authority.expectedStateRevision).toBe(2);
    row = {
      ...row,
      state_revision: 3,
      attempts_text: serializeValidationAttempts(
        parseValidationAttempts(row.attempts_text).map((a) => ({
          ...a,
          fileStopProof: value.proof,
        })),
      ),
    };
    return row;
  });
  mocks.interrupt.mockImplementation(async (_db, _c, _s, value) => {
    expect(value.authority.expectedStateRevision).toBe(3);
    row = { ...row, state_revision: 4 };
    return row;
  });
  const result = await createQuizpackValidationService().startValidation(
    db,
    credentials,
    productId,
    importId,
    input(),
    context(),
  );
  expect(result).toMatchObject({
    outcome: "record",
    created: true,
    validation: { status: "rejected" },
  });
  expect(mocks.append).toHaveBeenCalledTimes(1);
  expect(mocks.ack).toHaveBeenCalledTimes(1);
  expect(mocks.interrupt).toHaveBeenCalledTimes(1);
  expect(mocks.archive).not.toHaveBeenCalled();
});
