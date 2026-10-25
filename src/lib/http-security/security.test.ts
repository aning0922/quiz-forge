import { afterEach, describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { emptyDto, readStudioJson } from "./json";
import { assertStudioSource, configuredHost } from "./source";
import { errorResponse, StudioError } from "./errors";

const config = {
  profile: "local-http-p2a" as const,
  origin: "http://127.0.0.1:3100",
};
const source = () =>
  new Headers({ host: "127.0.0.1:3100", origin: config.origin });
const jsonRequest = (body: string) =>
  new Request(config.origin, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "1" },
    body,
  });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Studio source boundary", () => {
  it("requires an exact loopback profile and explicit nondefault port", () => {
    expect(configuredHost(config)).toBe("127.0.0.1:3100");
    for (const origin of [
      "http://localhost:3100",
      "https://127.0.0.1:3100",
      "http://127.0.0.1",
      "http://127.0.0.1:3100/",
      "http://127.0.0.1:3100/path",
      "http://u:p@127.0.0.1:3100",
      "http://127.0.0.1:80",
      "http://127.0.0.1:81",
      "http://127.0.0.1:1023",
      "http://127.0.0.1:65536",
      "http://127.0.0.1:01024",
    ]) {
      expect(() => configuredHost({ ...config, origin })).toThrow(
        "STUDIO_UNAVAILABLE",
      );
    }
    for (const port of [1024, 65535]) {
      expect(
        configuredHost({ ...config, origin: `http://127.0.0.1:${port}` }),
      ).toBe(`127.0.0.1:${port}`);
    }
  });
  it("rejects absent, null, alias and foreign origins, without trusting proxy headers", () => {
    for (const origin of [
      null,
      "null",
      "http://localhost:3100",
      "http://127.0.0.1:3101",
    ]) {
      const headers = source();
      if (origin === null) headers.delete("origin");
      else headers.set("origin", origin);
      headers.set("x-forwarded-host", "127.0.0.1:3100");
      expect(() =>
        assertStudioSource(headers, config, { write: true, api: true }),
      ).toThrow("ORIGIN_REJECTED");
    }
    const headers = source();
    headers.set("host", "localhost:3100");
    expect(() =>
      assertStudioSource(headers, config, { write: false, api: false }),
    ).toThrow("ORIGIN_REJECTED");
  });
  it("accepts normal page navigation but requires same-origin fetch metadata for APIs when present", () => {
    const headers = source();
    headers.delete("origin");
    headers.set("sec-fetch-site", "none");
    expect(() =>
      assertStudioSource(headers, config, { write: false, api: false }),
    ).not.toThrow();
    for (const site of ["none", "cross-site", "same-site"]) {
      headers.set("sec-fetch-site", site);
      expect(() =>
        assertStudioSource(headers, config, { write: false, api: true }),
      ).toThrow("ORIGIN_REJECTED");
    }
    headers.set("sec-fetch-site", "same-origin");
    expect(() =>
      assertStudioSource(headers, config, { write: false, api: true }),
    ).not.toThrow();
  });
});

describe("actual bounded JSON and strict DTOs", () => {
  it("counts actual bytes, including multibyte UTF-8, independent of Content-Length", async () => {
    await expect(
      readStudioJson(jsonRequest('"' + "a".repeat(4094) + '"')),
    ).resolves.toHaveLength(4094);
    await expect(
      readStudioJson(jsonRequest('"' + "a".repeat(4095) + '"')),
    ).rejects.toThrow("PAYLOAD_TOO_LARGE");
    await expect(
      readStudioJson(jsonRequest('"' + "中".repeat(1365) + '"')),
    ).rejects.toThrow("PAYLOAD_TOO_LARGE");
  });
  it("rejects malformed JSON, unsupported types, encodings and invalid UTF-8", async () => {
    await expect(readStudioJson(jsonRequest("{"))).rejects.toThrow(
      "INVALID_REQUEST",
    );
    const wrong = jsonRequest("{}");
    wrong.headers.set("content-type", "text/plain");
    await expect(readStudioJson(wrong)).rejects.toThrow("INVALID_REQUEST");
    const compressed = jsonRequest("{}");
    compressed.headers.set("content-encoding", "gzip");
    await expect(readStudioJson(compressed)).rejects.toThrow("INVALID_REQUEST");
    const bytes = new Request(config.origin, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array([0xff]),
    });
    await expect(readStudioJson(bytes)).rejects.toThrow("INVALID_REQUEST");
  });
  it("cancels a stalled body at the server deadline even after complete-looking JSON", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request(config.origin, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    const result = expect(readStudioJson(request)).rejects.toThrow(
      "INVALID_REQUEST",
    );
    await vi.advanceTimersByTimeAsync(5000);
    await result;
    expect(cancelled).toBe(true);
  });
  it("rejects a read that resolves at the monotonic deadline before its timer callback", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const body = new ReadableStream({
      pull(controller) {
        now = 5000;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const request = new Request(config.origin, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    await expect(readStudioJson(request)).rejects.toThrow("INVALID_REQUEST");
  });
  it("checks the monotonic deadline after decoding and parsing before success", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const originalParse = JSON.parse;
    vi.spyOn(JSON, "parse").mockImplementation((...args) => {
      const value: unknown = originalParse(...args);
      now = 5000;
      return value;
    });
    await expect(readStudioJson(jsonRequest("{}"))).rejects.toThrow(
      "INVALID_REQUEST",
    );
  });
  it("yields through continuous empty-chunk microtasks and cancels without awaiting the stream", async () => {
    let now = 0;
    let reads = 0;
    let cancelled = false;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const body = new ReadableStream({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array());
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => {});
      },
    });
    const request = new Request(config.origin, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    const result = expect(readStudioJson(request)).rejects.toThrow(
      "INVALID_REQUEST",
    );
    // A timer must get CPU time despite an endless sequence of resolved reads.
    const marker = setTimeout(() => {
      now = 5000;
    }, 0);
    await result;
    clearTimeout(marker);
    expect(cancelled).toBe(true);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThan(10000);
    expect(body.locked).toBe(false);
  });
  it("rejects all unknown fields and non-object DTOs", () => {
    expect(() => emptyDto({})).not.toThrow();
    for (const value of [null, [], "", { role: "operator" }])
      expect(() => emptyDto(value)).toThrow("INVALID_REQUEST");
  });
  it("never serializes raw exceptions and always prevents caching", async () => {
    const response = errorResponse(
      new Error("private-connection-detail"),
      "synthetic-request-id",
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(await response.json()).toEqual({
      code: "STUDIO_UNAVAILABLE",
      requestId: "synthetic-request-id",
    });
  });
});

describe("bounded import conflict projection", () => {
  it("exposes only the bounded revision on an import state conflict", async () => {
    const error = Object.assign(new StudioError("IMPORT_STATE_CONFLICT", 7), {
      path: "private-storage-path",
      ownerNonce: "private-owner-nonce",
      cause: new Error("private-driver-detail"),
    });
    const response = errorResponse(error, "synthetic-request-id");
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      code: "IMPORT_STATE_CONFLICT",
      requestId: "synthetic-request-id",
      currentRevision: 7,
    });
  });
  it.each([0, -1, 1.5, 2147483648, Number.NaN])(
    "does not expose an invalid import revision %s",
    async (revision) => {
      expect(
        await errorResponse(
          new StudioError("IMPORT_STATE_CONFLICT", revision),
          "synthetic-request-id",
        ).json(),
      ).toEqual({
        code: "IMPORT_STATE_CONFLICT",
        requestId: "synthetic-request-id",
      });
    },
  );
  it("does not attach a revision to an unknown receive outcome", async () => {
    const response = errorResponse(
      new StudioError("WRITE_OUTCOME_UNKNOWN", 7),
      "synthetic-request-id",
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "WRITE_OUTCOME_UNKNOWN",
      requestId: "synthetic-request-id",
    });
  });
});

describe("validation errors preserve uncertain execution", () => {
  it("does not attach a not-started or retry authority to generic failure codes", async () => {
    for (const [code, status] of [
      ["VALIDATION_TIMEOUT", 504],
      ["VALIDATION_LOCK_LOST", 503],
      ["WRITE_OUTCOME_UNKNOWN", 503],
      ["VALIDATION_IDENTITY_CHANGED", 409],
    ] as const) {
      const response = errorResponse(
        new StudioError(code),
        "synthetic-request",
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({
        code,
        requestId: "synthetic-request",
      });
    }
  });
  it("only includes a finite validation revision for CAS conflicts", async () => {
    const good = errorResponse(
      new StudioError("VALIDATION_STATE_CONFLICT", 2),
      "synthetic-request",
    );
    expect(await good.json()).toEqual({
      code: "VALIDATION_STATE_CONFLICT",
      requestId: "synthetic-request",
      currentRevision: 2,
    });
    for (const revision of [0, -1, 1.5, NaN, Infinity, 2147483648]) {
      const response = errorResponse(
        new StudioError("VALIDATION_STATE_CONFLICT", revision),
        "synthetic-request",
      );
      expect(await response.json()).not.toHaveProperty("currentRevision");
    }
    expect(
      await errorResponse(
        new StudioError("VALIDATION_LOCK_LOST", 2),
        "synthetic-request",
      ).json(),
    ).not.toHaveProperty("currentRevision");
  });
});
