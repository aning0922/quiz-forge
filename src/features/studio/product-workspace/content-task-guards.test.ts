import { describe, expect, it } from "vitest";
import type { ImportDto } from "@/features/quizpack/import/contracts";
import { dto } from "../validations/fixtures.test-support";
import {
  summary,
  receipt,
  tuple,
  memoryStorage,
} from "../drafts/fixtures.test-support";
import { DRAFT_PENDING_STORAGE_KEY } from "../drafts/pending";
import {
  matchesContentCompletion,
  isRejectedContentSource,
  assertNoContentPending,
} from "./content-task-guards";

const selected = {
  ...dto,
  productId: tuple.productId,
  importId: tuple.sourceImportId,
  id: tuple.sourceValidationId,
  stateRevision: tuple.expectedValidationStateRevision,
  status: "ready" as const,
  candidateSha256: tuple.expectedCandidateSha256,
  assetSetSha256: summary.assetSetSha256,
};
const received: ImportDto = {
  id: selected.importId,
  productId: selected.productId,
  status: "received",
  stateRevision: 1,
  expectedArchiveSha256: selected.archiveSha256,
  expectedArchiveBytes: selected.archiveBytes,
  actualArchiveSha256: selected.archiveSha256,
  actualArchiveBytes: selected.archiveBytes,
  createdAt: selected.createdAt,
  updatedAt: selected.updatedAt,
  receivedAt: selected.createdAt,
  storageCondition: "clean",
  lastErrorCode: null,
  validationStatus: "not-run",
  publishable: false,
};
describe("content run receipt ownership and confirmed rejection", () => {
  it("accepts its selected source, but never completes A from a valid same-product historical B receipt", async () => {
    const application = await receipt();
    expect(
      matchesContentCompletion(tuple.productId, selected, application),
    ).toBe(true);
    expect(
      matchesContentCompletion(tuple.productId, selected, {
        ...application,
        sourceImportId: "77777777-7777-4777-8777-777777777777",
        sourceValidationId: "88888888-8888-4888-8888-888888888888",
      }),
    ).toBe(false);
  });
  it("does not complete from another fixed declaration of the same source identity", async () => {
    const application = await receipt();
    expect(
      matchesContentCompletion(
        tuple.productId,
        { ...selected, stateRevision: selected.stateRevision + 1 },
        application,
      ),
    ).toBe(false);
    expect(
      matchesContentCompletion(
        tuple.productId,
        { ...selected, candidateSha256: "f".repeat(64) },
        application,
      ),
    ).toBe(false);
    expect(
      matchesContentCompletion(
        tuple.productId,
        { ...selected, assetSetSha256: "f".repeat(64) },
        application,
      ),
    ).toBe(false);
  });
  it("permits only an exact clean acknowledged rejected import or its terminal rejected check", () => {
    const rejected = {
      ...selected,
      status: "rejected" as const,
      storageCondition: "clean" as const,
      maintenanceRequired: false,
    };
    expect(
      isRejectedContentSource({ ...received, status: "rejected" }, undefined),
    ).toBe(true);
    expect(isRejectedContentSource(received, rejected)).toBe(true);
    expect(
      isRejectedContentSource(received, {
        ...rejected,
        importId: "77777777-7777-4777-8777-777777777777",
      }),
    ).toBe(false);
    expect(
      isRejectedContentSource(received, {
        ...rejected,
        maintenanceRequired: true,
      }),
    ).toBe(false);
    expect(
      isRejectedContentSource(received, {
        ...rejected,
        storageCondition: "unknown",
      }),
    ).toBe(false);
  });
  it("empty, receiving, failed or unknown observations are not a terminal rejection", () => {
    expect(isRejectedContentSource(undefined, undefined)).toBe(false);
    expect(isRejectedContentSource(received, undefined)).toBe(false);
    expect(
      isRejectedContentSource(
        { ...received, status: "receiving", storageCondition: "unknown" },
        undefined,
      ),
    ).toBe(false);
    expect(
      isRejectedContentSource(
        { ...received, status: "retryable-failed" },
        undefined,
      ),
    ).toBe(false);
    expect(
      isRejectedContentSource(
        { ...received, status: "rejected", storageCondition: "unknown" },
        undefined,
      ),
    ).toBe(false);
  });
  it("refuses local owner disposal when original same-product pending exists, without modifying it", () => {
    const storage = memoryStorage();
    const original = JSON.stringify({
      schemaVersion: DRAFT_PENDING_STORAGE_KEY,
      entries: [{ tuple, mayHaveBeenSent: true }],
    });
    storage.setItem(DRAFT_PENDING_STORAGE_KEY, original);
    expect(() => assertNoContentPending(storage, tuple.productId)).toThrow();
    expect(storage.getItem(DRAFT_PENDING_STORAGE_KEY)).toBe(original);
    expect(() =>
      assertNoContentPending(storage, "another-product"),
    ).not.toThrow();
  });
  it("fails closed on unavailable or corrupt original storage", () => {
    expect(() =>
      assertNoContentPending(
        {
          getItem() {
            throw new Error("unavailable");
          },
          setItem() {},
        },
        tuple.productId,
      ),
    ).toThrow();
    const storage = memoryStorage();
    storage.setItem(DRAFT_PENDING_STORAGE_KEY, "corrupt");
    expect(() => assertNoContentPending(storage, tuple.productId)).toThrow();
    expect(storage.getItem(DRAFT_PENDING_STORAGE_KEY)).toBe("corrupt");
  });
});
