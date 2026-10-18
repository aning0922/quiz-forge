import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordBaselineFingerprint,
  sealInternalVersionFingerprint,
  type InternalReviewState,
} from "@/features/product/internal-versions/contracts";
import {
  internalReviewUrl,
  internalVersionsUrl,
  internalVersionUrl,
} from "@/features/product/internal-versions/urls";
import {
  binding,
  fixture,
  uuid,
  sha,
  renderer,
  engine,
} from "./fixtures.test-support";
import {
  checkedInternalFetch,
  validInternalHttpError,
  prepareRecordBaselineRequest,
  prepareSealInternalRequest,
  resolveInternalReview,
  resolveInternalVersion,
  readInternalReviewState,
  readInternalVersions,
  readInternalVersion,
  checkReviewResult,
  checkSealResult,
  checkReviewResolution,
  checkVersionResolution,
} from "./client";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const signal = () => new AbortController().signal;
const scope = {
  productId: binding.productId,
  draftId: binding.target.draftId,
  revision: binding.target.revision,
};
const envelope = (value: unknown, status = 200) =>
  Response.json({ ok: true, value }, { status });
async function state(): Promise<InternalReviewState> {
  const f = await fixture();
  return {
    productId: binding.productId,
    target: binding.target,
    observedCurrentRevision: 2,
    review: f.review,
    baseline: binding.baseline,
    rendererChoices: [{ renderer, capability: "studio-internal-preview" }],
    engine,
  };
}
function metadata(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    id: f.version.id,
    slot: 1,
    productId: binding.productId,
    target: binding.target,
    reviewId: f.review.id,
    reviewSha256: f.review.reviewSha256,
    snapshotSha256: f.version.snapshotSha256,
    renderer,
    rendererCapability: "studio-internal-preview",
    engine,
    purpose: "internal-test",
    publicationApproved: false,
    createdAt: f.version.createdAt,
    createdBy: f.version.createdBy,
  };
}
describe("exact internal review/version browser transport", () => {
  it("sends only frozen machine input to exact protected endpoints and verifies actual receipt hashes", async () => {
    const f = await fixture();
    const observed: { url: unknown; options: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        observed.push({ url, options });
        return observed.length === 1
          ? envelope({ created: true, review: f.review }, 201)
          : envelope({ created: false, version: f.version });
      }),
    );
    const review = await prepareRecordBaselineRequest(
      binding,
      "synthetic-csrf",
    )();
    const sealed = await prepareSealInternalRequest(f.seal, "synthetic-csrf")();
    expect(review.review.id).toBe(f.review.id);
    expect(sealed.version.id).toBe(f.version.id);
    expect(observed.map((x) => x.url)).toEqual([
      internalReviewUrl(scope),
      internalVersionsUrl(binding.productId),
    ]);
    for (const { options } of observed) {
      expect(options).toMatchObject({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { "x-csrf-token": "synthetic-csrf" },
      });
      expect(JSON.parse(options.body as string)).not.toHaveProperty(
        "productId",
      );
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    expect(Object.isFrozen(sealed.version.binding.target)).toBe(true);
  });
  it.each(["fingerprint", "facts-sha", "tuple", "status"])(
    "rejects a review %s mismatch",
    async (kind) => {
      const f = await fixture();
      if (kind === "fingerprint") f.review.fingerprint = sha("f");
      if (kind === "facts-sha") f.review.reviewSha256 = sha("f");
      const expected =
        kind === "tuple" ? { ...binding, idempotencyKey: uuid(90) } : binding;
      await expect(
        checkReviewResult(
          { ok: true, value: { created: true, review: f.review } },
          kind === "status" ? 200 : 201,
          expected,
        ),
      ).rejects.toThrow();
    },
  );
  it("does not accept a forged seal fingerprint or another renderer binding", async () => {
    const f = await fixture();
    f.version.fingerprint = sha("a");
    await expect(
      checkSealResult(
        { ok: true, value: { created: true, version: f.version } },
        201,
        f.seal,
      ),
    ).rejects.toThrow();
    f.version.fingerprint = await sealInternalVersionFingerprint(f.seal);
    await expect(
      checkSealResult(
        { ok: true, value: { created: true, version: f.version } },
        201,
        { ...f.seal, renderer: { ...renderer, entrySha256: sha("a") } },
      ),
    ).rejects.toThrow();
  });
  it.each(["review", "seal"] as const)(
    "resolve %s uses a read-only POST of the entire original binding",
    async (operation) => {
      const f = await fixture();
      const tuple = operation === "review" ? binding : f.seal;
      const fp =
        operation === "review"
          ? await recordBaselineFingerprint(binding)
          : await sealInternalVersionFingerprint(f.seal);
      const fetcher = vi.fn(async (path: string, options: RequestInit) => {
        expect(path).toMatch(
          /internal-(?:review|version)-applications\/resolve$/,
        );
        expect(options.method).toBe("POST");
        return envelope({
          kind: "unresolved",
          binding: tuple,
          fingerprint: fp,
          observedCurrentRevision: 2,
        });
      });
      vi.stubGlobal("fetch", fetcher);
      const result =
        operation === "review"
          ? await resolveInternalReview(binding, "synthetic", signal())
          : await resolveInternalVersion(f.seal, "synthetic", signal());
      expect(result.kind).toBe("unresolved");
      expect(fetcher).toHaveBeenCalledOnce();
      expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(
        tuple,
      );
    },
  );
  it("checks consumed proof digests and exact original key, not ordinary 409 facts", async () => {
    const f = await fixture();
    const other = {
      ...f.review,
      binding: { ...binding, idempotencyKey: uuid(91) },
    };
    other.fingerprint = await recordBaselineFingerprint(other.binding);
    const proof = {
      kind: "not-recorded-target-used",
      binding,
      fingerprint: await recordBaselineFingerprint(binding),
      observedCurrentRevision: 2,
      consumed: other,
    };
    expect((await checkReviewResolution(proof, binding)).kind).toBe(
      "not-recorded-target-used",
    );
    other.reviewSha256 = sha("f");
    await expect(checkReviewResolution(proof, binding)).rejects.toThrow();
    await expect(
      checkVersionResolution(
        {
          kind: "not-sealed-capacity-exhausted",
          binding: f.seal,
          fingerprint: await sealInternalVersionFingerprint(f.seal),
          observedCurrentRevision: 2,
          limit: 100,
          occupiedCount: 99,
        },
        f.seal,
      ),
    ).rejects.toThrow();
  });
  it("uses only code/requestId with exact status and refuses UNKNOWN in read operations", () => {
    const error = { code: "DRAFT_SOURCE_CHANGED", requestId: uuid(1) };
    expect(validInternalHttpError(error, 409, false)).toEqual(error);
    expect(
      validInternalHttpError({ ...error, currentRevision: 9 }, 409, true),
    ).toBeUndefined();
    expect(validInternalHttpError(error, 403, true)).toBeUndefined();
    expect(
      validInternalHttpError(
        { code: "WRITE_OUTCOME_UNKNOWN", requestId: uuid(1) },
        503,
        false,
      ),
    ).toBeUndefined();
  });
  it.each(["wrong-status", "extra-field", "unknown-code", "lost-response"])(
    "retains write uncertainty for %s",
    async (kind) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (kind === "lost-response") throw Error("network");
          return Response.json(
            {
              code:
                kind === "unknown-code"
                  ? "UNREGISTERED"
                  : "DRAFT_SOURCE_CHANGED",
              requestId: uuid(1),
              ...(kind === "extra-field" ? { currentRevision: 2 } : {}),
            },
            { status: kind === "wrong-status" ? 403 : 409 },
          );
        }),
      );
      await expect(
        prepareRecordBaselineRequest(binding, "synthetic")(),
      ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    },
  );
  it("validates fixed review state scope and embedded receipt integrity", async () => {
    const s = await state();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(s)),
    );
    expect((await readInternalReviewState(scope, signal())).review?.id).toBe(
      s.review!.id,
    );
    await expect(
      readInternalReviewState({ ...scope, revision: 1 }, signal()),
    ).rejects.toMatchObject({ code: "STUDIO_UNAVAILABLE" });
    s.review!.reviewSha256 = sha("f");
    await expect(
      readInternalReviewState(scope, signal()),
    ).rejects.toMatchObject({ code: "STUDIO_UNAVAILABLE" });
  });
  it("keeps version metadata separate and verifies the full fixed detail snapshot digest", async () => {
    const f = await fixture();
    const fetcher = vi.fn(async (url: string) =>
      url === internalVersionUrl(binding.productId, f.version.id)
        ? envelope({ version: f.version, snapshot: f.snapshot })
        : envelope({ productId: binding.productId, versions: [metadata(f)] }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await readInternalVersions(binding.productId, signal())).versions[0]!
        .target.revision,
    ).toBe(2);
    expect(
      (await readInternalVersion(binding.productId, f.version.id, signal()))
        .snapshot,
    ).toEqual(f.snapshot);
    f.snapshot.logicHash = sha("e");
    await expect(
      readInternalVersion(binding.productId, f.version.id, signal()),
    ).rejects.toMatchObject({ code: "STUDIO_UNAVAILABLE" });
    await expect(
      readInternalVersions("another-product", signal()),
    ).rejects.toMatchObject({ code: "STUDIO_UNAVAILABLE" });
  });
  it.each(["write", "read"] as const)(
    "settles a noncooperative fetch within the original %s deadline without asserting server rollback",
    async (mode) => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise(() => {})),
      );
      const task = checkedInternalFetch("/synthetic", {}, () => true, mode);
      const rejected = expect(task).rejects.toMatchObject({
        code: mode === "write" ? "WRITE_OUTCOME_UNKNOWN" : "STUDIO_UNAVAILABLE",
      });
      await vi.advanceTimersByTimeAsync(15001);
      await rejected;
    },
  );
  it("bounds async integrity work by the original deadline too", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope({})),
    );
    const task = checkedInternalFetch(
      "/synthetic",
      {},
      () => new Promise(() => {}),
      "read",
    );
    const rejected = expect(task).rejects.toMatchObject({
      code: "STUDIO_UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(15001);
    await rejected;
  });
});
