import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { issueToken, csrfForToken } from "@/lib/security/p2a-tokens";
import { StudioError } from "@/lib/http-security/errors";
import type { ProductInternalVersionService } from "@/features/product/internal-versions/service-contract";
import type { InternalVersionOwner } from "@/features/product/internal-versions/lifecycle";
import {
  handleInternalVersionHttp,
  internalJsonResponse,
  type InternalVersionEndpoint,
} from "./http";
import { binding, fixture, target, uuid } from "./fixtures.test-support";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/db/runtime", () => ({ loadRuntimeConfig: mocks.load }));
vi.mock("@/lib/db/client", () => ({ createDatabase: mocks.create }));
const origin = "http://127.0.0.1:3100";
type Action = InternalVersionEndpoint["action"];
function endpoint(action: Action): InternalVersionEndpoint {
  return {
    action,
    productId: binding.productId,
    draftId: target.draftId,
    revision: String(target.revision),
    versionId: uuid(8),
  };
}
async function request(
  action: Action,
  options: {
    body?: unknown;
    raw?: string;
    query?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
) {
  const token = issueToken("session").raw,
    f = await fixture(),
    { productId: ignoredReviewProduct, ...review } = binding,
    { productId: ignoredSealProduct, ...seal } = f.seal;
  void ignoredReviewProduct;
  void ignoredSealProduct;
  const post = ["record", "seal", "resolve-review", "resolve-version"].includes(
    action,
  );
  return new Request(origin + "/api/synthetic" + (options.query ?? ""), {
    method: options.method ?? (post ? "POST" : "GET"),
    headers: {
      host: "127.0.0.1:3100",
      origin,
      cookie: `${SESSION_COOKIE}=${token}`,
      "x-csrf-token": csrfForToken(token, "session")!,
      "content-type": "application/json",
      ...options.headers,
    },
    ...(post
      ? {
          body:
            options.raw ??
            JSON.stringify(
              options.body ??
                (action === "record"
                  ? review
                  : action === "seal"
                    ? seal
                    : action === "resolve-review"
                      ? binding
                      : f.seal),
            ),
        }
      : {}),
  });
}
async function setup() {
  const f = await fixture(),
    svc = {
      recordBaseline: vi.fn<ProductInternalVersionService["recordBaseline"]>(
        async () => ({ created: true, review: f.review }),
      ),
      sealInternalVersion: vi.fn<
        ProductInternalVersionService["sealInternalVersion"]
      >(async () => ({
        created: true,
        version: f.version,
      })),
      resolveReview: vi.fn<ProductInternalVersionService["resolveReview"]>(
        async () => ({
          kind: "recorded" as const,
          binding,
          fingerprint: f.review.fingerprint,
          review: f.review,
        }),
      ),
      resolveVersion: vi.fn<ProductInternalVersionService["resolveVersion"]>(
        async () => ({
          kind: "sealed" as const,
          binding: f.seal,
          fingerprint: f.version.fingerprint,
          version: f.version,
        }),
      ),
      readReviewState: vi.fn<ProductInternalVersionService["readReviewState"]>(
        async () => ({
          productId: binding.productId,
          target,
          observedCurrentRevision: target.revision,
          review: f.review,
          baseline: binding.baseline,
          rendererChoices: [],
          engine: null,
        }),
      ),
      readVersions: vi.fn<ProductInternalVersionService["readVersions"]>(
        async () => ({
          productId: binding.productId,
          versions: [],
        }),
      ),
      readVersion: vi.fn<ProductInternalVersionService["readVersion"]>(
        async () => ({
          version: f.version,
          snapshot: f.snapshot,
        }),
      ),
    } satisfies ProductInternalVersionService;
  let captured: InternalVersionOwner | undefined;
  const factory = vi.fn((owner: InternalVersionOwner) => {
    captured = owner;
    return svc;
  });
  return { f, svc, factory, owner: () => captured! };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ profile: "local-http-p2a", origin });
  mocks.close.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ close: mocks.close });
});
describe("P3-E HTTP boundary with injected service, no real DB/write authority", () => {
  it.each(["record", "seal"] as const)(
    "%s returns exact new201/replay200, passes original DB/budget identity and closes once",
    async (action) => {
      const s = await setup();
      for (const created of [true, false]) {
        if (action === "record")
          s.svc.recordBaseline.mockResolvedValue({
            created,
            review: s.f.review,
          });
        else
          s.svc.sealInternalVersion.mockResolvedValue({
            created,
            version: s.f.version,
          });
        const r = await handleInternalVersionHttp(
          await request(action),
          endpoint(action),
          s.factory,
        );
        expect(r.status).toBe(created ? 201 : 200);
        expect((await r.json()).value.created).toBe(created);
        const args =
          action === "record"
            ? s.svc.recordBaseline.mock.calls.at(-1)!
            : s.svc.sealInternalVersion.mock.calls.at(-1)!;
        expect(() => s.owner().assertOwns(args[0], args[4])).toThrow(); // closed by the actual owner
        const db = mocks.create.mock.results.at(-1)!;
        expect(args[0]).toBe(await db.value);
        expect(args[4]).toBe(mocks.create.mock.calls.at(-1)![1]);
      }
      expect(mocks.close).toHaveBeenCalledTimes(2);
      expect(s.svc.readReviewState).not.toHaveBeenCalled();
    },
  );
  it.each([
    "resolve-review",
    "resolve-version",
    "state",
    "list",
    "detail",
  ] as const)(
    "%s uses its actual read signature, returns bounded envelope and closes without FS work",
    async (action) => {
      const s = await setup(),
        r = await handleInternalVersionHttp(
          await request(action),
          endpoint(action),
          s.factory,
        );
      expect(r.status).toBe(200);
      expect((await r.json()).ok).toBe(true);
      expect(r.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      expect(mocks.close).toHaveBeenCalledTimes(1);
      expect(s.svc.recordBaseline).not.toHaveBeenCalled();
      expect(s.svc.sealInternalVersion).not.toHaveBeenCalled();
      if (action === "resolve-review")
        expect(s.svc.resolveReview.mock.calls[0]).toHaveLength(3);
      if (action === "resolve-version")
        expect(s.svc.resolveVersion.mock.calls[0]).toHaveLength(3);
    },
  );
  it.each(["record", "seal", "resolve-review", "resolve-version"] as const)(
    "%s requires origin and CSRF before connecting",
    async (action) => {
      for (const headers of [
        { origin: "http://foreign.invalid" },
        { "x-csrf-token": "bad" },
      ]) {
        const s = await setup(),
          r = await handleInternalVersionHttp(
            await request(action, { headers }),
            endpoint(action),
            s.factory,
          );
        expect(r.status).toBe(403);
      }
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("rejects missing session, all query strings, wrong method, malformed scope and path/body mismatch before DB", async () => {
    const s = await setup();
    expect(
      (
        await handleInternalVersionHttp(
          await request("list", { headers: { cookie: "" } }),
          endpoint("list"),
          s.factory,
        )
      ).status,
    ).toBe(401);
    for (const action of ["record", "resolve-review", "list"] as const)
      expect(
        (
          await handleInternalVersionHttp(
            await request(action, { query: "?x=1" }),
            endpoint(action),
            s.factory,
          )
        ).status,
      ).toBe(400);
    expect(
      (
        await handleInternalVersionHttp(
          await request("list", { method: "POST" }),
          endpoint("list"),
          s.factory,
        )
      ).status,
    ).toBe(400);
    for (const revision of ["01", "101", "1e0"])
      expect(
        (
          await handleInternalVersionHttp(
            await request("state"),
            { ...endpoint("state"), revision },
            s.factory,
          )
        ).status,
      ).toBe(400);
    expect(
      (
        await handleInternalVersionHttp(
          await request("record"),
          { ...endpoint("record"), revision: "1" },
          s.factory,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleInternalVersionHttp(
          await request("resolve-review", {
            body: { ...binding, productId: "another-product" },
          }),
          endpoint("resolve-review"),
          s.factory,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleInternalVersionHttp(
          await request("resolve-review", {
            body: { ...binding, extra: true },
          }),
          endpoint("resolve-review"),
          s.factory,
        )
      ).status,
    ).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["record", "seal", "resolve-review", "resolve-version"] as const)(
    "%s enforces whole request4096 bytes exact/+1",
    async (action) => {
      const s = await setup(),
        raw = await (await request(action)).text();
      expect(
        (
          await handleInternalVersionHttp(
            await request(action, { raw: raw + " ".repeat(4096 - raw.length) }),
            endpoint(action),
            s.factory,
          )
        ).status,
      ).toBe(["record", "seal"].includes(action) ? 201 : 200);
      mocks.create.mockClear();
      expect(
        (
          await handleInternalVersionHttp(
            await request(action, { raw: raw + " ".repeat(4097 - raw.length) }),
            endpoint(action),
            s.factory,
          )
        ).status,
      ).toBe(413);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("keeps finite service errors, strips legacy revision and maps unregistered errors", async () => {
    const s = await setup();
    s.svc.recordBaseline.mockRejectedValueOnce(
      new StudioError("DRAFT_SOURCE_CHANGED", 22),
    );
    let r = await handleInternalVersionHttp(
      await request("record"),
      endpoint("record"),
      s.factory,
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      code: "DRAFT_SOURCE_CHANGED",
      requestId: expect.any(String),
    });
    s.svc.recordBaseline.mockRejectedValueOnce(
      new StudioError("IMPORTS_DISABLED"),
    );
    r = await handleInternalVersionHttp(
      await request("record"),
      endpoint("record"),
      s.factory,
    );
    expect(await r.json()).toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
  });
  it("malformed write success or unknown rejection remain UNKNOWN; read/resolve never claim write UNKNOWN", async () => {
    const s = await setup();
    s.svc.recordBaseline.mockResolvedValueOnce({
      created: true,
      review: { ...s.f.review, fingerprint: "f".repeat(64) },
    });
    let r = await handleInternalVersionHttp(
      await request("record"),
      endpoint("record"),
      s.factory,
    );
    expect(await r.json()).toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    s.svc.sealInternalVersion.mockRejectedValueOnce(Error("private"));
    r = await handleInternalVersionHttp(
      await request("seal"),
      endpoint("seal"),
      s.factory,
    );
    expect(await r.json()).toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    s.svc.resolveReview.mockRejectedValueOnce(
      new StudioError("WRITE_OUTCOME_UNKNOWN"),
    );
    r = await handleInternalVersionHttp(
      await request("resolve-review"),
      endpoint("resolve-review"),
      s.factory,
    );
    expect(await r.json()).toMatchObject({ code: "STUDIO_UNAVAILABLE" });
    s.svc.readVersion.mockResolvedValueOnce({
      ...s.f,
      version: { ...s.f.version, snapshotSha256: "f".repeat(64) },
    });
    r = await handleInternalVersionHttp(
      await request("detail"),
      endpoint("detail"),
      s.factory,
    );
    expect(await r.json()).toMatchObject({ code: "STUDIO_UNAVAILABLE" });
  });
  it("rejects forged detail scope/list product and resolve digest without publishing success", async () => {
    const s = await setup();
    s.svc.readVersions.mockResolvedValueOnce({
      productId: "another-product",
      versions: [],
    });
    expect(
      (
        await handleInternalVersionHttp(
          await request("list"),
          endpoint("list"),
          s.factory,
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await handleInternalVersionHttp(
          await request("detail"),
          { ...endpoint("detail"), versionId: uuid(99) },
          s.factory,
        )
      ).status,
    ).toBe(503);
    s.svc.resolveReview.mockResolvedValueOnce({
      kind: "recorded",
      binding,
      fingerprint: "f".repeat(64),
      review: s.f.review,
    });
    expect(
      (
        await handleInternalVersionHttp(
          await request("resolve-review"),
          endpoint("resolve-review"),
          s.factory,
        )
      ).status,
    ).toBe(503);
  });
  it("failed close after write cannot become rollback; owner closes exactly once even on repeated finally", async () => {
    const s = await setup();
    mocks.close.mockRejectedValueOnce(Error("close failure"));
    const r = await handleInternalVersionHttp(
      await request("record"),
      endpoint("record"),
      s.factory,
    );
    expect(await r.json()).toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it("owner receives original connection/budget before service; pre-factory failure closes DB", async () => {
    const s = await setup(),
      factory = vi.fn((owner: InternalVersionOwner) => {
        expect(owner).toBeDefined();
        throw Error("factory failed before entry");
        return s.svc;
      });
    const r = await handleInternalVersionHttp(
      await request("record"),
      endpoint("record"),
      factory,
    );
    expect(await r.json()).toMatchObject({ code: "STUDIO_UNAVAILABLE" });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it("deadline includes pre-dispatch time and never opens DB when already expired", async () => {
    const s = await setup(),
      req = await request("list"),
      now = vi.spyOn(performance, "now").mockReturnValue(20000);
    try {
      const r = await handleInternalVersionHttp(
        req,
        endpoint("list"),
        s.factory,
        1,
      );
      expect(r.status).toBe(503);
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
  it("serialized response limits include UTF8/escaping for4K/64K/256K", () => {
    for (const max of [4096, 65536, 262144]) {
      const value = "a".repeat(max - 11);
      expect(
        new TextEncoder().encode(JSON.stringify({ text: value })).byteLength,
      ).toBe(max);
      expect(internalJsonResponse({ text: value }, 200, max).status).toBe(200);
      for (const text of [value + "a", '"'.repeat(max), "汉".repeat(max)])
        expect(() => internalJsonResponse({ text }, 200, max)).toThrow();
    }
  });
});
