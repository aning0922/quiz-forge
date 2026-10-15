import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkStart,
  checkValidationPage,
  checkedValidationFetch,
} from "./client";
import { dto, memoryStorage, tuple } from "./fixtures.test-support";
import {
  abandonNotStarted,
  continuePrepared,
  prepareAndStart,
  reconcilePending,
} from "./flow";
import {
  acquirePair,
  addPrepared,
  markBeforeStart,
  readPending,
} from "./pending";
const prepared = { ...tuple, validationKey: tuple.expectedValidationKey };
delete (prepared as Partial<typeof tuple>).expectedValidationKey;
const expected = {
  productId: tuple.productId,
  importId: tuple.importId,
  expectedImportStateRevision: tuple.expectedImportStateRevision,
  archiveSha256: tuple.archiveSha256,
  archiveBytes: tuple.archiveBytes,
};
const page = { items: [dto], page: 1, pageSize: 1, total: 1, hasNext: false };
const notStarted = {
  outcome: "not-started" as const,
  execution: "not-started" as const,
  productId: tuple.productId,
  importId: tuple.importId,
  expectedValidationKey: tuple.expectedValidationKey,
  expectedImportStateRevision: 7,
  code: "MEDIA_UNAVAILABLE" as const,
};
function sentStorage() {
  const storage = memoryStorage();
  addPrepared(storage, tuple);
  const release = acquirePair(tuple);
  try {
    markBeforeStart(storage, tuple);
  } finally {
    release();
  }
  return storage;
}
afterEach(() => vi.unstubAllGlobals());
describe("validation request coordination", () => {
  it("two different pairs can prepare concurrently without overwriting either pending entry", async () => {
    const storage = memoryStorage();
    const other = { ...expected, productId: "other-synthetic" };
    const fetch = vi.fn(async (path: string) => {
      if (path.endsWith("prepare"))
        return Response.json({
          ...prepared,
          productId: path.includes("other-synthetic")
            ? other.productId
            : expected.productId,
        });
      throw new Error("lost start response");
    });
    vi.stubGlobal("fetch", fetch);
    const results = await Promise.allSettled([
      prepareAndStart(storage, expected, "csrf"),
      prepareAndStart(storage, other, "csrf"),
    ]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(readPending(storage)).toHaveLength(2);
    expect(readPending(storage).every((entry) => entry.mayHaveBeenSent)).toBe(
      true,
    );
    expect(
      new Set(readPending(storage).map((entry) => entry.tuple.productId)),
    ).toEqual(new Set([expected.productId, other.productId]));
  });

  it("a previous legitimate not-started response cannot abandon a later unknown invocation of the same tuple", async () => {
    const storage = memoryStorage();
    addPrepared(storage, tuple);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(notStarted)),
    );
    const previous = await continuePrepared(storage, tuple, "csrf");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(page)),
    );
    await reconcilePending(storage, tuple);
    expect(() => abandonNotStarted(storage, tuple, previous)).toThrow();
    addPrepared(storage, tuple);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("lost response");
      }),
    );
    await expect(continuePrepared(storage, tuple, "csrf")).rejects.toThrow();
    expect(() => abandonNotStarted(storage, tuple, previous)).toThrow();
    expect(readPending(storage)).toEqual([{ tuple, mayHaveBeenSent: true }]);
  });

  it("saves the complete true tuple before the first start fetch and uses separate prepare/start", async () => {
    const storage = memoryStorage();
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        paths.push(path);
        if (path.endsWith("prepare")) return Response.json(prepared);
        expect(readPending(storage)).toEqual([
          { tuple, mayHaveBeenSent: true },
        ]);
        return Response.json(
          { outcome: "record", created: true, validation: dto },
          { status: 201 },
        );
      }),
    );
    expect(
      (await prepareAndStart(storage, expected, "synthetic-csrf")).outcome,
    ).toBe("record");
    expect(paths).toHaveLength(2);
    expect(readPending(storage)).toEqual([]);
  });
  it("prevents same-pair double prepare across components before React renders", async () => {
    const storage = memoryStorage();
    let resolve!: (value: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const first = prepareAndStart(storage, expected, "csrf");
    await expect(prepareAndStart(storage, expected, "csrf")).rejects.toThrow();
    resolve(Response.json({}, { status: 503 }));
    await expect(first).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("storage corruption prevents prepare or start sends", async () => {
    const storage = memoryStorage();
    storage.value = "bad";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(prepareAndStart(storage, expected, "csrf")).rejects.toThrow();
    await expect(continuePrepared(storage, tuple, "csrf")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.value).toBe("bad");
  });
  it("readback failure sends zero start fetches", async () => {
    const storage = memoryStorage();
    addPrepared(storage, tuple);
    storage.setItem = () => {
      throw new Error("quota");
    };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(continuePrepared(storage, tuple, "csrf")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 503, 504])(
    "HTTP %s never clears an unknown request",
    async (status) => {
      const storage = memoryStorage();
      addPrepared(storage, tuple);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { code: "STUDIO_UNAVAILABLE", requestId: dto.id },
            { status },
          ),
        ),
      );
      await expect(continuePrepared(storage, tuple, "csrf")).rejects.toThrow();
      expect(readPending(storage)[0]?.mayHaveBeenSent).toBe(true);
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(continuePrepared(storage, tuple, "csrf")).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("accepts not-started only for this issued invocation and explicit abandonment", async () => {
    const storage = memoryStorage();
    addPrepared(storage, tuple);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(notStarted)),
    );
    const result = await continuePrepared(storage, tuple, "csrf");
    expect(readPending(storage)[0]?.mayHaveBeenSent).toBe(true);
    expect(() =>
      abandonNotStarted(storage, tuple, { ...notStarted }),
    ).toThrow();
    expect(abandonNotStarted(storage, tuple, result)).toBe(true);
  });
  it("GET empty remains unknown; matching durable row with a different state revision takes over", async () => {
    const storage = sentStorage();
    const fetch = vi.fn<
      (path: string, options: RequestInit) => Promise<Response>
    >(async () => Response.json({ ...page, items: [], total: 0 }));
    vi.stubGlobal("fetch", fetch);
    expect(await reconcilePending(storage, tuple)).toBeNull();
    expect(readPending(storage)).toHaveLength(1);
    expect(fetch.mock.calls[0]?.[0]).toContain(
      `?validationKey=${tuple.expectedValidationKey}&page=1&pageSize=1`,
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
    });
    fetch.mockImplementation(async () => Response.json(page));
    expect(await reconcilePending(storage, tuple)).toEqual(dto);
    expect(readPending(storage)).toEqual([]);
  });
  it.each([
    "productId",
    "importId",
    "validationKey",
    "archiveSha256",
    "archiveBytes",
    "identitySha256",
  ])("exact immutable %s mismatch retains pending", async (field) => {
    const storage = sentStorage();
    const altered = {
      ...dto,
      [field]:
        field === "archiveBytes"
          ? 124
          : field === "productId"
            ? "other"
            : field === "importId"
              ? dto.id
              : "f".repeat(64),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ...page, items: [altered] })),
    );
    await expect(reconcilePending(storage, tuple)).rejects.toThrow();
    expect(readPending(storage)).toHaveLength(1);
  });
  it("strict status and page consistency reject ambiguous responses", () => {
    expect(() =>
      checkStart(
        { outcome: "record", created: true, validation: dto },
        200,
        tuple,
      ),
    ).toThrow();
    expect(() => checkStart(notStarted, 201, tuple)).toThrow();
    for (const value of [
      { ...page, items: [dto, dto], total: 2 },
      { ...page, total: 2 },
      { ...page, hasNext: true },
      { ...page, extra: true },
    ])
      expect(() =>
        checkValidationPage(value, { ...tuple, page: 1, pageSize: 1, tuple }),
      ).toThrow();
  });
  it("network failure and invalid JSON are unknown", async () => {
    for (const fetch of [
      vi.fn(async () => {
        throw new Error("network");
      }),
      vi.fn(async () => new Response("{")),
    ]) {
      vi.stubGlobal("fetch", fetch);
      await expect(
        checkedValidationFetch(
          "/validations",
          { method: "POST" },
          () => dto,
          true,
        ),
      ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    }
  });
});
