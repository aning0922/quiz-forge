import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordBaselineFingerprint,
  sealInternalVersionFingerprint,
  type InternalReviewResolution,
  type InternalVersionResolution,
} from "@/features/product/internal-versions/contracts";
import { applyFirstDraft, reconcileDraftPending } from "../drafts/flow";
import {
  acquireDraftProduct,
  addDraftPrepared,
  markDraftBeforeSend,
  readDraftPending,
  DRAFT_PENDING_STORAGE_KEY,
} from "../drafts/pending";
import {
  tuple as first,
  receipt as firstReceipt,
} from "../drafts/fixtures.test-support";
import { applyAppendRevision } from "../draft-revisions/flow";
import {
  withRevisionProduct,
  prepareRevisionPending,
  markRevisionBeforeSend,
  REVISION_PENDING_STORAGE_KEY,
} from "../draft-revisions/pending";
import { tuple as append } from "../draft-revisions/fixtures.test-support";
import { binding, fixture, uuid, memoryStorage } from "./fixtures.test-support";
import {
  applyInternalOperation,
  retryInternalOperation,
  resolveInternalPending,
  clearConfirmedInternalPending,
  evidenceFromWrite,
  InternalOperationEpoch,
  type InternalEvidence,
} from "./flow";
import {
  INTERNAL_PENDING_KEYS,
  readInternalPending,
  InternalPendingError,
  inspectInternalPreparation,
  withInternalProduct,
  prepareInternalPending,
  markInternalBeforeSend,
} from "./pending";
import { encodeInternalPending } from "./storage";
import type { InternalRequest } from "./request";
afterEach(() => vi.unstubAllGlobals());
const envelope = (value: unknown, status = 200) =>
  Response.json({ ok: true, value }, { status });
function operation(
  kind: "review",
): Promise<Extract<InternalRequest, { operation: "review" }>>;
function operation(
  kind: "seal",
): Promise<Extract<InternalRequest, { operation: "seal" }>>;
function operation(kind: "review" | "seal"): Promise<InternalRequest>;
async function operation(kind: "review" | "seal"): Promise<InternalRequest> {
  const f = await fixture();
  return kind === "review"
    ? { operation: "review", tuple: structuredClone(binding) }
    : { operation: "seal", tuple: f.seal };
}
async function seed(
  storage: ReturnType<typeof memoryStorage>,
  request: InternalRequest,
  sent = true,
) {
  await withInternalProduct(request.tuple.productId, (lease) => {
    prepareInternalPending(lease, storage, request.operation, request.tuple);
    if (sent)
      markInternalBeforeSend(
        lease,
        storage,
        request.operation,
        request.tuple,
        false,
      );
  });
}
async function evidence(
  request: InternalRequest,
  kind: "success" | "unresolved" | "obsolete" | "used" | "capacity",
): Promise<InternalEvidence> {
  const f = await fixture();
  if (request.operation === "review") {
    const fingerprint = await recordBaselineFingerprint(request.tuple);
    let value: InternalReviewResolution;
    if (kind === "success")
      value = {
        kind: "recorded",
        binding: request.tuple,
        fingerprint,
        review: f.review,
      };
    else if (kind === "used") {
      const consumed = {
        ...f.review,
        id: uuid(90),
        binding: { ...request.tuple, idempotencyKey: uuid(91) },
      };
      consumed.fingerprint = await recordBaselineFingerprint(consumed.binding);
      value = {
        kind: "not-recorded-target-used",
        binding: request.tuple,
        fingerprint,
        observedCurrentRevision: 2,
        consumed,
      };
    } else
      value = {
        kind: kind === "obsolete" ? "not-recorded-obsolete" : "unresolved",
        binding: request.tuple,
        fingerprint,
        observedCurrentRevision: kind === "obsolete" ? 3 : 2,
      };
    return { operation: "review", value };
  }
  const fingerprint = await sealInternalVersionFingerprint(request.tuple);
  let value: InternalVersionResolution;
  if (kind === "success")
    value = {
      kind: "sealed",
      binding: request.tuple,
      fingerprint,
      version: f.version,
    };
  else if (kind === "used") {
    const consumed = {
      ...f.version,
      id: uuid(90),
      binding: { ...request.tuple, idempotencyKey: uuid(91) },
    };
    consumed.fingerprint = await sealInternalVersionFingerprint(
      consumed.binding,
    );
    value = {
      kind: "not-sealed-target-used",
      binding: request.tuple,
      fingerprint,
      observedCurrentRevision: 2,
      snapshotSha256: consumed.snapshotSha256,
      consumed,
    };
  } else if (kind === "capacity")
    value = {
      kind: "not-sealed-capacity-exhausted",
      binding: request.tuple,
      fingerprint,
      observedCurrentRevision: 2,
      limit: 100,
      occupiedCount: 100,
    };
  else
    value = {
      kind: kind === "obsolete" ? "not-sealed-obsolete" : "unresolved",
      binding: request.tuple,
      fingerprint,
      observedCurrentRevision: kind === "obsolete" ? 3 : 2,
    };
  return { operation: "seal", value };
}
describe("internal operation original-key storage and generations", () => {
  it.each(["review", "seal"] as const)(
    "%s success persists/readbacks sent before fetch and requires explicit exact removal",
    async (kind) => {
      const request = await operation(kind),
        storage = memoryStorage(),
        f = await fixture();
      const fetcher = vi.fn(async () => {
        expect(readInternalPending(storage, kind)).toEqual([
          { tuple: request.tuple, mayHaveBeenSent: true },
        ]);
        return envelope(
          kind === "review"
            ? { created: true, review: f.review }
            : { created: true, version: f.version },
          201,
        );
      });
      vi.stubGlobal("fetch", fetcher);
      const result = await applyInternalOperation(
        storage,
        request,
        "synthetic",
        () => true,
      );
      expect(readInternalPending(storage, kind)).toHaveLength(1);
      await expect(
        applyInternalOperation(storage, request, "synthetic", () => true),
      ).rejects.toBeInstanceOf(InternalPendingError);
      expect(fetcher).toHaveBeenCalledOnce();
      await clearConfirmedInternalPending(
        storage,
        request,
        evidenceFromWrite(result),
        () => true,
      );
      expect(readInternalPending(storage, kind)).toEqual([]);
    },
  );
  it.each(["lost", "409", "identity", "wrong-receipt"])(
    "preserves the review anchor after %s",
    async (failure) => {
      const request = await operation("review"),
        storage = memoryStorage(),
        f = await fixture();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (failure === "lost") throw Error("network");
          return failure === "wrong-receipt"
            ? envelope(
                {
                  created: true,
                  review: { ...f.review, fingerprint: "f".repeat(64) },
                },
                201,
              )
            : Response.json(
                {
                  code:
                    failure === "identity"
                      ? "CAPABILITY_DENIED"
                      : "DRAFT_BASE_CONFLICT",
                  requestId: uuid(99),
                },
                { status: failure === "identity" ? 403 : 409 },
              );
        }),
      );
      await expect(
        applyInternalOperation(storage, request, "synthetic", () => true),
      ).rejects.toThrow();
      expect(readInternalPending(storage, "review")).toEqual([
        { tuple: request.tuple, mayHaveBeenSent: true },
      ]);
    },
  );
  it.each(["write-failure", "readback-failure"])(
    "%s blocks fetch before a sent anchor can be trusted",
    async (kind) => {
      const request = await operation("review"),
        memory = memoryStorage();
      let writes = 0;
      const storage = {
        getItem: (key: string) =>
          kind === "readback-failure" && writes > 0
            ? null
            : memory.getItem(key),
        setItem: (key: string, text: string) => {
          writes++;
          if (kind === "write-failure") throw Error("denied");
          memory.setItem(key, text);
        },
      };
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      await expect(
        applyInternalOperation(storage, request, "synthetic", () => true),
      ).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("explicit replay never replaces key/base or lowers mayHaveBeenSent, and retains even a replay success", async () => {
    const request = await operation("review"),
      storage = memoryStorage(),
      f = await fixture();
    await seed(storage, request, false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(JSON.parse(init.body as string).idempotencyKey).toBe(
          request.tuple.idempotencyKey,
        );
        expect(readInternalPending(storage, "review")[0]!.mayHaveBeenSent).toBe(
          true,
        );
        return envelope({ created: false, review: f.review });
      }),
    );
    await retryInternalOperation(storage, request, "synthetic", () => true);
    expect(readInternalPending(storage, "review")[0]!.mayHaveBeenSent).toBe(
      true,
    );
    await expect(
      retryInternalOperation(
        storage,
        {
          ...request,
          tuple: { ...request.tuple, idempotencyKey: uuid(95) },
        } as InternalRequest,
        "synthetic",
        () => true,
      ),
    ).rejects.toThrow();
  });
  it.each(["review", "seal"] as const)(
    "%s readonly resolution needs no detail GET and cannot clear unresolved",
    async (kind) => {
      const request = await operation(kind),
        storage = memoryStorage();
      await seed(storage, request);
      const proof = await evidence(request, "unresolved");
      const fetcher = vi.fn(async (_path: string, init: RequestInit) => {
        expect(init.method).toBe("POST");
        return envelope(proof.value);
      });
      vi.stubGlobal("fetch", fetcher);
      const observed = await resolveInternalPending(
        storage,
        request,
        "synthetic",
        new AbortController().signal,
        () => true,
      );
      expect(fetcher).toHaveBeenCalledOnce();
      await expect(
        clearConfirmedInternalPending(storage, request, observed, () => true),
      ).rejects.toThrow();
      expect(readInternalPending(storage, kind)).toHaveLength(1);
    },
  );
  it.each([
    ["review", "success"],
    ["review", "obsolete"],
    ["review", "used"],
    ["seal", "success"],
    ["seal", "obsolete"],
    ["seal", "used"],
    ["seal", "capacity"],
  ] as const)(
    "strict %s/%s evidence permits only explicit local removal",
    async (kind, reason) => {
      const request = await operation(kind),
        storage = memoryStorage();
      await seed(storage, request);
      const proof = await evidence(request, reason);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => envelope(proof.value)),
      );
      const observed = await resolveInternalPending(
        storage,
        request,
        "synthetic",
        new AbortController().signal,
        () => true,
      );
      expect(readInternalPending(storage, kind)).toHaveLength(1);
      await clearConfirmedInternalPending(
        storage,
        request,
        observed,
        () => true,
      );
      expect(readInternalPending(storage, kind)).toEqual([]);
    },
  );
  it("late resolution after navigation cannot show proof or alter a replacement request", async () => {
    const request = await operation("review"),
      storage = memoryStorage();
    await seed(storage, request);
    const proof = await evidence(request, "obsolete");
    const epoch = new InternalOperationEpoch(request.tuple.productId),
      ticket = epoch.begin(request);
    let finish: ((r: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            finish = r;
          }),
      ),
    );
    const task = resolveInternalPending(
      storage,
      request,
      "synthetic",
      new AbortController().signal,
      () => epoch.accepts(ticket),
    );
    epoch.invalidate();
    const next = {
      ...request,
      tuple: { ...request.tuple, idempotencyKey: uuid(90) },
    } as InternalRequest;
    const nextTicket = epoch.begin(next);
    storage.setItem(
      INTERNAL_PENDING_KEYS.review,
      encodeInternalPending("review", [
        { tuple: next.tuple, mayHaveBeenSent: true },
      ]),
    );
    finish!(envelope(proof.value));
    await expect(task).rejects.toThrow();
    expect(epoch.accepts(ticket)).toBe(false);
    expect(epoch.accepts({ ...nextTicket })).toBe(false);
    expect(
      readInternalPending(storage, "review")[0]!.tuple.idempotencyKey,
    ).toBe(uuid(90));
  });
  it.each(["generation", "stored-key"])(
    "clear rechecks %s after asynchronous proof integrity",
    async (change) => {
      const request = await operation("review"),
        storage = memoryStorage();
      await seed(storage, request);
      const proof = await evidence(request, "success");
      let current = true;
      const task = clearConfirmedInternalPending(
        storage,
        request,
        proof,
        () => current,
      );
      if (change === "generation") current = false;
      else
        storage.setItem(
          INTERNAL_PENDING_KEYS.review,
          encodeInternalPending("review", [
            {
              tuple: { ...binding, idempotencyKey: uuid(90) },
              mayHaveBeenSent: true,
            },
          ]),
        );
      await expect(task).rejects.toThrow();
      expect(readInternalPending(storage, "review")).toHaveLength(1);
    },
  );
  it("401 cannot supply actionable evidence and keeps the original anchor", async () => {
    const request = await operation("review"),
      storage = memoryStorage();
    await seed(storage, request);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { code: "UNAUTHENTICATED", requestId: uuid(99) },
          { status: 401 },
        ),
      ),
    );
    await expect(
      resolveInternalPending(
        storage,
        request,
        "synthetic",
        new AbortController().signal,
        () => true,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(readInternalPending(storage, "review")).toHaveLength(1);
  });
});
describe("shared preparation gate and independent buckets", () => {
  it("other-bucket corruption blocks new preparation but does not hide an existing original review resolution", async () => {
    const request = await operation("review"),
      storage = memoryStorage();
    await seed(storage, request);
    storage.setItem(INTERNAL_PENDING_KEYS.seal, "{");
    expect(() =>
      inspectInternalPreparation(storage, "another-product"),
    ).toThrow();
    const proof = await evidence(request, "obsolete");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(proof.value)),
    );
    expect(
      (
        await resolveInternalPending(
          storage,
          request,
          "synthetic",
          new AbortController().signal,
          () => true,
        )
      ).value.kind,
    ).toBe("not-recorded-obsolete");
    expect(storage.getItem(INTERNAL_PENDING_KEYS.seal)).toBe("{");
    expect(readInternalPending(storage, "review")).toHaveLength(1);
  });
  it("accepts sixteen independent Product entries, freezes loaded tuples, and refuses a seventeenth without writing", async () => {
    const storage = memoryStorage();
    const entries = Array.from({ length: 16 }, (_, i) => ({
      tuple: { ...binding, productId: `synthetic-${i}` },
      mayHaveBeenSent: true,
    }));
    const text = encodeInternalPending("review", entries);
    storage.setItem(INTERNAL_PENDING_KEYS.review, text);
    const loaded = readInternalPending(storage, "review");
    expect(loaded).toHaveLength(16);
    expect(Object.isFrozen(loaded[0]!.tuple.target)).toBe(true);
    await expect(
      withInternalProduct("synthetic-17", (lease) =>
        prepareInternalPending(lease, storage, "review", {
          ...binding,
          productId: "synthetic-17",
        }),
      ),
    ).rejects.toThrow();
    expect(storage.getItem(INTERNAL_PENDING_KEYS.review)).toBe(text);
  });
  it.each(["review", "seal"] as const)(
    "%s pending blocks new legacy first/append writes without rewriting either old bucket",
    async (kind) => {
      const storage = memoryStorage(),
        request = await operation(kind);
      request.tuple.productId = first.productId;
      await seed(storage, request);
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      await expect(
        applyFirstDraft(storage, first, "synthetic"),
      ).rejects.toThrow();
      await expect(
        applyAppendRevision(storage, append, "synthetic"),
      ).rejects.toThrow();
      expect(storage.getItem(DRAFT_PENDING_STORAGE_KEY)).toBeNull();
      expect(storage.getItem(REVISION_PENDING_STORAGE_KEY)).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(["first", "append"])(
    "legacy %s unknown prevents new review/seal preparation",
    async (kind) => {
      const storage = memoryStorage();
      if (kind === "first") {
        const release = acquireDraftProduct(first.productId);
        try {
          addDraftPrepared(storage, first);
          markDraftBeforeSend(storage, first, false);
        } finally {
          release();
        }
      } else
        await withRevisionProduct(append.productId, (lease) => {
          prepareRevisionPending(lease, storage, append);
          markRevisionBeforeSend(lease, storage, append, false);
        });
      expect(() =>
        inspectInternalPreparation(storage, first.productId),
      ).toThrow();
    },
  );
  it("new unknown review blocks seal, while known legal other Products do not block preparation", async () => {
    const storage = memoryStorage(),
      request = await operation("review");
    await seed(storage, request);
    expect(() =>
      inspectInternalPreparation(storage, binding.productId),
    ).toThrow();
    expect(() =>
      inspectInternalPreparation(storage, "another-product"),
    ).not.toThrow();
    const seal = await operation("seal");
    await expect(
      withInternalProduct(binding.productId, (lease) =>
        prepareInternalPending(lease, storage, "seal", seal.tuple),
      ),
    ).rejects.toThrow();
  });
  it("all four operations use the same in-memory Product lock and stale handles cannot mutate", async () => {
    const release = acquireDraftProduct(binding.productId);
    try {
      await expect(
        withInternalProduct(binding.productId, () => true),
      ).rejects.toThrow();
    } finally {
      release();
    }
    const storage = memoryStorage(),
      request = await operation("review"),
      stale = await withInternalProduct(binding.productId, (lease) => lease);
    expect(() =>
      prepareInternalPending(stale, storage, "review", request.tuple),
    ).toThrow();
  });
  it("a corrupt new bucket blocks new preparation but not old original-key read/reconciliation", async () => {
    const storage = memoryStorage(),
      release = acquireDraftProduct(first.productId);
    try {
      addDraftPrepared(storage, first);
      markDraftBeforeSend(storage, first, false);
    } finally {
      release();
    }
    storage.setItem(INTERNAL_PENDING_KEYS.review, "{");
    const application = await firstReceipt();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ kind: "applied", application })),
    );
    expect((await reconcileDraftPending(storage, first)).kind).toBe("applied");
    expect(readDraftPending(storage)).toEqual([]);
    expect(storage.getItem(INTERNAL_PENDING_KEYS.review)).toBe("{");
  });
  it.each(["review", "seal"] as const)(
    "%s bucket is closed on unknown/duplicate/over-capacity/oversized data without normalization",
    async (kind) => {
      const request = await operation(kind);
      for (const entries of [
        [{ tuple: request.tuple, mayHaveBeenSent: true, extra: true }],
        [
          { tuple: request.tuple, mayHaveBeenSent: true },
          { tuple: request.tuple, mayHaveBeenSent: false },
        ],
        Array.from({ length: 17 }, (_, i) => ({
          tuple: { ...request.tuple, productId: `synthetic-${i}` },
          mayHaveBeenSent: true,
        })),
      ]) {
        const storage = memoryStorage(),
          text = JSON.stringify({
            schemaVersion: INTERNAL_PENDING_KEYS[kind],
            entries,
          });
        storage.setItem(INTERNAL_PENDING_KEYS[kind], text);
        expect(() => readInternalPending(storage, kind)).toThrow();
        expect(storage.getItem(INTERNAL_PENDING_KEYS[kind])).toBe(text);
      }
      const storage = memoryStorage(),
        text = "中".repeat(22000);
      storage.setItem(INTERNAL_PENDING_KEYS[kind], text);
      expect(() => readInternalPending(storage, kind)).toThrow();
      expect(storage.getItem(INTERNAL_PENDING_KEYS[kind])).toBe(text);
    },
  );
});
