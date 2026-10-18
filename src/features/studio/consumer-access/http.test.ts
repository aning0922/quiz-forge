import { expect, it, vi } from "vitest";
import { normalizeRuntimeConfig } from "@/lib/db/runtime";
import { issueToken, csrfForToken } from "@/lib/security/p2a-tokens";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { internalPlayFixture } from "@/features/product/internal-play/contracts.test-support";
import { internalPlayBindingSha256 } from "@/features/product/internal-play/contracts";
import type {
  ConsumerRequestLifecycle,
  InternalPlayService,
  AccessKeyService,
} from "@/features/fulfillment/consumer-flow/service-contract";
import type { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { newStudioIssueV1 } from "./pending";
import {
  handleStudioConsumerHttpV1 as handle,
  type StudioConsumerEndpointV1,
} from "./http";
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
function request(
  post: boolean,
  body?: unknown,
  headers: Record<string, string> = {},
  query = "",
) {
  const token = issueToken("session").raw;
  return new Request(origin + "/api/synthetic" + query, {
    method: post ? "POST" : "GET",
    headers: {
      host: "127.0.0.1:3201",
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${token}`,
      "x-csrf-token": csrfForToken(token, "session")!,
      ...headers,
    },
    ...(post ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}
function deps(
  play: Partial<InternalPlayService> = {},
  access: Partial<AccessKeyService> = {},
  failClose = false,
) {
  let clock!: ReturnType<typeof createStudioRequestBudget>;
  const close = vi.fn(async () => {
    clock.dispose();
    if (failClose) throw Error("synthetic private close fault");
  });
  const owner: ConsumerRequestLifecycle = {
    closeIfNotTransferred: close,
    resourceBody: () => {
      throw Error("unexpected body transfer");
    },
  };
  const missing = async (): Promise<never> => {
    throw Error("unexpected synthetic method");
  };
  const playService: InternalPlayService = {
    create: missing,
    resolve: missing,
    read: missing,
    list: missing,
    ...play,
  };
  const accessService: AccessKeyService = {
    issue: missing,
    resolveIssue: missing,
    voidUnused: missing,
    resolveVoid: missing,
    read: missing,
    list: missing,
    ...access,
  };
  return {
    owner,
    close,
    clock: () => clock,
    loadConfig: async () => config,
    createOwner: vi.fn(
      (_config, c: ReturnType<typeof createStudioRequestBudget>) => {
        clock = c;
        return owner;
      },
    ),
    createPlayService: vi.fn(() => playService),
    createAccessService: vi.fn(() => accessService),
  };
}
it("creates against the original binding with one lazy owner/clock and verifies created status", async () => {
  const f = await internalPlayFixture(),
    create = vi.fn<InternalPlayService["create"]>(async () => ({
      created: true,
      play: f.play.play,
    })),
    d = deps({ create }),
    start = performance.now();
  const response = await handle(
    request(true, f.play.play.binding),
    { action: "create-play", productId: f.content.product.productId },
    d,
    start,
  );
  expect(response.status).toBe(201);
  expect((await response.json()).play).toEqual(f.play.play);
  expect(d.createOwner).toHaveBeenCalledOnce();
  expect(d.createAccessService).not.toHaveBeenCalled();
  expect(d.clock().budget.deadlineMonotonicMs).toBe(start + 15000);
  expect(d.close).toHaveBeenCalledTimes(2);
  expect(create.mock.calls[0]?.[2]).toEqual(f.play.play.binding);
});
it("rejects malformed source, Studio cookie/CSRF, raw issue input and cross-product binding before owner", async () => {
  const f = await internalPlayFixture(),
    issue = await newStudioIssueV1({
      productId: f.content.product.productId,
      playVersionId: f.play.play.id,
      playSnapshotSha256: f.play.play.snapshotSha256,
    }),
    d = deps();
  for (const [req, endpoint] of [
    [
      request(true, f.play.play.binding, { "sec-fetch-site": "" }),
      { action: "create-play", productId: f.content.product.productId },
    ],
    [
      request(true, f.play.play.binding, { "x-csrf-token": "" }),
      { action: "create-play", productId: f.content.product.productId },
    ],
    [
      request(false, undefined, { cookie: `${SESSION_COOKIE}=bad` }),
      { action: "list-plays", productId: f.content.product.productId },
    ],
    [
      request(true, { ...issue.binding, raw: issue.raw }),
      { action: "issue-key", productId: f.content.product.productId },
    ],
    [
      request(true, issue.binding),
      { action: "issue-key", productId: "another-product" },
    ],
  ] as [Request, StudioConsumerEndpointV1][])
    expect([400, 401, 403]).toContain((await handle(req, endpoint, d)).status);
  expect(d.createOwner).not.toHaveBeenCalled();
});
it("resolve uses read authority while a finite operator denial never becomes a successful write", async () => {
  const f = await internalPlayFixture(),
    resolve = vi.fn<InternalPlayService["resolve"]>(async () => ({
      schemaVersion: "quizforge.internal-play-resolution.v1",
      kind: "unresolved",
      binding: f.play.play.binding,
      bindingSha256: await internalPlayBindingSha256(f.play.play.binding),
    }));
  const create = vi.fn<InternalPlayService["create"]>(async () => {
    throw new ConsumerError("OPERATOR_REQUIRED");
  });
  const response = await handle(
    request(true, f.play.play.binding),
    { action: "resolve-play", productId: f.content.product.productId },
    deps({ resolve, create }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).kind).toBe("unresolved");
  expect(create).not.toHaveBeenCalled();
  const denied = await handle(
    request(true, f.play.play.binding),
    { action: "create-play", productId: f.content.product.productId },
    deps({ create }),
  );
  expect(denied.status).toBe(403);
  expect((await denied.json()).code).toBe("OPERATOR_REQUIRED");
});
it("parses only an exact cursor pair and rejects extra response fields without disclosure", async () => {
  const f = await internalPlayFixture(),
    productId = f.content.product.productId,
    list = vi.fn<AccessKeyService["list"]>(async () => ({
      productId,
      keys: [],
      nextCursor: null,
    })),
    d = deps({}, { list });
  const query =
    "?" +
    new URLSearchParams({
      issuedAt: f.play.play.createdAt,
      keyId: f.play.play.id,
    });
  expect(
    (
      await handle(
        request(false, undefined, {}, query),
        { action: "list-keys", productId },
        d,
      )
    ).status,
  ).toBe(200);
  expect(list.mock.calls[0]?.[2]).toEqual({
    productId,
    issuedAt: f.play.play.createdAt,
    keyId: f.play.play.id,
  });
  for (const invalid of [
    query + "&keyId=" + f.play.play.id,
    "?issuedAt=" + encodeURIComponent(f.play.play.createdAt),
    query + "&unknown=1",
  ])
    expect(
      (
        await handle(
          request(false, undefined, {}, invalid),
          { action: "list-keys", productId },
          deps(),
        )
      ).status,
    ).toBe(400);
  const extra = {
    productId,
    keys: [],
    nextCursor: null,
    raw: "synthetic-private-extra",
  };
  const response = await handle(
    request(false),
    { action: "list-keys", productId },
    deps({}, { list: async () => extra }),
  );
  expect(response.status).toBe(503);
  const text = await response.text();
  expect(text).not.toContain("synthetic-private");
  expect(JSON.parse(text).code).toBe("UNAVAILABLE");
});
it("a successful create with unconfirmed close becomes UNKNOWN and reveals no fault", async () => {
  const f = await internalPlayFixture(),
    d = deps(
      { create: async () => ({ created: true, play: f.play.play }) },
      {},
      true,
    );
  const response = await handle(
    request(true, f.play.play.binding),
    { action: "create-play", productId: f.content.product.productId },
    d,
  );
  const text = await response.text();
  expect(JSON.parse(text).code).toBe("OUTCOME_UNKNOWN");
  expect(text).not.toContain("private close");
  expect(d.close).toHaveBeenCalledTimes(2);
});
