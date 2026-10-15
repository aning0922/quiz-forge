import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyFirstDraft,
  reconcileDraftPending,
  retryOriginalDraft,
} from "./flow";
import {
  acquireDraftProduct,
  addDraftPrepared,
  markDraftBeforeSend,
  readDraftPending,
  DRAFT_PENDING_STORAGE_KEY,
} from "./pending";
import { memoryStorage, receipt, tuple } from "./fixtures.test-support";
afterEach(() => vi.unstubAllGlobals());
function prepared(sent = true) {
  const storage = memoryStorage(),
    release = acquireDraftProduct(tuple.productId);
  try {
    addDraftPrepared(storage, tuple);
    if (sent) markDraftBeforeSend(storage, tuple, false);
  } finally {
    release();
  }
  return storage;
}
describe("draft original-key pending flow", () => {
  it("persists/readbacks sent before fetch and clears only full matching successful receipt", async () => {
    const storage = memoryStorage(),
      application = await receipt();
    const fetcher = vi.fn(async () => {
      expect(readDraftPending(storage)[0]).toEqual({
        tuple,
        mayHaveBeenSent: true,
      });
      return Response.json({ created: true, application }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetcher);
    await applyFirstDraft(storage, tuple, "synthetic-csrf");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(readDraftPending(storage)).toEqual([]);
  });
  it.each(["empty", "finite", "broken", "wrong-tuple", "wrong-fingerprint"])(
    "retains sent anchor for %s",
    async (kind) => {
      const storage = prepared(),
        app = await receipt();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          kind === "empty"
            ? Response.json({
                kind: "empty",
                productId: tuple.productId,
                idempotencyKey: tuple.idempotencyKey,
              })
            : kind === "finite"
              ? Response.json(
                  {
                    code: "DRAFT_ALREADY_EXISTS",
                    requestId: crypto.randomUUID(),
                  },
                  { status: 409 },
                )
              : kind === "broken"
                ? new Response("{", {
                    headers: { "content-type": "application/json" },
                  })
                : Response.json({
                    kind: "applied",
                    application: {
                      ...app,
                      ...(kind === "wrong-tuple"
                        ? { expectedValidationStateRevision: 5 }
                        : { fingerprint: "c".repeat(64) }),
                    },
                  }),
        ),
      );
      try {
        await reconcileDraftPending(storage, tuple);
      } catch {}
      expect(readDraftPending(storage)).toEqual([
        { tuple, mayHaveBeenSent: true },
      ]);
    },
  );
  it("explicit replay preserves key and frozen payload, including a prepared anchor", async () => {
    const storage = prepared(false),
      app = await receipt();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({
        idempotencyKey: tuple.idempotencyKey,
        expectedValidationStateRevision: 4,
        expectedCandidateSha256: tuple.expectedCandidateSha256,
        target: tuple.target,
      });
      expect(readDraftPending(storage)[0]!.mayHaveBeenSent).toBe(true);
      return Response.json({ created: false, application: app });
    });
    vi.stubGlobal("fetch", fetcher);
    await retryOriginalDraft(storage, tuple, "synthetic-csrf");
    expect(readDraftPending(storage)).toEqual([]);
  });
  it("does not send after storage readback fails; never removes or replaces the original anchor", async () => {
    const storage = prepared(),
      original = storage.getItem(DRAFT_PENDING_STORAGE_KEY);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    storage.setItem = () => {
      throw new Error("synthetic storage failure");
    };
    await expect(
      retryOriginalDraft(storage, tuple, "synthetic"),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.getItem(DRAFT_PENDING_STORAGE_KEY)).toBe(original);
  });
  it("gates concurrent same-product calls synchronously and rejects a fresh key while pending", async () => {
    const storage = prepared();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    await expect(
      applyFirstDraft(
        storage,
        { ...tuple, idempotencyKey: crypto.randomUUID() },
        "synthetic",
      ),
    ).rejects.toThrow();
    const release = acquireDraftProduct(tuple.productId);
    try {
      await expect(reconcileDraftPending(storage, tuple)).rejects.toThrow();
    } finally {
      release();
    }
    expect(readDraftPending(storage)[0]!.tuple).toEqual(tuple);
  });
  it("rejects duplicate product entries and oversized corrupt buckets without normalization", () => {
    const storage = prepared(),
      text = storage.getItem(DRAFT_PENDING_STORAGE_KEY)!;
    const bucket = JSON.parse(text);
    bucket.entries.push(bucket.entries[0]);
    storage.setItem(DRAFT_PENDING_STORAGE_KEY, JSON.stringify(bucket));
    expect(() => readDraftPending(storage)).toThrow();
    storage.setItem(DRAFT_PENDING_STORAGE_KEY, " ".repeat(65537));
    expect(() => readDraftPending(storage)).toThrow();
  });
  it("allows exactly sixteen distinct Product anchors and refuses a seventeenth without mutating the bucket", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 16; index++) {
      const item = { ...tuple, productId: `synthetic-draft-${index}` },
        release = acquireDraftProduct(item.productId);
      try {
        addDraftPrepared(storage, item);
      } finally {
        release();
      }
    }
    const before = storage.getItem(DRAFT_PENDING_STORAGE_KEY),
      item = { ...tuple, productId: "synthetic-draft-overflow" },
      release = acquireDraftProduct(item.productId);
    try {
      expect(() => addDraftPrepared(storage, item)).toThrow();
    } finally {
      release();
    }
    expect(storage.getItem(DRAFT_PENDING_STORAGE_KEY)).toBe(before);
    expect(readDraftPending(storage)).toHaveLength(16);
  });
});
