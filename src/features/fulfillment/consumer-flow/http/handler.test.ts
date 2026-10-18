import { expect, it, vi } from "vitest";
import { normalizeRuntimeConfig } from "@/lib/db/runtime";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import {
  createConsumerToken,
  consumerCsrfForGrant,
  CONSUMER_COOKIE_NAME_V1,
} from "@/lib/consumer-contract/v1/credentials";
import {
  consumerAnswersSha256,
  consumerProgressSha256,
  type ConsumerSaveInput,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerHostFixtureV1,
  consumerAppliedFixtureV1,
} from "@/features/theme/consumer-v1/host.test-support";
import type {
  ConsumerFlowService,
  ConsumerRequestLifecycle,
} from "../service-contract";
import { consumerSaveResolutionSchema } from "../contracts";
import { handleConsumerHttp, type ConsumerHttpEndpoint } from "./handler";
import type { createStudioRequestBudget } from "@/lib/http-security/request-budget";
const origin = "http://127.0.0.1:3201",
  id = "a".repeat(32);
const config = normalizeRuntimeConfig({
  version: 1,
  profile: "local-http-p2a",
  purpose: "test",
  origin,
  instanceId: id,
  database: {
    host: "127.0.0.1",
    port: 55421,
    name: `qf_db_${id}`,
    user: `qf_app_${id}`,
    password: "A".repeat(43),
  },
  server: { version: 180004, address: "127.0.0.1", port: 55421 },
});
async function request(
  action: ConsumerHttpEndpoint["action"],
  body?: unknown,
  headers: Record<string, string> = {},
  query = "",
) {
  const post = [
      "exchange",
      "save",
      "resolve-save",
      "complete",
      "resolve-complete",
      "logout",
    ].includes(action),
    raw = createConsumerToken("grant");
  return new Request(origin + "/synthetic" + query, {
    method: post ? "POST" : "GET",
    headers: {
      host: "127.0.0.1:3201",
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      cookie: `${CONSUMER_COOKIE_NAME_V1}=${raw}`,
      "x-quizforge-consumer-csrf": (await consumerCsrfForGrant(raw))!,
      "x-quizforge-consumer-exchange": "1",
      ...headers,
    },
    ...(post ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}
function dependencies(
  overrides: Partial<ConsumerFlowService> = {},
  failClose = false,
) {
  let clock!: ReturnType<typeof createStudioRequestBudget>,
    transferred = false;
  const close = vi.fn(async () => {
    if (!transferred) clock.dispose();
    if (failClose) throw Error("private close fault");
  });
  const owner: ConsumerRequestLifecycle = {
    closeIfNotTransferred: close,
    resourceBody: vi.fn((bytes) => {
      transferred = true;
      return new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes);
        },
        cancel() {
          clock.dispose();
        },
      });
    }),
  };
  const missing = async (): Promise<never> => {
    throw Error("unexpected synthetic service method");
  };
  const service: ConsumerFlowService = {
    exchange: missing,
    readSession: missing,
    readEntry: missing,
    save: missing,
    resolveSave: missing,
    complete: missing,
    resolveComplete: missing,
    readReport: missing,
    readResource: missing,
    logout: missing,
    ...overrides,
  };
  return {
    owner,
    close,
    clock: () => clock,
    createOwner: vi.fn(
      (_config, c: ReturnType<typeof createStudioRequestBudget>) => {
        clock = c;
        return owner;
      },
    ),
    createService: vi.fn(() => service),
    loadConfig: async () => config,
  };
}
it("rejects source, cookie, CSRF, query and body scope before constructing any owner", async () => {
  const f = await consumerHostFixtureV1(),
    deps = dependencies();
  for (const req of [
    await request("session", undefined, { "sec-fetch-site": "" }),
    await request("session", undefined, { cookie: "" }),
    await request("logout", {}, { "x-quizforge-consumer-csrf": "" }),
    await request("logout", { extra: true }),
    await request("session", undefined, {}, "?unknown=1"),
  ]) {
    const response = await handleConsumerHttp(
      req,
      {
        action: req.method === "POST" ? "logout" : "session",
        sessionId: f.session.sessionId,
      },
      deps,
    );
    expect([400, 401, 403]).toContain(response.status);
  }
  expect(deps.createOwner).not.toHaveBeenCalled();
});
it("uses one original clock and owner, validates session facts and closes before returning JSON", async () => {
  const f = await consumerHostFixtureV1(),
    readSession = vi.fn(async () => f.view),
    deps = dependencies({ readSession }),
    start = performance.now();
  const response = await handleConsumerHttp(
    await request("session"),
    { action: "session", sessionId: f.session.sessionId },
    deps,
    start,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(f.view);
  expect(deps.createOwner).toHaveBeenCalledOnce();
  expect(deps.createService).toHaveBeenCalledWith(deps.owner);
  expect(deps.clock().budget.deadlineMonotonicMs).toBe(start + 15000);
  expect(deps.close).toHaveBeenCalledTimes(2);
  expect(response.headers.get("Cache-Control")).toContain("private, no-store");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
});
it("exchange serializes only result, with the grant exclusively in a path-scoped cookie", async () => {
  const f = await consumerHostFixtureV1(),
    raw = createConsumerToken("grant"),
    result = {
      schemaVersion: "quizforge.consumer-exchange.v1" as const,
      session: f.session,
      destination: "play" as const,
    };
  const deps = dependencies({
    exchange: vi.fn(async () => ({ result, cookieGrantToken: raw })),
  });
  const response = await handleConsumerHttp(
    await request("exchange", { rawKey: createConsumerToken("access-key") }),
    { action: "exchange" },
    deps,
  );
  const text = await response.text();
  expect(JSON.parse(text)).toEqual(result);
  expect(text).not.toContain(raw);
  expect(response.headers.get("Set-Cookie")).toContain(
    `Path=/play/${f.session.sessionId}; HttpOnly; SameSite=Strict`,
  );
});
it("a known write with a failed response verification or actual close returns UNKNOWN", async () => {
  const f = await consumerHostFixtureV1(),
    logout = vi.fn(async () => {}),
    deps = dependencies({ logout }, true);
  const response = await handleConsumerHttp(
    await request("logout"),
    { action: "logout", sessionId: f.session.sessionId },
    deps,
  );
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe("OUTCOME_UNKNOWN");
  expect(response.headers.get("Set-Cookie")).toBeNull();
  expect(deps.close).toHaveBeenCalledTimes(2);
  const result = {
    schemaVersion: "quizforge.consumer-exchange.v1" as const,
    session: f.session,
    destination: "play" as const,
    rawKey: "synthetic-secret-must-not-escape",
  };
  const malformed = await handleConsumerHttp(
    await request("exchange", { rawKey: createConsumerToken("access-key") }),
    { action: "exchange" },
    dependencies({
      exchange: async () => ({
        result,
        cookieGrantToken: createConsumerToken("grant"),
      }),
    }),
  );
  const fact = await malformed.text();
  expect(JSON.parse(fact).code).toBe("OUTCOME_UNKNOWN");
  expect(fact).not.toContain("synthetic-secret");
  expect(malformed.headers.get("Set-Cookie")).toBeNull();
});
it("passes exact resource bytes once to the same owner and retains its timer after handler return", async () => {
  const f = await consumerHostFixtureV1(),
    bytes = new Uint8Array([1, 2]),
    deps = dependencies({
      readResource: async () => ({ bytes, mediaType: "image/png" }),
    });
  const query =
    "?resourceId=scene&resourceVersion=1.0.0&sha256=" + "a".repeat(64);
  const response = await handleConsumerHttp(
    await request("resource", undefined, {}, query),
    { action: "resource", sessionId: f.session.sessionId },
    deps,
  );
  expect(response.status).toBe(200);
  expect(deps.owner.resourceBody).toHaveBeenCalledExactlyOnceWith(bytes);
  expect(deps.clock().budget.signal.aborted).toBe(false);
  const reader = response.body!.getReader();
  expect((await reader.read()).value).toBe(bytes);
  await reader.cancel();
  expect(deps.close).toHaveBeenCalledTimes(2);
});
it("does not call the service for duplicate resource selectors or a wrong answer digest", async () => {
  const f = await consumerHostFixtureV1(),
    deps = dependencies();
  const query =
    "?resourceId=scene&resourceId=other&resourceVersion=1.0.0&sha256=" +
    "a".repeat(64);
  expect(
    (
      await handleConsumerHttp(
        await request("resource", undefined, {}, query),
        { action: "resource", sessionId: f.session.sessionId },
        deps,
      )
    ).status,
  ).toBe(400);
  const input = {
    binding: {
      schemaVersion: "quizforge.consumer-save.v1",
      session: f.session,
      expectedStateRevision: 0,
      consumerStateAnswersSha256: "f".repeat(64),
      progressSha256: f.initial.progressSha256,
    },
    answers: [],
    progress: { questionId: null },
  };
  expect(
    (
      await handleConsumerHttp(
        await request("save", input),
        { action: "save", sessionId: f.session.sessionId },
        deps,
      )
    ).status,
  ).toBe(400);
  expect(deps.createOwner).not.toHaveBeenCalled();
});
it("verifies exact save resolution and preserves finite service errors without fault text", async () => {
  const f = await consumerHostFixtureV1();
  const input: ConsumerSaveInput = {
    binding: {
      schemaVersion: "quizforge.consumer-save.v1",
      session: f.session,
      expectedStateRevision: 0,
      consumerStateAnswersSha256: await consumerAnswersSha256([]),
      progressSha256: await consumerProgressSha256({ questionId: null }),
    },
    answers: [],
    progress: { questionId: null },
  };
  const save = vi.fn<ConsumerFlowService["save"]>(async () =>
    consumerSaveResolutionSchema.parse(await consumerAppliedFixtureV1(input)),
  );
  const response = await handleConsumerHttp(
    await request("save", input),
    { action: "save", sessionId: f.session.sessionId },
    dependencies({ save }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).kind).toBe("applied-current");
  const denied = await handleConsumerHttp(
    await request("session"),
    { action: "session", sessionId: f.session.sessionId },
    dependencies({
      readSession: async () => {
        throw new ConsumerError("ACCESS_DENIED");
      },
    }),
  );
  expect(denied.status).toBe(401);
  expect((await denied.json()).code).toBe("ACCESS_DENIED");
});
