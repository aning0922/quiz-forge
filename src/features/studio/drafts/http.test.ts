import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { csrfForToken, issueToken } from "@/lib/security/p2a-tokens";
import { StudioError } from "@/lib/http-security/errors";
import type { ProductDraftService } from "@/features/product/drafts/service-contract";
import { DRAFT_LIMITS } from "@/features/product/drafts/contracts";
import { handleDraftHttp, draftJsonResponse, type DraftEndpoint } from "./http";
import { receipt, tuple, summary } from "./fixtures.test-support";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  close: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db/runtime", () => ({ loadRuntimeConfig: mocks.load }));
vi.mock("@/lib/db/client", () => ({ createDatabase: mocks.create }));
const origin = "http://127.0.0.1:3100";
function endpoint(action: DraftEndpoint["action"]): DraftEndpoint {
  return {
    action,
    productId: tuple.productId,
    importId: tuple.sourceImportId,
    validationId: tuple.sourceValidationId,
    draftId: summary.draftId,
    revision: "1",
    idempotencyKey: tuple.idempotencyKey,
  };
}
function request(
  action: DraftEndpoint["action"],
  options: {
    body?: string;
    headers?: Record<string, string>;
    query?: string;
  } = {},
) {
  const token = issueToken("session").raw;
  return new Request(
    origin +
      "/api/studio/products/" +
      tuple.productId +
      "/draft" +
      (options.query ?? ""),
    {
      method: action === "apply" ? "POST" : "GET",
      headers: {
        host: "127.0.0.1:3100",
        origin,
        cookie: `${SESSION_COOKIE}=${token}`,
        "x-csrf-token": csrfForToken(token, "session")!,
        "content-type": "application/json",
        ...options.headers,
      },
      ...(action === "apply"
        ? {
            body:
              options.body ??
              JSON.stringify({
                idempotencyKey: tuple.idempotencyKey,
                expectedValidationStateRevision: 4,
                expectedCandidateSha256: tuple.expectedCandidateSha256,
                target: tuple.target,
              }),
          }
        : {}),
    },
  );
}
async function service() {
  return {
    applyReadyValidation: vi.fn(async () => ({
      created: true,
      application: await receipt(),
    })),
    readDraft: vi.fn(async () => ({
      kind: "empty" as const,
      productId: tuple.productId,
    })),
    readDraftRevision: vi.fn(async () => ({
      draft: summary,
      canonicalContentText: "{}",
      assetSetText: "[]",
    })),
    readDraftApplicationByKey: vi.fn(async () => ({
      kind: "empty" as const,
      productId: tuple.productId,
      idempotencyKey: tuple.idempotencyKey,
    })),
  } satisfies ProductDraftService;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.close.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue({ profile: "local-http-p2a", origin });
  mocks.create.mockResolvedValue({ close: mocks.close });
});
describe("draft HTTP budgeted dispatch", () => {
  it("returns 201 for commit and 200 for original-key replay, without a final read", async () => {
    const svc = await service();
    let response = await handleDraftHttp(
      request("apply"),
      endpoint("apply"),
      svc,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(svc.readDraft).not.toHaveBeenCalled();
    svc.applyReadyValidation.mockResolvedValue({
      created: false,
      application: await receipt(),
    });
    response = await handleDraftHttp(request("apply"), endpoint("apply"), svc);
    expect(response.status).toBe(200);
    expect(mocks.create.mock.calls[0]![1]).toMatchObject({
      signal: expect.any(AbortSignal),
      deadlineMonotonicMs: expect.any(Number),
    });
  });
  it.each(["draft", "revision", "application"] as const)(
    "dispatches authenticated %s",
    async (action) => {
      const response = await handleDraftHttp(
        request(action),
        endpoint(action),
        await service(),
      );
      expect(response.status).toBe(200);
      expect(mocks.close).toHaveBeenCalledOnce();
    },
  );
  it.each(["query", "csrf", "extra", "over-limit", "utf8"])(
    "rejects %s before opening DB",
    async (kind) => {
      const svc = await service();
      const req = request(
        "apply",
        kind === "query"
          ? { query: "?x=1" }
          : kind === "csrf"
            ? { headers: { "x-csrf-token": "bad" } }
            : kind === "over-limit"
              ? { body: '"' + "汉".repeat(1400) + '"' }
              : kind === "utf8"
                ? { body: "{" }
                : { body: JSON.stringify({ ...tuple, extra: true }) },
      );
      const response = await handleDraftHttp(req, endpoint("apply"), svc);
      expect(response.status).toBe(
        kind === "csrf" ? 403 : kind === "over-limit" ? 413 : 400,
      );
      expect(mocks.create).not.toHaveBeenCalled();
      expect(svc.applyReadyValidation).not.toHaveBeenCalled();
    },
  );
  it("maps only pre-service opener timeout to Studio unavailable", async () => {
    const svc = await service();
    mocks.create.mockRejectedValueOnce(new StudioError("RECEIVE_TIMEOUT"));
    let response = await handleDraftHttp(
      request("apply"),
      endpoint("apply"),
      svc,
    );
    expect(await response.json()).toMatchObject({ code: "STUDIO_UNAVAILABLE" });
    expect(svc.applyReadyValidation).not.toHaveBeenCalled();
    svc.applyReadyValidation.mockRejectedValueOnce(
      new StudioError("WRITE_OUTCOME_UNKNOWN"),
    );
    response = await handleDraftHttp(request("apply"), endpoint("apply"), svc);
    expect(await response.json()).toMatchObject({
      code: "WRITE_OUTCOME_UNKNOWN",
    });
  });
  it("awaits exclusive close and never turns committed close failure into rollback", async () => {
    const svc = await service();
    mocks.close.mockRejectedValueOnce(new Error("private synthetic detail"));
    const response = await handleDraftHttp(
      request("apply"),
      endpoint("apply"),
      svc,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "WRITE_OUTCOME_UNKNOWN",
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("keeps finite source revision errors limited", async () => {
    const svc = await service();
    svc.applyReadyValidation.mockRejectedValue(
      new StudioError("DRAFT_SOURCE_CHANGED", 7),
    );
    const response = await handleDraftHttp(
      request("apply"),
      endpoint("apply"),
      svc,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "DRAFT_SOURCE_CHANGED",
      currentRevision: 7,
    });
  });
  it("measures full serialized wire bytes including escaping, never an obsolete 2MiB cap", async () => {
    const text = '\\"'.repeat(550000);
    const response = draftJsonResponse(
      { canonicalContentText: text },
      200,
      DRAFT_LIMITS.revisionResponseBytes,
    );
    expect(
      new TextEncoder().encode(await response.text()).byteLength,
    ).toBeGreaterThan(DRAFT_LIMITS.contentBytes);
    expect(() =>
      draftJsonResponse(
        { text: "汉".repeat(22000) },
        200,
        DRAFT_LIMITS.smallResponseBytes,
      ),
    ).toThrow();
  });
  it("includes time spent awaiting route params in the absolute budget", async () => {
    const svc = await service();
    const clock = vi.spyOn(performance, "now").mockReturnValue(20_000);
    let response: Response;
    try {
      response = await handleDraftHttp(
        request("apply"),
        endpoint("apply"),
        svc,
        1,
      );
    } finally {
      clock.mockRestore();
    }
    expect(response.status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
