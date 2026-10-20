import { EventEmitter } from "node:events";
import { expect, it, vi, beforeEach } from "vitest";
import type { Page, Route } from "@playwright/test";
import {
  createConsumerToken,
  CONSUMER_COOKIE_NAME_V1,
} from "@/lib/consumer-contract/v1/credentials";
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:http", () => ({ request: transport.request }));
import {
  consumerGet,
  consumerPost,
  consumerRouteFetch,
} from "../../../../tests/e2e/consumer-flow.network";
const id = "00000000-0000-4000-8000-000000000001",
  url = `/play/${id}/api/session`;
let forwardedBody: Buffer | undefined;
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
  forwardedBody = undefined;
});
function reply(body: Buffer, code = 200, headers: Record<string, string> = {}) {
  transport.request.mockImplementation((_url, _options, receive) => {
    const req = new EventEmitter() as EventEmitter & {
      end: (body?: Buffer) => void;
      destroy: () => void;
    };
    req.destroy = () => {};
    req.end = (requestBody) => {
      forwardedBody = requestBody;
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

function interception() {
  const origin = "http://127.0.0.1:3100";
  let pageUrl =
      origin + "/studio/products/consumer-flow-fixture/consumer-access",
    frameUrl = pageUrl,
    principal = origin,
    main = true,
    navigation = false,
    resource = "fetch",
    method = "POST",
    target = origin + "/api/studio/products/consumer-flow-fixture/access-keys",
    correctPage = true,
    principalError = false;
  const headers: Record<string, string> = {
    origin,
    cookie: "SYNTHETIC_PRIVATE_COOKIE",
    "x-csrf-token": "SYNTHETIC_PRIVATE_CSRF",
  };
  const body = Buffer.from('{"synthetic":"exact-original-operation"}');
  const trustedPage = {
    url: () => pageUrl,
    mainFrame: () => (main ? frame : {}),
  } as unknown as Page;
  const frame = {
    url: () => frameUrl,
    page: () => (correctPage ? trustedPage : {}),
    evaluate: async () => {
      if (principalError) throw Error("SYNTHETIC_PRIVATE_FRAME_FAILURE");
      return principal;
    },
  };
  const route = {
    request: () => ({
      url: () => target,
      method: () => method,
      frame: () => frame,
      isNavigationRequest: () => navigation,
      resourceType: () => resource,
      allHeaders: async () => ({ ...headers }),
      postDataBuffer: () => body,
    }),
  } as unknown as Route;
  return {
    route,
    trustedPage,
    headers,
    body,
    change: (fault: string) => {
      if (fault === "page") pageUrl = "http://invalid.example/";
      if (fault === "frame") frameUrl = "http://invalid.example/";
      if (fault === "principal") principal = "http://invalid.example";
      if (fault === "subframe") main = false;
      if (fault === "navigation") navigation = true;
      if (fault === "resource") resource = "xhr";
      if (fault === "method") method = "GET";
      if (fault === "destination")
        target =
          "http://invalid.example/api/studio/products/consumer-flow-fixture/access-keys";
      if (fault === "path")
        target = origin + "/api/studio/products/other/access-keys";
      if (fault === "page-owner") correctPage = false;
      if (fault === "principal-error") principalError = true;
    },
  };
}
it("adds only absent intercepted site metadata after trusted main-frame proof, preserving exact credentials/body", async () => {
  reply(Buffer.from('{"ok":true}'));
  const f = interception();
  const result = await consumerRouteFetch(f.route, f.trustedPage);
  expect(result.status()).toBe(200);
  const [url, options] = transport.request.mock.calls[0]!;
  expect(url.origin).toBe("http://127.0.0.1:3100");
  expect(options.headers["sec-fetch-site"]).toBe("same-origin");
  expect(options.headers.origin === f.headers.origin).toBe(true);
  expect(options.headers.cookie === f.headers.cookie).toBe(true);
  expect(options.headers["x-csrf-token"] === f.headers["x-csrf-token"]).toBe(
    true,
  );
  expect(forwardedBody?.equals(f.body)).toBe(true);
  expect(cookieCalls).toBe(0); // No cookie recovery or credential generation.
});
it.each([
  "page",
  "frame",
  "principal",
  "subframe",
  "navigation",
  "resource",
  "method",
  "destination",
  "path",
  "page-owner",
  "principal-error",
])(
  "refuses interception metadata synthesis without trusted provenance (%s)",
  async (fault) => {
    const f = interception();
    f.change(fault);
    await expect(consumerRouteFetch(f.route, f.trustedPage)).rejects.toThrow(
      "CONSUMER_E2E_NETWORK_UNAVAILABLE",
    );
    expect(transport.request).not.toHaveBeenCalled();
  },
);
it.each([
  ["sec-fetch-site", ""],
  ["sec-fetch-site", "cross-site"],
  ["sec-fetch-site", "same-site"],
  ["origin", null],
  ["origin", "http://localhost:3100"],
  ["origin", "http://invalid.example"],
  ["host", "localhost:3100"],
  ["host", "127.0.0.1:3101"],
])(
  "never repairs explicit or missing source header failures (%s=%s)",
  async (name, value) => {
    const f = interception();
    if (value === null) delete f.headers[name!];
    else f.headers[name!] = value!;
    await expect(consumerRouteFetch(f.route, f.trustedPage)).rejects.toThrow(
      "CONSUMER_E2E_NETWORK_UNAVAILABLE",
    );
    expect(transport.request).not.toHaveBeenCalled();
  },
);
it("preserves explicit negative native source overrides used by the eighth consumer case", async () => {
  for (const override of [
    { "sec-fetch-site": "" },
    { "sec-fetch-site": "cross-site" },
    { host: "invalid.example" },
  ]) {
    reply(Buffer.from('{"code":"SOURCE_REJECTED"}'), 403);
    const result = await consumerGet(page, url, override);
    expect(result.status()).toBe(403);
    const options = transport.request.mock.calls.at(-1)![1];
    for (const [name, value] of Object.entries(override))
      expect(options.headers[name]).toBe(value);
  }
});

it("does not synthesize missing cookies or CSRF while supplying missing site metadata", async () => {
  reply(Buffer.from('{"code":"ACCESS_DENIED"}'), 401);
  const f = interception();
  delete f.headers.cookie;
  delete f.headers["x-csrf-token"];
  const result = await consumerRouteFetch(f.route, f.trustedPage);
  expect(result.status()).toBe(401);
  const options = transport.request.mock.calls[0]![1];
  expect(Object.hasOwn(options.headers, "cookie")).toBe(false);
  expect(Object.hasOwn(options.headers, "x-csrf-token")).toBe(false);
  expect(cookieCalls).toBe(0);
});
