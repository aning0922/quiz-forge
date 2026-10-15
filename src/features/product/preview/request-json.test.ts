import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readPreviewScoreJson } from "./request-json";
import { readStudioJson } from "@/lib/http-security/json";
import { errorResponse, StudioError } from "@/lib/http-security/errors";
import { PREVIEW_LIMITS } from "./limits";
const request = (body: string) =>
  new Request("http://127.0.0.1:3100/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
describe("dedicated score request envelope", () => {
  it("accepts the complete exact UTF-8 budget but leaves legacy writes at 4 KiB", async () => {
    const text = '"' + "a".repeat(PREVIEW_LIMITS.scoreRequestBytes - 2) + '"';
    expect(((await readPreviewScoreJson(request(text))) as string).length).toBe(
      PREVIEW_LIMITS.scoreRequestBytes - 2,
    );
    await expect(
      readPreviewScoreJson(request(text + " ")),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(
      readStudioJson(request(JSON.stringify("a".repeat(5000)))),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
  it("counts UTF-8 and escaping instead of character count or Content-Length", async () => {
    const body = JSON.stringify("字".repeat(32768));
    const req = request(body);
    req.headers.set("content-length", "1");
    await expect(readPreviewScoreJson(req)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });
  it("uses the caller original deadline and already-aborted signal", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      readPreviewScoreJson(request("{}"), {
        signal: abort.signal,
        deadlineMonotonicMs: performance.now() + 1000,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      readPreviewScoreJson(request("{}"), {
        signal: new AbortController().signal,
        deadlineMonotonicMs: performance.now() - 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("returns finite private busy errors without input or file data", async () => {
    const response = errorResponse(
      new StudioError("PREVIEW_BUSY"),
      "11111111-1111-4111-8111-111111111111",
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text();
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(
      PREVIEW_LIMITS.errorResponseBytes,
    );
    expect(JSON.parse(text)).toEqual({
      code: "PREVIEW_BUSY",
      requestId: "11111111-1111-4111-8111-111111111111",
    });
  });
});
