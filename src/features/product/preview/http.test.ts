import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { csrfForToken, issueToken } from "@/lib/security/p2a-tokens";
import { StudioError } from "@/lib/http-security/errors";
import { handlePreviewHttp, previewEndpointScope } from "./http";
import { PREVIEW_FONT, PREVIEW_RENDERER } from "./descriptor";
import { previewHttpErrorSchema } from "./contracts";
import type { ProductPreviewService } from "./service-contract";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  close: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db/runtime", () => ({ loadRuntimeConfig: mocks.load }));
vi.mock("@/lib/db/client", () => ({ createDatabase: mocks.create }));
const origin = "http://127.0.0.1:3100",
  scope = {
    productId: "synthetic-product",
    draftId: "11111111-1111-4111-8111-111111111111",
    revision: "1",
  };
const requestId = "22222222-2222-4222-8222-222222222222";
const body = () => ({
  binding: {
    ...scope,
    revision: 1,
    canonicalContentSha256: "a".repeat(64),
    assetSetSha256: "b".repeat(64),
    renderer: PREVIEW_RENDERER,
    font: PREVIEW_FONT,
  },
  requestId,
  answers: [{ questionId: "first", optionId: "one" }],
});
function request(
  action: "entry" | "score",
  extra: {
    headers?: Record<string, string>;
    text?: string;
    query?: string;
    signal?: AbortSignal;
    method?: string;
  } = {},
) {
  const token = issueToken("session").raw;
  return new Request(origin + "/api/preview" + (extra.query ?? ""), {
    method: extra.method ?? (action === "score" ? "POST" : "GET"),
    signal: extra.signal ?? null,
    headers: {
      host: "127.0.0.1:3100",
      origin,
      cookie: `${SESSION_COOKIE}=${token}`,
      "x-csrf-token": csrfForToken(token, "session")!,
      "content-type": "application/json",
      ...extra.headers,
    },
    ...(action === "score"
      ? { body: extra.text ?? JSON.stringify(body()) }
      : {}),
  });
}
function service(): ProductPreviewService {
  return {
    entry: vi.fn(async () => {
      throw new StudioError("PREVIEW_UNSUPPORTED");
    }),
    score: vi.fn(async () => {
      throw new StudioError("PREVIEW_INVALID_ANSWERS");
    }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ profile: "local-http-p2a", origin });
  mocks.create.mockResolvedValue({ close: mocks.close });
  mocks.close.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());
it.each([
  "origin",
  "csrf",
  "cookie",
  "query",
  "extra",
  "too-big",
  "wrong method",
])("rejects %s before opening a DB pool", async (kind) => {
  const options =
    kind === "origin"
      ? { headers: { origin: "http://foreign.invalid" } }
      : kind === "csrf"
        ? { headers: { "x-csrf-token": "bad" } }
        : kind === "cookie"
          ? { headers: { cookie: "" } }
          : kind === "query"
            ? { query: "?q=1" }
            : kind === "extra"
              ? { text: JSON.stringify({ ...body(), score: 100 }) }
              : kind === "too-big"
                ? { text: " ".repeat(98305) }
                : { method: "PUT" };
  const response = await handlePreviewHttp(
    request("score", options),
    { ...scope, action: "score" },
    service(),
  );
  const error = await response.json();
  expect(previewHttpErrorSchema.safeParse(error).success).toBe(true);
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(mocks.create).not.toHaveBeenCalled();
});
it("read-only scoring dispatch carries CSRF independently and echoes errors with a SERVER observation ID", async () => {
  const svc = service(),
    req = request("score");
  const response = await handlePreviewHttp(
      req,
      { ...scope, action: "score" },
      svc,
    ),
    error = await response.json();
  expect(error.code).toBe("PREVIEW_INVALID_ANSWERS");
  expect(error.requestId).not.toBe(requestId);
  expect(svc.score).toHaveBeenCalledWith(
    expect.any(Object),
    { sessionToken: expect.any(String), csrfToken: expect.any(String) },
    { ...scope, revision: 1 },
    body(),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(Buffer.byteLength(JSON.stringify(error))).toBeLessThanOrEqual(4096);
});
it.each(["entry", "score"] as const)(
  "%s unavailable never becomes a persistent write UNKNOWN",
  async (action) => {
    const svc = service();
    vi.mocked(svc[action]).mockRejectedValueOnce(
      Error("synthetic internal error"),
    );
    const response = await handlePreviewHttp(
      request(action),
      { ...scope, action },
      svc,
    );
    expect((await response.json()).code).toBe("STUDIO_UNAVAILABLE");
    expect(mocks.close).toHaveBeenCalledOnce();
  },
);
it("malformed full success is a finite budget/shape failure, never truncated", async () => {
  const svc = service();
  vi.mocked(svc.entry).mockResolvedValueOnce({
    binding: body().binding,
  } as Awaited<ReturnType<typeof svc.entry>>);
  const response = await handlePreviewHttp(
    request("entry"),
    { ...scope, action: "entry" },
    svc,
  );
  expect((await response.json()).code).toBe("PREVIEW_LIMIT_EXCEEDED");
});
it("cancel and original elapsed deadline close publication before dispatch", async () => {
  const canceled = await handlePreviewHttp(
    request("entry", { signal: AbortSignal.abort() }),
    { ...scope, action: "entry" },
    service(),
  );
  expect((await canceled.json()).code).toBe("PREVIEW_CANCELLED");
  const startedAt = performance.now();
  vi.spyOn(performance, "now").mockReturnValue(startedAt + 16000);
  const expired = await handlePreviewHttp(
    request("entry"),
    { ...scope, action: "entry" },
    service(),
    startedAt,
  );
  expect((await expired.json()).code).toBe("PREVIEW_TIMEOUT");
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each(["0", "01", "-1", "1e2", "2147483648", randomUUID()])(
  "route revision %s is rejected",
  (revision) => {
    expect(() => previewEndpointScope({ ...scope, revision })).toThrow(
      "INVALID_REQUEST",
    );
  },
);
