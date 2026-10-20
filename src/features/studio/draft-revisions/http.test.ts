import { beforeEach, describe, it, expect, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { issueToken, csrfForToken } from "@/lib/security/p2a-tokens";
import { StudioError } from "@/lib/http-security/errors";
import type { ProductDraftRevisionService } from "@/features/product/draft-revisions/service-contract";
import {
  handleDraftRevisionHttp,
  revisionJsonResponse,
  type RevisionEndpoint,
} from "./http";
import { tuple, receipt, observation, base } from "./fixtures.test-support";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  close: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/runtime", () => ({ loadRuntimeConfig: mocks.load }));
vi.mock("@/lib/db/client", () => ({ createDatabase: mocks.create }));
const origin = "http://127.0.0.1:3100";
const input = () => ({
  idempotencyKey: tuple.idempotencyKey,
  expectedValidationStateRevision: tuple.expectedValidationStateRevision,
  expectedCandidateSha256: tuple.expectedCandidateSha256,
  target: tuple.target,
});
function endpoint(action: RevisionEndpoint["action"]): RevisionEndpoint {
  return {
    action,
    productId: tuple.productId,
    importId: tuple.sourceImportId,
    validationId: tuple.sourceValidationId,
    draftId: base.draftId,
  };
}
function request(
  action: RevisionEndpoint["action"],
  options: {
    body?: string;
    query?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
) {
  const token = issueToken("session").raw;
  return new Request(origin + "/api/synthetic" + (options.query ?? ""), {
    method: options.method ?? (action === "history" ? "GET" : "POST"),
    headers: {
      host: "127.0.0.1:3100",
      origin,
      cookie: `${SESSION_COOKIE}=${token}`,
      "x-csrf-token": csrfForToken(token, "session")!,
      "content-type": "application/json",
      ...options.headers,
    },
    ...(action === "history"
      ? {}
      : {
          body:
            options.body ??
            JSON.stringify(action === "resolve" ? tuple : input()),
        }),
  });
}
async function service() {
  return {
    appendReadyValidation: vi.fn(async () => ({
      created: true,
      application: await receipt(),
    })),
    resolveApplication: vi.fn(async () => await observation()),
    readHistory: vi.fn(async () => ({
      productId: tuple.productId,
      draftId: base.draftId,
      anchorRevision: 1,
      beforeRevision: 2,
      pageSize: 20,
      items: [base],
      nextBeforeRevision: null,
    })),
  } satisfies ProductDraftRevisionService;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.close.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue({ profile: "local-http-p2a", origin });
  mocks.create.mockResolvedValue({ close: mocks.close });
});
describe("injected P3-D HTTP, no real DB authority in these tests", () => {
  it("append201/replay200 use the actual returned fixed receipt without a current reread", async () => {
    const svc = await service();
    let response = await handleDraftRevisionHttp(
      request("append"),
      endpoint("append"),
      svc,
    );
    expect(response.status).toBe(201);
    expect((await response.json()).application.revision).toBe(2);
    expect(svc.readHistory).not.toHaveBeenCalled();
    expect(svc.resolveApplication).not.toHaveBeenCalled();
    svc.appendReadyValidation.mockResolvedValue({
      created: false,
      application: await receipt(),
    });
    response = await handleDraftRevisionHttp(
      request("append"),
      endpoint("append"),
      svc,
    );
    expect(response.status).toBe(200);
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
  it("resolve POST dispatches only the read-only signature; final read authorization belongs to service", async () => {
    const svc = await service(),
      response = await handleDraftRevisionHttp(
        request("resolve"),
        endpoint("resolve"),
        svc,
      );
    expect(response.status).toBe(200);
    expect(svc.resolveApplication.mock.calls[0]?.length).toBe(3);
    expect(svc.appendReadyValidation).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("private");
  });
  it.each(["append", "resolve"] as const)(
    "%s requires same-origin and session-bound CSRF before opening DB",
    async (action) => {
      for (const headers of [
        { origin: "http://foreign.invalid" },
        { "x-csrf-token": "bad" },
      ]) {
        const svc = await service(),
          response = await handleDraftRevisionHttp(
            request(action, { headers }),
            endpoint(action),
            svc,
          );
        expect(response.status).toBe(403);
        expect(mocks.create).not.toHaveBeenCalled();
      }
    },
  );
  it("resolve body Product mismatch and unknown fields reject before opening DB", async () => {
    const svc = await service();
    for (const body of [
      { ...tuple, productId: "another-product" },
      { ...tuple, extra: true },
    ]) {
      const response = await handleDraftRevisionHttp(
        request("resolve", { body: JSON.stringify(body) }),
        endpoint("resolve"),
        svc,
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["append", "resolve"] as const)(
    "%s meters full JSON request4096 exact/+1",
    async (action) => {
      const text = JSON.stringify(action === "append" ? input() : tuple),
        svc = await service();
      let response = await handleDraftRevisionHttp(
        request(action, { body: text + " ".repeat(4096 - text.length) }),
        endpoint(action),
        svc,
      );
      expect(response.status).toBe(action === "append" ? 201 : 200);
      mocks.create.mockClear();
      response = await handleDraftRevisionHttp(
        request(action, { body: text + " ".repeat(4097 - text.length) }),
        endpoint(action),
        svc,
      );
      expect(response.status).toBe(413);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("strict query/default history dispatch and malformed query never enter service", async () => {
    const svc = await service(),
      response = await handleDraftRevisionHttp(
        request("history"),
        endpoint("history"),
        svc,
      );
    expect(response.status).toBe(200);
    expect(svc.readHistory.mock.calls[0]?.at(-1)).toEqual({ pageSize: 20 });
    mocks.create.mockClear();
    for (const query of [
      "?pageSize=20&pageSize=20",
      "?anchorRevision=01",
      "?beforeRevision=2",
      "?x=1",
    ]) {
      expect(
        (
          await handleDraftRevisionHttp(
            request("history", { query }),
            endpoint("history"),
            svc,
          )
        ).status,
      ).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("maps unknown append failures and failed committed close conservatively, while resolve has no write UNKNOWN", async () => {
    const svc = await service();
    svc.appendReadyValidation.mockRejectedValueOnce(Error("private detail"));
    let response = await handleDraftRevisionHttp(
      request("append"),
      endpoint("append"),
      svc,
    );
    expect((await response.json()).code).toBe("WRITE_OUTCOME_UNKNOWN");
    mocks.close.mockRejectedValueOnce(Error("close"));
    response = await handleDraftRevisionHttp(
      request("append"),
      endpoint("append"),
      svc,
    );
    expect((await response.json()).code).toBe("WRITE_OUTCOME_UNKNOWN");
    svc.resolveApplication.mockRejectedValueOnce(Error("read unavailable"));
    response = await handleDraftRevisionHttp(
      request("resolve"),
      endpoint("resolve"),
      svc,
    );
    expect((await response.json()).code).toBe("STUDIO_UNAVAILABLE");
  });
  it.each([
    "DRAFT_BASE_CONFLICT",
    "DRAFT_SOURCE_ALREADY_APPLIED",
    "DRAFT_REVISION_LIMIT",
  ] as const)(
    "retains finite %s without inventing a terminal proof",
    async (code) => {
      const svc = await service();
      svc.appendReadyValidation.mockRejectedValueOnce(new StudioError(code));
      const response = await handleDraftRevisionHttp(
        request("append"),
        endpoint("append"),
        svc,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code });
    },
  );
  it("bad service binding is not published as success", async () => {
    const svc = await service();
    svc.resolveApplication.mockResolvedValueOnce({
      ...(await observation()),
      fingerprint: "f".repeat(64),
    });
    const response = await handleDraftRevisionHttp(
      request("resolve"),
      endpoint("resolve"),
      svc,
    );
    expect(response.status).toBe(503);
  });
  it("full serialized byte budgets include escaped quotes and UTF8", () => {
    for (const maximum of [65536, 131072]) {
      const prefix = '{"text":"',
        suffix = '"}',
        value = "a".repeat(maximum - prefix.length - suffix.length);
      expect(
        new TextEncoder().encode(JSON.stringify({ text: value })).byteLength,
      ).toBe(maximum);
      expect(revisionJsonResponse({ text: value }, 200, maximum).status).toBe(
        200,
      );
      expect(() =>
        revisionJsonResponse({ text: value + "a" }, 200, maximum),
      ).toThrow();
      expect(() =>
        revisionJsonResponse({ text: '"'.repeat(maximum) }, 200, maximum),
      ).toThrow();
      expect(() =>
        revisionJsonResponse({ text: "汉".repeat(maximum) }, 200, maximum),
      ).toThrow();
    }
  });
  it("time spent before route dispatch is part of the original deadline", async () => {
    const svc = await service(),
      clock = vi.spyOn(performance, "now").mockReturnValue(20000);
    try {
      const response = await handleDraftRevisionHttp(
        request("resolve"),
        endpoint("resolve"),
        svc,
        1,
      );
      expect(response.status).toBe(503);
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
});
