import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendDraftFingerprint,
  fingerprintInputFromAppendBinding,
} from "@/features/product/draft-revisions/contracts";
import {
  acquireDraftProduct,
  addDraftPrepared,
  DRAFT_PENDING_STORAGE_KEY,
} from "../drafts/pending";
import { applyFirstDraft } from "../drafts/flow";
import { tuple as first } from "../drafts/fixtures.test-support";
import {
  tuple,
  receipt,
  observation,
  memoryStorage,
  base,
} from "./fixtures.test-support";
import {
  applyAppendRevision,
  retryAppendRevision,
  resolvePendingRevision,
  clearResolvedRevision,
  RevisionEpoch,
} from "./flow";
import {
  REVISION_PENDING_STORAGE_KEY,
  readRevisionPending,
  withRevisionProduct,
  prepareRevisionPending,
  markRevisionBeforeSend,
} from "./pending";
afterEach(() => vi.unstubAllGlobals());
async function prepare(storage: ReturnType<typeof memoryStorage>, sent = true) {
  await withRevisionProduct(tuple.productId, (lease) => {
    prepareRevisionPending(lease, storage, tuple);
    if (sent) markRevisionBeforeSend(lease, storage, tuple, false);
  });
}
describe("separate append request anchors", () => {
  it("persists and reads back the complete sent tuple before the only POST", async () => {
    const storage = memoryStorage(),
      application = await receipt();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        expect(readRevisionPending(storage)[0]).toEqual({
          tuple,
          mayHaveBeenSent: true,
        });
        return Response.json({ created: true, application }, { status: 201 });
      }),
    );
    await applyAppendRevision(storage, tuple, "synthetic-csrf");
    expect(readRevisionPending(storage)).toEqual([]);
    expect(storage.getItem(DRAFT_PENDING_STORAGE_KEY)).toBeNull();
  });
  it.each(["network", "empty", "finite", "wrong-binding"])(
    "retains the full original anchor after %s",
    async (kind) => {
      const storage = memoryStorage(),
        original = await receipt();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (kind === "network") throw Error("private detail");
          return kind === "finite"
            ? Response.json(
                {
                  code: "DRAFT_BASE_CONFLICT",
                  requestId: tuple.idempotencyKey,
                },
                { status: 409 },
              )
            : kind === "wrong-binding"
              ? Response.json(
                  {
                    created: true,
                    application: {
                      ...original,
                      target: {
                        ...original.target,
                        expectedAssetSetSha256: "f".repeat(64),
                      },
                    },
                  },
                  { status: 201 },
                )
              : Response.json({});
        }),
      );
      await expect(
        applyAppendRevision(storage, tuple, "synthetic-csrf"),
      ).rejects.toThrow();
      expect(readRevisionPending(storage)[0]).toEqual({
        tuple,
        mayHaveBeenSent: true,
      });
    },
  );
  it("explicit retry never changes base/source/key or lowers sent", async () => {
    const storage = memoryStorage();
    await prepare(storage);
    const application = await receipt();
    const fetcher = vi.fn(async (_path: string, options: RequestInit) => {
      const input = JSON.parse(options.body as string);
      expect(input.target).toEqual(tuple.target);
      expect(input.idempotencyKey).toBe(tuple.idempotencyKey);
      expect(readRevisionPending(storage)[0]?.mayHaveBeenSent).toBe(true);
      return Response.json({ created: false, application });
    });
    vi.stubGlobal("fetch", fetcher);
    await retryAppendRevision(storage, tuple, "synthetic-csrf");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(readRevisionPending(storage)).toEqual([]);
  });
  it("legacy unknown blocks append preparation, append pending blocks legacy preparation, both buckets remain unchanged", async () => {
    const storage = memoryStorage(),
      release = acquireDraftProduct(first.productId);
    addDraftPrepared(storage, first);
    release();
    const before = storage.getItem(DRAFT_PENDING_STORAGE_KEY),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      applyAppendRevision(storage, tuple, "synthetic-csrf"),
    ).rejects.toThrow();
    expect(storage.getItem(DRAFT_PENDING_STORAGE_KEY)).toBe(before);
    expect(fetcher).not.toHaveBeenCalled();
    const other = memoryStorage();
    await prepare(other);
    const append = other.getItem(REVISION_PENDING_STORAGE_KEY);
    await expect(
      applyFirstDraft(other, first, "synthetic-csrf"),
    ).rejects.toThrow();
    expect(other.getItem(REVISION_PENDING_STORAGE_KEY)).toBe(append);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([DRAFT_PENDING_STORAGE_KEY, REVISION_PENDING_STORAGE_KEY])(
    "a corrupt %s closes new preparation without fetch or erasure",
    async (key) => {
      const storage = memoryStorage();
      storage.setItem(key, "{broken");
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      await expect(
        applyAppendRevision(storage, tuple, "synthetic-csrf"),
      ).rejects.toThrow();
      expect(storage.getItem(key)).toBe("{broken");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("uses the same legacy Product gate and closes stale handle mutations", async () => {
    const storage = memoryStorage(),
      release = acquireDraftProduct(tuple.productId);
    await expect(prepare(storage)).rejects.toThrow();
    release();
    let later: (() => void) | undefined;
    await withRevisionProduct(tuple.productId, (lease) => {
      later = () => prepareRevisionPending(lease, storage, tuple);
    });
    expect(() => later!()).toThrow();
  });
  it("failed readback or quota failure causes zero POST and never rewrites old storage", async () => {
    const storage = memoryStorage(),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const failing = {
      getItem: storage.getItem,
      setItem: () => {
        throw Error("quota");
      },
    };
    await expect(
      applyAppendRevision(failing, tuple, "synthetic-csrf"),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe("resolve evidence requires explicit exact local removal", () => {
  it("unresolved and obsolete reads alone never remove sent anchors", async () => {
    for (const kind of ["unresolved", "not-applied-obsolete"] as const) {
      const storage = memoryStorage();
      await prepare(storage);
      const before = storage.getItem(REVISION_PENDING_STORAGE_KEY),
        result = await observation(kind);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(result)),
      );
      expect(
        (
          await resolvePendingRevision(
            storage,
            tuple,
            "synthetic-csrf",
            new AbortController().signal,
          )
        ).kind,
      ).toBe(kind);
      expect(storage.getItem(REVISION_PENDING_STORAGE_KEY)).toBe(before);
    }
  });
  it("only a matching terminal proof can remove; unresolved, another generation or another tuple cannot", async () => {
    const storage = memoryStorage();
    await prepare(storage);
    await expect(
      clearResolvedRevision(storage, tuple, await observation(), () => true),
    ).rejects.toThrow();
    await expect(
      clearResolvedRevision(
        storage,
        tuple,
        await observation("not-applied-obsolete"),
        () => false,
      ),
    ).rejects.toThrow();
    expect(readRevisionPending(storage)).toHaveLength(1);
    const proof = await observation("not-applied-obsolete");
    await clearResolvedRevision(storage, tuple, proof, () => true);
    expect(readRevisionPending(storage)).toEqual([]);
    const newer = {
      ...tuple,
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
    };
    await withRevisionProduct(tuple.productId, (lease) =>
      prepareRevisionPending(lease, storage, newer),
    );
    await expect(
      clearResolvedRevision(storage, tuple, proof, () => true),
    ).rejects.toThrow();
    expect(readRevisionPending(storage)[0]?.tuple.idempotencyKey).toBe(
      newer.idempotencyKey,
    );
  });
  it("requires immutable source-used consumer facts and complete binding, never a bare conflict code", async () => {
    const storage = memoryStorage(),
      used = { ...tuple, sourceImportId: base.sourceImportId };
    await withRevisionProduct(used.productId, (lease) => {
      prepareRevisionPending(lease, storage, used);
      markRevisionBeforeSend(lease, storage, used, false);
    });
    const proof = {
      kind: "not-applied-source-used" as const,
      binding: used,
      fingerprint: await appendDraftFingerprint(
        fingerprintInputFromAppendBinding(used),
      ),
      base,
      observedCurrentRevision: 1,
      proof: {
        reason: "source-import" as const,
        consumed: base,
        consumingIdempotencyKey: "88888888-8888-4888-8888-888888888888",
      },
    };
    await expect(
      clearResolvedRevision(
        storage,
        used,
        {
          ...proof,
          proof: {
            ...proof.proof,
            consumingIdempotencyKey: used.idempotencyKey,
          },
        },
        () => true,
      ),
    ).rejects.toThrow();
    await clearResolvedRevision(storage, used, proof, () => true);
    expect(readRevisionPending(storage)).toEqual([]);
  });
  it("late tickets, clones and tickets superseded by authorization failure never regain UI state", () => {
    const epoch = new RevisionEpoch(tuple.productId),
      first = epoch.begin(tuple);
    expect(epoch.accepts(first)).toBe(true);
    expect(epoch.accepts({ ...first })).toBe(false);
    epoch.begin(tuple);
    expect(epoch.accepts(first)).toBe(false);
    const last = epoch.begin(tuple);
    epoch.invalidate();
    expect(epoch.accepts(last)).toBe(false);
  });
});
