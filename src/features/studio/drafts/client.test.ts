import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkApplyDraft,
  checkDraftRead,
  checkDraftRevision,
  checkedDraftFetch,
} from "./client";
import { receipt, summary, tuple, textHash } from "./fixtures.test-support";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("strict draft client", () => {
  it("matches response status and every original tuple field", async () => {
    const app = await receipt();
    await expect(
      checkApplyDraft({ created: true, application: app }, 201, tuple),
    ).resolves.toBeTruthy();
    await expect(
      checkApplyDraft({ created: true, application: app }, 200, tuple),
    ).rejects.toThrow();
    await expect(
      checkApplyDraft(
        {
          created: false,
          application: { ...app, idempotencyKey: crypto.randomUUID() },
        },
        200,
        tuple,
      ),
    ).rejects.toThrow();
  });
  it("checks product identity and original content UTF8 hashes without reserializing", async () => {
    expect(() =>
      checkDraftRead(
        { kind: "empty", productId: "another-product" },
        tuple.productId,
      ),
    ).toThrow();
    const text = '{"text":"汉字\\\\\\\""}';
    const draft = { ...summary, canonicalContentSha256: textHash(text) };
    await expect(
      checkDraftRevision(
        { draft, canonicalContentText: text, assetSetText: "[]" },
        { productId: tuple.productId, draftId: draft.draftId, revision: 1 },
      ),
    ).resolves.toBeTruthy();
    await expect(
      checkDraftRevision(
        { draft, canonicalContentText: text + " ", assetSetText: "[]" },
        { productId: tuple.productId, draftId: draft.draftId, revision: 1 },
      ),
    ).rejects.toThrow();
  });
  it("bounds a stalled response body by the same request deadline and retains write uncertainty", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull() {
                return new Promise(() => {});
              },
              cancel() {
                cancelled = true;
                return new Promise(() => {});
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const result = checkedDraftFetch("/synthetic", {}, () => true, {
      write: true,
    });
    const assertion = expect(result).rejects.toMatchObject({
      code: "WRITE_OUTCOME_UNKNOWN",
    });
    await vi.advanceTimersByTimeAsync(15001);
    await assertion;
    expect(cancelled).toBe(true);
  });
  it("validates finite error envelope/status and hides malformed bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            code: "DRAFT_SOURCE_CHANGED",
            currentRevision: 7,
            requestId: crypto.randomUUID(),
          },
          { status: 409 },
        ),
      ),
    );
    await expect(
      checkedDraftFetch("/synthetic", {}, () => true, { write: true }),
    ).rejects.toMatchObject({
      code: "DRAFT_SOURCE_CHANGED",
      currentRevision: 7,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            code: "DRAFT_SOURCE_CHANGED",
            currentRevision: 7,
            requestId: crypto.randomUUID(),
            secret: "no",
          },
          { status: 409 },
        ),
      ),
    );
    await expect(
      checkedDraftFetch("/synthetic", {}, () => true, { write: true }),
    ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
  });
});
