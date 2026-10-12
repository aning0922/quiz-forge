import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { TestDatabase } from "./p2a-fixture";
import type { P2aDatabase } from "@/lib/db/client";
import { createDatabase } from "@/lib/db/client";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { validationTransactions } from "@/features/quizpack/validation/transactions";
import {
  serializeValidationAttempts,
  type ValidationAttempt,
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
import { VALIDATION_RESERVATION_BYTES } from "@/features/quizpack/validation/limits";
import { requestMediaOperationStop } from "@/features/quizpack/server/media";
import { StudioError } from "@/lib/http-security/errors";
import {
  runTestValidationRequest,
  testValidationRequestEnded,
} from "./p2b2b-request-fixture";
vi.mock("@/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/client")>()),
  createDatabase: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());
function setup(proof = true) {
  const id = randomUUID(),
    attemptId = randomUUID(),
    nonce = "a".repeat(43);
  const a: ValidationAttempt = {
    attemptId,
    ordinal: 1,
    fence: 1,
    ownerPid: process.pid,
    ownerNonce: nonce,
    kind: "validate",
    reservationBytes: VALIDATION_RESERVATION_BYTES,
    disposition: "released",
    mediaStop: "confirmed",
    fileStopProof: proof
      ? {
          schemaVersion: "quizpack-validation-file-stop-proof.v1",
          protocol: "candidate-receipt-db-ack.v1",
          validationId: id,
          attemptId,
          fence: 1,
          ownerPid: process.pid,
          ownerNonce: nonce,
          receiptSha256: "a".repeat(64),
          scope: "files-and-media",
          mediaStopped: "confirmed",
          relatedIo: "settled",
        }
      : null,
  };
  const row = {
    id,
    product_id: "synthetic",
    import_id: randomUUID(),
    validation_key: "b".repeat(64),
    state_revision: 4,
    attempts_text: serializeValidationAttempts([a]),
  } as ValidationRow;
  const fixture = {
    config: { purpose: "test", instanceId: randomUUID() },
  } as TestDatabase;
  const requestClose = vi.fn(async () => {}),
    snapshotClose = vi.fn(async () => {});
  const db = {
    config: fixture.config,
    sql: vi.fn(async () => []),
    close: requestClose,
  } as unknown as P2aDatabase;
  const readDb = {
    config: fixture.config,
    sql: vi.fn(async () => [row]),
    close: snapshotClose,
  } as unknown as P2aDatabase;
  vi.mocked(createDatabase)
    .mockResolvedValueOnce(db)
    .mockResolvedValueOnce(readDb);
  const lockClose = vi.fn(async () => true),
    lock = { close: lockClose } as unknown as StorageLock;
  vi.spyOn(StorageLock, "acquire").mockResolvedValue(lock);
  vi.spyOn(validationTransactions, "claimValidation").mockResolvedValue({
    row,
    created: true,
  });
  const work = async (
    request: P2aDatabase,
    ctx: Parameters<typeof requestMediaOperationStop>[0],
  ) => {
    const owned = await StorageLock.acquire(request.config, ctx);
    await validationTransactions.claimValidation(
      request,
      {} as never,
      { productId: row.product_id, importId: row.import_id },
      { owner: { ownerPid: process.pid, ownerNonce: nonce } } as never,
    );
    await owned.close();
    requestMediaOperationStop(ctx, "RUNTIME_FAILED");
    throw new StudioError("WRITE_OUTCOME_UNKNOWN");
  };
  return { fixture, row, work, requestClose, snapshotClose, lockClose };
}
it("original rejected COMMIT response with ACK and all actual observed closes registers serviceSettled", async () => {
  const t = setup();
  await expect(
    runTestValidationRequest(t.fixture, t.work),
  ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
  expect(t.requestClose).toHaveBeenCalledOnce();
  expect(t.snapshotClose).toHaveBeenCalledOnce();
  expect(t.lockClose).toHaveBeenCalledOnce();
  expect(testValidationRequestEnded(t.fixture, t.row)).toBe(true);
});
it("original rejection cannot register before its pending lock close actually settles", async () => {
  const t = setup();
  let release: () => void = () => {};
  t.lockClose.mockImplementation(
    () =>
      new Promise<boolean>((r) => {
        release = () => r(true);
      }),
  );
  const task = runTestValidationRequest(t.fixture, t.work);
  const failed = expect(task).rejects.toMatchObject({
    code: "WRITE_OUTCOME_UNKNOWN",
  });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(testValidationRequestEnded(t.fixture, t.row)).toBe(false);
  release();
  await failed;
  expect(testValidationRequestEnded(t.fixture, t.row)).toBe(true);
});
it("request DB close failure refuses a marker despite persisted ACK", async () => {
  const t = setup();
  t.requestClose.mockRejectedValue(new Error("synthetic"));
  await expect(runTestValidationRequest(t.fixture, t.work)).rejects.toThrow();
  expect(testValidationRequestEnded(t.fixture, t.row)).toBe(false);
});
it("no ACK keeps the original rejected request unregistered", async () => {
  const t = setup(false);
  await expect(runTestValidationRequest(t.fixture, t.work)).rejects.toThrow();
  expect(testValidationRequestEnded(t.fixture, t.row)).toBe(false);
});
it("replay of another request's ACK does not establish original claim ownership", async () => {
  const t = setup();
  vi.mocked(validationTransactions.claimValidation).mockResolvedValue({
    row: t.row,
    created: false,
  });
  await expect(runTestValidationRequest(t.fixture, t.work)).rejects.toThrow();
  expect(testValidationRequestEnded(t.fixture, t.row)).toBe(false);
  expect(t.snapshotClose).not.toHaveBeenCalled();
});
it("snapshot connection close failure refuses an original rejected marker", async () => {
  const t = setup();
  t.snapshotClose.mockRejectedValue(new Error("synthetic"));
  await expect(runTestValidationRequest(t.fixture, t.work)).rejects.toThrow();
  expect(testValidationRequestEnded(t.fixture, t.row)).toBe(false);
});
