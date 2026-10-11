import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkedImportFetch,
  checkImport,
  checkImportPage,
  checkSettings,
} from "./client";
import type { ImportDto } from "@/features/quizpack/import/contracts";

const id = "00000000-0000-0000-0000-000000000001";
const productId = "synthetic-client";
const input = {
  expectedArchiveSha256: "a".repeat(64),
  expectedArchiveBytes: 3,
  target: { kind: "new-draft" as const },
};
const dto: ImportDto = {
  id,
  productId,
  status: "awaiting-upload",
  stateRevision: 1,
  ...{
    expectedArchiveSha256: input.expectedArchiveSha256,
    expectedArchiveBytes: 3,
  },
  actualArchiveSha256: null,
  actualArchiveBytes: null,
  createdAt: "2026-10-12T00:00:00Z",
  updatedAt: "2026-10-12T00:00:00Z",
  receivedAt: null,
  storageCondition: "clean",
  lastErrorCode: null,
  validationStatus: "not-run",
  publishable: false,
};
const check = (value: unknown) =>
  checkImport(value, { productId, importId: id, input });
afterEach(() => vi.unstubAllGlobals());
function serve(value: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(value, { status })),
  );
}

describe("checked import response boundary", () => {
  it.each([
    [502, "CSRF_REJECTED"],
    [500, "INVALID_REQUEST"],
  ] as const)(
    "status %s mismatched with %s stays unknown",
    async (status, code) => {
      serve({ code, requestId: id }, status);
      await expect(
        checkedImportFetch("/imports", { method: "POST" }, check, true),
      ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
      await expect(
        checkedImportFetch("/imports/id", {}, check),
      ).rejects.toMatchObject({ code: "STUDIO_UNAVAILABLE" });
    },
  );
  it("accepts a documented 403 CSRF refusal as definite for this request", async () => {
    serve({ code: "CSRF_REJECTED", requestId: id }, 403);
    await expect(
      checkedImportFetch("/imports", { method: "POST" }, check, true),
    ).rejects.toMatchObject({ code: "CSRF_REJECTED" });
  });
  it.each([
    {},
    null,
    [],
    { ...dto, id: "00000000-0000-0000-0000-000000000002" },
    { ...dto, productId: "another-product" },
    { ...dto, expectedArchiveBytes: 4 },
    { ...dto, expectedArchiveSha256: "b".repeat(64) },
    { ...dto, validationStatus: "passed" },
    { ...dto, publishable: true },
    { ...dto, stateRevision: 0 },
    { ...dto, extra: "unknown" },
    { ...dto, status: "received" },
  ])("treats invalid successful writes as unknown", async (value) => {
    serve(value);
    await expect(
      checkedImportFetch("/imports/id/archive", { method: "PUT" }, check, true),
    ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
  });
  it.each(["create", "archive", "recover"])(
    "204 %s is unknown",
    async (action) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 204 })),
      );
      await expect(
        checkedImportFetch(
          `/imports/${action}`,
          { method: "POST" },
          check,
          true,
        ),
      ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    },
  );
  it("invalid read responses never become authoritative snapshots", async () => {
    serve({});
    await expect(
      checkedImportFetch("/imports/id", {}, check),
    ).rejects.toMatchObject({ code: "STUDIO_UNAVAILABLE" });
  });
  it("maps unknown or malformed error envelopes conservatively", async () => {
    for (const value of [
      { code: "UNEXPECTED_CODE", requestId: id },
      { code: "INVALID_REQUEST" },
      { code: "INVALID_REQUEST", requestId: id, secret: "ignored" },
    ]) {
      serve(value, 400);
      await expect(
        checkedImportFetch("/imports", { method: "POST" }, check, true),
      ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    }
    serve(
      { code: "IMPORT_STATE_CONFLICT", requestId: id, currentRevision: 2 },
      409,
    );
    await expect(
      checkedImportFetch(
        "/imports/id/recover",
        { method: "POST" },
        check,
        true,
      ),
    ).rejects.toMatchObject({
      code: "IMPORT_STATE_CONFLICT",
      currentRevision: 2,
    });
  });
  it("accepts an exact known declaration and received immutable facts", async () => {
    serve(dto, 201);
    expect(
      await checkedImportFetch(
        "/imports",
        { method: "POST" },
        check,
        true,
        [200, 201],
      ),
    ).toEqual(dto);
    const received = {
      ...dto,
      status: "received" as const,
      actualArchiveBytes: 3,
      actualArchiveSha256: input.expectedArchiveSha256,
      receivedAt: "2026-10-12T00:00:00Z",
    };
    expect(check(received)).toEqual(received);
  });
  it("exact lookup rejects wrong identity/declaration, duplicate and hidden records", () => {
    const exact = (value: unknown) =>
      checkImportPage(value, {
        productId,
        input,
        page: 1,
        pageSize: 1,
        exact: true,
      });
    const page = {
      items: [dto],
      page: 1,
      pageSize: 1,
      total: 1,
      hasNext: false,
    };
    expect(exact(page).items).toEqual([dto]);
    expect(exact({ ...page, items: [], total: 0 }).items).toEqual([]);
    for (const value of [
      { ...page, items: [{ ...dto, productId: "another-product" }] },
      { ...page, items: [{ ...dto, expectedArchiveBytes: 4 }] },
      { ...page, items: [dto, dto], total: 2 },
      { ...page, total: 2 },
      { ...page, hasNext: true },
      { ...page, page: 2 },
    ])
      expect(() => exact(value)).toThrow();
  });
  it("settings accepts only fixed server limits", () => {
    expect(
      checkSettings({
        enabled: false,
        maxArchiveBytes: 33554432,
        receiveTimeoutMs: 60000,
      }).enabled,
    ).toBe(false);
    expect(() =>
      checkSettings({
        enabled: true,
        maxArchiveBytes: 99999999,
        receiveTimeoutMs: 60000,
      }),
    ).toThrow();
  });
});
