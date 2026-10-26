import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { csrfForToken, issueToken } from "@/lib/security/p2a-tokens";
import { handleCurrentPreviewHttp } from "./http-v2";
import { temporaryPreviewFixtureV2 } from "./v2.test-support";
import type { currentProductPreviewService } from "./service-v2";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  close: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db/runtime", () => ({ loadRuntimeConfig: mocks.load }));
vi.mock("@/lib/db/client", () => ({ createDatabase: mocks.create }));
let f: Awaited<ReturnType<typeof temporaryPreviewFixtureV2>>;
const origin = "http://127.0.0.1:3511";
beforeAll(async () => {
  f = await temporaryPreviewFixtureV2();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ profile: "local-http-p2a", origin });
  mocks.create.mockResolvedValue({ close: mocks.close });
  mocks.close.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());
function request(
  action: "entry" | "score",
  input: unknown = f.request,
  csrf = true,
) {
  const token = issueToken("session").raw;
  return new Request(origin + "/api/synthetic/preview/current", {
    method: action === "score" ? "POST" : "GET",
    headers: {
      host: "127.0.0.1:3511",
      origin,
      cookie: `${SESSION_COOKIE}=${token}`,
      "x-csrf-token": csrf ? csrfForToken(token, "session")! : "invalid",
      "content-type": "application/json",
    },
    ...(action === "score" ? { body: JSON.stringify(input) } : {}),
  });
}
function service(): typeof currentProductPreviewService {
  return {
    entry: vi.fn(async () => ({ mode: "structured" as const, value: f.entry })),
    score: vi.fn(async () => f.result),
  };
}
it("uses the new current/read-only score routes and closes its owned pool before releasing DTOs", async () => {
  const svc = service(),
    endpoint = { ...f.scope, revision: "1" };
  const entry = await handleCurrentPreviewHttp(
    request("entry"),
    { ...endpoint, action: "entry" },
    performance.now(),
    svc,
  );
  expect(entry.status).toBe(200);
  expect((await entry.json()).value.mode).toBe("structured");
  expect(mocks.close).toHaveBeenCalledTimes(1);
  const score = await handleCurrentPreviewHttp(
    request("score"),
    { ...endpoint, action: "score" },
    performance.now(),
    svc,
  );
  expect(score.status).toBe(200);
  expect((await score.json()).value.kind).toBe("temporary-preview");
  expect(score.headers.get("cache-control")).toContain("private, no-store");
  expect(mocks.close).toHaveBeenCalledTimes(2);
  expect(svc.score).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ csrfToken: expect.any(String) }),
    f.scope,
    expect.objectContaining({ matchingContext: f.request.matchingContext }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
it.each(["missing preference", "csrf", "extra consumer state"])(
  "rejects %s before opening a pool",
  async (kind) => {
    const input =
      kind === "missing preference"
        ? { ...f.request, matchingContext: null }
        : kind === "extra consumer state"
          ? { ...f.request, completionKey: "forbidden" }
          : f.request;
    const response = await handleCurrentPreviewHttp(
      request("score", input, kind !== "csrf"),
      { ...f.scope, revision: "1", action: "score" },
      performance.now(),
      service(),
    );
    expect(response.status).toBe(kind === "csrf" ? 403 : 400);
    expect(mocks.create).not.toHaveBeenCalled();
  },
);
