import { EventEmitter } from "node:events";
import { expect, it, vi, beforeEach } from "vitest";
import type { Page } from "@playwright/test";
import {
  createConsumerToken,
  CONSUMER_COOKIE_NAME_V1,
} from "@/lib/consumer-contract/v1/credentials";
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:http", () => ({ request: transport.request }));
import {
  consumerGet,
  consumerPost,
} from "../../../../tests/e2e/consumer-flow.network";
const id = "00000000-0000-4000-8000-000000000001",
  url = `/play/${id}/api/session`;
let cookieCalls = 0,
  cookieUrl = "";
const token = createConsumerToken("grant");
const page = {
  url: () => "http://127.0.0.1:3100/access",
  context: () => ({
    cookies: async (url: string) => {
      cookieCalls++;
      cookieUrl = url;
      return [
        { name: CONSUMER_COOKIE_NAME_V1, value: token, path: `/play/${id}` },
      ];
    },
  }),
} as unknown as Page;
beforeEach(() => {
  transport.request.mockReset();
  cookieCalls = 0;
  cookieUrl = "";
});
function reply(body: Buffer, code = 200, headers: Record<string, string> = {}) {
  transport.request.mockImplementation((_url, _options, receive) => {
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: () => void;
    };
    req.destroy = () => {};
    req.end = () => {
      queueMicrotask(() => {
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
          destroy: () => void;
        };
        response.statusCode = code;
        response.headers = headers;
        response.destroy = () => {};
        receive(response);
        response.emit("data", body);
        response.emit("end");
      });
    };
    return req;
  });
}
it("rejects origin escapes, unlisted products, raw exchange, queries and unsupported selectors before native HTTP", async () => {
  for (const bad of [
    "/\t/invalid.example/",
    "//invalid.example/",
    "/access/exchange",
    "/api/studio/products/other/access-keys",
    url + "?key=hidden",
    `/play/${id}/api/resources?resourceId=x&resourceVersion=1&sha256=bad`,
  ]) {
    await expect(consumerGet(page, bad)).rejects.toThrow(
      "CONSUMER_E2E_NETWORK_UNAVAILABLE",
    );
  }
  await expect(
    consumerPost(page, "/access/exchange", { rawKey: "synthetic-private" }),
  ).rejects.toThrow("CONSUMER_E2E_NETWORK_UNAVAILABLE");
  expect(transport.request).not.toHaveBeenCalled();
});
it("selects the request's cookie path and keeps credentials out of response headers", async () => {
  reply(Buffer.from('{"ok":true}'), 200, {
    "set-cookie": "synthetic-private",
    "x-unknown": "synthetic-private",
    "cache-control": "private, no-store",
  });
  const response = await consumerGet(page, url);
  expect(cookieCalls).toBe(1);
  expect(cookieUrl === "http://127.0.0.1:3100" + url).toBe(true);
  expect(response.status()).toBe(200);
  expect(response.headers()).toEqual({ "cache-control": "private, no-store" });
});
it("caps actual error bytes and rejects redirects and encoded bodies with finite errors", async () => {
  for (const [body, status, headers] of [
    [Buffer.alloc(4097), 503, {}],
    [Buffer.alloc(0), 302, {}],
    [Buffer.alloc(0), 200, { "content-encoding": "gzip" }],
  ] as const) {
    reply(body, status, headers);
    await expect(consumerGet(page, url)).rejects.toThrow(
      "CONSUMER_E2E_NETWORK_UNAVAILABLE",
    );
  }
});
it("rebuilds native faults without their cause, request credentials or original error", async () => {
  const marker = "SYNTHETIC_PRIVATE_CREDENTIAL";
  transport.request.mockImplementation(() => {
    throw Error(marker);
  });
  let error: unknown;
  try {
    await consumerGet(page, url);
  } catch (e) {
    error = e;
  }
  expect(
    error instanceof Error &&
      error.message === "CONSUMER_E2E_NETWORK_UNAVAILABLE" &&
      !error.cause &&
      !String(error.stack).includes(marker),
  ).toBe(true);
});
