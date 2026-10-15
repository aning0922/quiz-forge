import { expect, it, vi } from "vitest";
import { readBoundedDraftJson } from "./response";
const json = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Response(body, {
    headers: { "content-type": "application/json", ...headers },
  });

it("measures actual UTF-8 rather than text length or Content-Length at the exact boundary", async () => {
  const body = JSON.stringify({ text: '归册\\"' });
  const bytes = new TextEncoder().encode(body);
  expect(
    await readBoundedDraftJson(
      json(body, { "content-length": "1" }),
      bytes.length,
    ),
  ).toEqual({ text: '归册\\"' });
  await expect(
    readBoundedDraftJson(
      json(body, { "content-length": "1" }),
      bytes.length - 1,
    ),
  ).rejects.toThrow("INVALID_DRAFT_RESPONSE");
});
it("reassembles split multibyte sequences and escaped canonical text without rewriting it", async () => {
  const canonical = JSON.stringify({ text: '归册\\"' }),
    body = new TextEncoder().encode(
      JSON.stringify({ canonicalContentText: canonical }),
    );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of body) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  expect(await readBoundedDraftJson(json(stream), body.length)).toEqual({
    canonicalContentText: canonical,
  });
});
it("rejects a later chunk exceeding the remaining budget and does not await a pending cancel", async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"x":'));
      controller.enqueue(new TextEncoder().encode("true}"));
    },
    cancel,
  });
  await expect(readBoundedDraftJson(json(stream), 9)).rejects.toThrow(
    "INVALID_DRAFT_RESPONSE",
  );
  expect(cancel).toHaveBeenCalledOnce();
});
it.each([
  () => json(new Uint8Array([0xff])),
  () => json('{"x":'),
  () => json("{}", { "content-type": "text/html" }),
  () => new Response(null, { headers: { "content-type": "application/json" } }),
])(
  "rejects malformed UTF-8, truncated JSON, wrong media type or an absent body",
  async (response) => {
    await expect(readBoundedDraftJson(response(), 65536)).rejects.toThrow(
      "INVALID_DRAFT_RESPONSE",
    );
  },
);
it.each([0, -1, 1.5, Infinity, 4_390_913])(
  "refuses an invalid response budget %s",
  async (limit) => {
    await expect(readBoundedDraftJson(json("{}"), limit)).rejects.toThrow(
      "INVALID_DRAFT_RESPONSE",
    );
  },
);

it("accepts a legal >1MiB canonical document whose JSON envelope exceeds the raw document limit", async () => {
  const canonicalContentText = JSON.stringify({ text: '\\"'.repeat(400_000) });
  const rawBytes = new TextEncoder().encode(canonicalContentText).byteLength;
  expect(rawBytes).toBeGreaterThan(1_048_576);
  expect(rawBytes).toBeLessThanOrEqual(2_097_152);
  const body = JSON.stringify({ canonicalContentText, assetSetText: "{}" });
  expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(2_097_152);
  expect(await readBoundedDraftJson(json(body), 4_390_912)).toEqual({
    canonicalContentText,
    assetSetText: "{}",
  });
});
