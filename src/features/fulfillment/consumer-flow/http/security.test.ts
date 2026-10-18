import { describe, expect, it } from "vitest";
import {
  createConsumerToken,
  CONSUMER_COOKIE_NAME_V1 as name,
} from "@/lib/consumer-contract/v1/credentials";
import {
  assertConsumerSource,
  consumerGrantCookie,
  consumerSetCookie,
  readConsumerJson,
} from "./security";
import { consumerFailureResponse } from "./response";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";

const config = {
  profile: "local-http-p2a" as const,
  origin: "http://127.0.0.1:3201",
};
const session = "11111111-1111-4111-8111-111111111111";
function req(extra: Record<string, string> = {}, body: BodyInit = "{}") {
  return new Request(config.origin + "/access/exchange", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3201",
      origin: config.origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-quizforge-consumer-exchange": "1",
      ...extra,
    },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
const budget = (duration = 1000) => ({
  signal: new AbortController().signal,
  deadlineMonotonicMs: performance.now() + duration,
});
describe("consumer HTTP source and credential separation", () => {
  it("requires exact host/origin and mandatory same-origin metadata/header", () => {
    expect(() =>
      assertConsumerSource(req(), config, { post: true, exchange: true }),
    ).not.toThrow();
    for (const headers of [
      { host: "localhost:3201" },
      { origin: "null" },
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "" },
      { "x-quizforge-consumer-exchange": "" },
    ])
      expect(() =>
        assertConsumerSource(req(headers), config, {
          post: true,
          exchange: true,
        }),
      ).toThrow("SOURCE_REJECTED");
    const absent = req();
    absent.headers.delete("sec-fetch-site");
    expect(() => assertConsumerSource(absent, config, { post: false })).toThrow(
      "SOURCE_REJECTED",
    );
  });
  it("rejects duplicate/malformed grant cookies and accepts no Studio/access-key substitute", () => {
    const raw = createConsumerToken("grant");
    expect(
      consumerGrantCookie(
        new Headers({ cookie: `other=value; ${name}=${raw}` }),
      ),
    ).toBe(raw);
    expect(consumerGrantCookie(new Headers())).toBeNull();
    for (const cookie of [
      `${name}=${raw};${name}=${raw}`,
      `${name}=${raw}; ${name} =${raw}`,
      `${name}`,
      `${name}=`,
      `${name}=${createConsumerToken("access-key")}`,
      `${name}=${raw},${name}=${raw}`,
    ])
      expect(() => consumerGrantCookie(new Headers({ cookie }))).toThrow(
        "ACCESS_DENIED",
      );
    const header = consumerSetCookie(raw, session);
    expect(header).toContain(
      `Path=/play/${session}; HttpOnly; SameSite=Strict; Max-Age=28800`,
    );
    expect(header).not.toMatch(/Domain=|__Host/);
    expect(consumerSetCookie("", session, true)).toContain("Max-Age=0");
  });
  it("serializes finite private errors without arbitrary messages, credentials or stack", async () => {
    const response = consumerFailureResponse(
      new Error("sensitive fault"),
      session,
      true,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive");
    expect(response.headers.get("Cache-Control")).toContain(
      "private, no-store",
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(
      (
        await consumerFailureResponse(
          new ConsumerError("OUTCOME_UNKNOWN"),
          session,
          false,
        ).json()
      ).code,
    ).toBe("UNAVAILABLE");
  });
});
describe("consumer actual bounded JSON stream", () => {
  it("enforces depth/finite JSON values and UTF8 byte count before business parsing", async () => {
    for (const body of ["[".repeat(33) + "0" + "]".repeat(33), '{"x":1e999}'])
      await expect(
        readConsumerJson(req({}, body), 1000, budget()),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      readConsumerJson(req({}, '{"x":"中"}'), 9, budget()),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
  it("reads exact bytes independently from Content-Length and rejects +1", async () => {
    expect(
      await readConsumerJson(
        req({ "content-length": "0" }, '{"x":1}'),
        7,
        budget(),
      ),
    ).toEqual({ x: 1 });
    await expect(
      readConsumerJson(req({}, '{"x":10}'), 7, budget()),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
  it("rejects encoded/non-JSON/faulty UTF8 and returns no decoder or stream fault", async () => {
    for (const headers of [
      { "content-type": "text/plain" },
      { "content-encoding": "gzip" },
      { "content-type": "application/json; charset=latin1" },
    ])
      await expect(
        readConsumerJson(req(headers), 100, budget()),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      readConsumerJson(req({}, new Uint8Array([0xff])), 100, budget()),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      readConsumerJson(
        req(
          {},
          new ReadableStream({
            start(c) {
              c.error(Error("secret fault"));
            },
          }),
        ),
        100,
        budget(),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: "INVALID_REQUEST",
    });
  });
  it("interrupts stalled or endless zero-byte streams under the original deadline", async () => {
    for (const stream of [
      new ReadableStream<Uint8Array>(),
      new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(new Uint8Array());
        },
        cancel() {
          return new Promise(() => {});
        },
      }),
    ])
      await expect(
        readConsumerJson(req({}, stream), 100, budget(15)),
      ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
