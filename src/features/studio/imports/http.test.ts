import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { csrfForToken, issueToken } from "@/lib/security/p2a-tokens";
import { StudioError } from "@/lib/http-security/errors";
import type { ImportReceiveService } from "@/features/quizpack/import/service-contract";
import type { ImportDto } from "@/features/quizpack/import/contracts";
import { handleImportHttp, type ImportEndpoint } from "./http";

const mocked = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  close: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db/runtime", () => ({ loadRuntimeConfig: mocked.load }));
vi.mock("@/lib/db/client", () => ({ createDatabase: mocked.create }));
const origin = "http://127.0.0.1:3100";
const productId = "synthetic-http";
const id = "00000000-0000-0000-0000-000000000001";
const dto: ImportDto = {
  id,
  productId,
  status: "awaiting-upload",
  stateRevision: 1,
  expectedArchiveSha256: "a".repeat(64),
  expectedArchiveBytes: 1,
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
// These dispatch spies are unit-only; no HTTP route installs a substitute service.
function service() {
  return {
    readImportSettings: vi.fn(async () => ({
      enabled: false,
      maxArchiveBytes: 33554432 as const,
      receiveTimeoutMs: 60000 as const,
    })),
    createIntent: vi.fn(async () => ({ import: dto, created: true })),
    readImport: vi.fn(async () => dto),
    listImports: vi.fn(async () => ({
      items: [dto],
      page: 1,
      pageSize: 1,
      total: 1,
      hasNext: false,
    })),
    receiveArchive: vi.fn<ImportReceiveService["receiveArchive"]>(
      async () => dto,
    ),
    recoverReceive: vi.fn<ImportReceiveService["recoverReceive"]>(
      async () => dto,
    ),
  } satisfies ImportReceiveService;
}
function request(
  action: ImportEndpoint["action"],
  extra: Record<string, string> = {},
  body?: BodyInit,
  query = "",
) {
  const token = issueToken("session").raw;
  const read = action === "read" || action === "list" || action === "settings";
  return new Request(
    `${origin}/api/studio/products/${productId}/imports${query}`,
    {
      method: read ? "GET" : action === "archive" ? "PUT" : "POST",
      headers: {
        host: "127.0.0.1:3100",
        origin,
        cookie: `${SESSION_COOKIE}=${token}`,
        "x-csrf-token": csrfForToken(token, "session")!,
        "content-type":
          action === "archive"
            ? "application/octet-stream"
            : "application/json",
        "idempotency-key": id,
        ...extra,
      },
      ...(!read
        ? {
            body:
              body ??
              JSON.stringify({
                expectedArchiveSha256: "a".repeat(64),
                expectedArchiveBytes: 1,
                target: { kind: "new-draft" },
              }),
          }
        : {}),
    },
  );
}
const endpoint = (action: ImportEndpoint["action"]): ImportEndpoint => ({
  action,
  productId,
  importId: id,
});
async function code(response: Response) {
  return ((await response.json()) as { code: string }).code;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.load.mockResolvedValue({ profile: "local-http-p2a", origin });
  mocked.create.mockResolvedValue({ close: mocked.close });
});

describe("receipt HTTP dispatch unit boundary", () => {
  it("includes route parameter wait in the absolute entry budget", async () => {
    const implementation = service();
    const read = vi.fn();
    const cancel = vi.fn(async () => undefined);
    const incoming = request("archive");
    Object.defineProperty(incoming, "body", {
      value: { getReader: () => ({ read, cancel, releaseLock: vi.fn() }) },
    });
    const response = await handleImportHttp(
      incoming,
      endpoint("archive"),
      implementation,
      performance.now() - 60001,
    );
    expect(await code(response)).toBe("RECEIVE_TIMEOUT");
    expect(mocked.create).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("reads a real service snapshot as disabled 200, with no-store", async () => {
    const implementation = service();
    const response = await handleImportHttp(
      request("settings"),
      endpoint("settings"),
      implementation,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      enabled: false,
      maxArchiveBytes: 33554432,
      receiveTimeoutMs: 60000,
    });
    expect(implementation.readImportSettings).toHaveBeenCalledTimes(1);
    expect(mocked.create.mock.calls[0]?.[1]).toBeUndefined();
  });
  it("returns 201 only for a fresh intent and 200 for an exact replay", async () => {
    const implementation = service();
    expect(
      (
        await handleImportHttp(
          request("create"),
          endpoint("create"),
          implementation,
        )
      ).status,
    ).toBe(201);
    implementation.createIntent.mockResolvedValue({
      import: dto,
      created: false,
    });
    expect(
      (
        await handleImportHttp(
          request("create"),
          endpoint("create"),
          implementation,
        )
      ).status,
    ).toBe(200);
  });
  it.each([
    { host: "localhost:3100" },
    { origin: "null" },
    { "sec-fetch-site": "cross-site" },
    { "x-csrf-token": "invalid" },
  ])("rejects source/CSRF before service dispatch", async (headers) => {
    const implementation = service();
    const response = await handleImportHttp(
      request("create", headers),
      endpoint("create"),
      implementation,
    );
    expect(response.status).toBe(403);
    expect(implementation.createIntent).not.toHaveBeenCalled();
  });
  it("strictly rejects extra body, noncanonical key, oversized JSON, and query on detail", async () => {
    const implementation = service();
    for (const incoming of [
      request(
        "create",
        {},
        JSON.stringify({
          expectedArchiveSha256: "a".repeat(64),
          expectedArchiveBytes: 1,
          target: { kind: "new-draft" },
          extra: true,
        }),
      ),
      request("create", { "idempotency-key": "UPPER" }),
      request("read", {}, undefined, "?page=1"),
    ])
      expect(
        await code(
          await handleImportHttp(
            incoming,
            endpoint(incoming.method === "GET" ? "read" : "create"),
            implementation,
          ),
        ),
      ).toBe("INVALID_REQUEST");
    expect(
      (
        await handleImportHttp(
          request("create", { "content-length": "2" }, "x".repeat(4097)),
          endpoint("create"),
          implementation,
        )
      ).status,
    ).toBe(413);
    expect(implementation.createIntent).not.toHaveBeenCalled();
  });
  it("passes exact key and unfiltered state query to service", async () => {
    const implementation = service();
    await handleImportHttp(
      request("list", {}, undefined, `?idempotencyKey=${id}&page=1&pageSize=1`),
      endpoint("list"),
      implementation,
    );
    expect(implementation.listImports.mock.calls[0]?.at(-1)).toEqual({
      idempotencyKey: id,
      page: 1,
      pageSize: 1,
    });
  });
  it("cancels early-rejected raw input without reading it", async () => {
    const read = vi.fn();
    const cancel = vi.fn(async () => undefined);
    const releaseLock = vi.fn();
    const incoming = request("archive", {
      "content-type": "multipart/form-data",
    });
    Object.defineProperty(incoming, "body", {
      value: { getReader: () => ({ read, cancel, releaseLock }) },
    });
    const implementation = service();
    expect(
      await code(
        await handleImportHttp(incoming, endpoint("archive"), implementation),
      ),
    ).toBe("INVALID_REQUEST");
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(implementation.receiveArchive).not.toHaveBeenCalled();
  });
  it("forwards entry deadline after delayed configuration and does not read before service iteration", async () => {
    const implementation = service();
    const read = vi.fn(async () => ({ done: true, value: undefined }));
    const cancel = vi.fn(async () => undefined);
    const incoming = request("archive");
    Object.defineProperty(incoming, "body", {
      value: { getReader: () => ({ read, cancel, releaseLock: vi.fn() }) },
    });
    const start = performance.now();
    mocked.load.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { profile: "local-http-p2a", origin };
    });
    implementation.receiveArchive.mockImplementation(
      async (_db, _credentials, _product, _id, source, context) => {
        expect(read).not.toHaveBeenCalled();
        expect(context.deadlineMonotonicMs).toBeLessThanOrEqual(start + 60001);
        expect(context.deadlineMonotonicMs - performance.now()).toBeLessThan(
          59995,
        );
        expect(mocked.create.mock.calls[0]?.[1]).toBe(context);
        await source.cancel();
        return dto;
      },
    );
    expect(
      (await handleImportHttp(incoming, endpoint("archive"), implementation))
        .status,
    ).toBe(200);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("passes the same absolute budget to recover database initialization and service", async () => {
    const implementation = service();
    implementation.recoverReceive.mockImplementation(
      async (_db, _credentials, _product, _id, _input, context) => {
        expect(mocked.create.mock.calls[0]?.[1]).toBe(context);
        expect(context.signal.aborted).toBe(false);
        return dto;
      },
    );
    const response = await handleImportHttp(
      request("recover", {}, JSON.stringify({ expectedStateRevision: 1 })),
      endpoint("recover"),
      implementation,
    );
    expect(response.status).toBe(200);
    expect(implementation.recoverReceive).toHaveBeenCalledTimes(1);
  });
  it("cancels raw input when budgeted database initialization expires before assignment", async () => {
    mocked.create.mockRejectedValueOnce(new StudioError("RECEIVE_TIMEOUT"));
    const implementation = service();
    const incoming = request("archive");
    const read = vi.fn();
    const cancel = vi.fn(async () => undefined);
    Object.defineProperty(incoming, "body", {
      value: { getReader: () => ({ read, cancel, releaseLock: vi.fn() }) },
    });
    const response = await handleImportHttp(
      incoming,
      endpoint("archive"),
      implementation,
    );
    expect(response.status).toBe(408);
    expect(await code(response)).toBe("RECEIVE_TIMEOUT");
    expect(mocked.create.mock.calls[0]?.[1]).toMatchObject({
      signal: expect.any(AbortSignal),
      deadlineMonotonicMs: expect.any(Number),
    });
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(implementation.receiveArchive).not.toHaveBeenCalled();
    expect(mocked.close).not.toHaveBeenCalled();
  });
  it("uses safe unknown projection and never starts input if claim is unknown", async () => {
    const implementation = service();
    implementation.receiveArchive.mockRejectedValue(
      new StudioError("WRITE_OUTCOME_UNKNOWN"),
    );
    const read = vi.fn();
    const incoming = request("archive");
    Object.defineProperty(incoming, "body", {
      value: {
        getReader: () => ({
          read,
          cancel: vi.fn(async () => undefined),
          releaseLock: vi.fn(),
        }),
      },
    });
    const response = await handleImportHttp(
      incoming,
      endpoint("archive"),
      implementation,
    );
    expect(response.status).toBe(503);
    expect(Object.keys(await response.json()).sort()).toEqual([
      "code",
      "requestId",
    ]);
    expect(read).not.toHaveBeenCalled();
  });
});
