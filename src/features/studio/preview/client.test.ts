import { afterEach, describe, it, expect, vi } from "vitest";
import {
  previewFixture,
  sourceBinding,
  answers,
  requestId,
} from "@/features/theme/preview/fixtures.test-support";
import {
  preparePreviewContent,
  scorePreview,
} from "@/features/theme/preview/projection";
import { fetchPreviewEntry, fetchPreviewScore } from "./client";
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const c = await previewFixture(),
    binding = sourceBinding(c),
    p = preparePreviewContent(c, binding);
  if (!p.ok) throw Error(p.code);
  const r = scorePreview(p.value.prepared, answers(c), requestId);
  if (!r.ok) throw Error(r.code);
  return {
    entry: p.value.entry,
    reveal: r.value,
    request: { binding, requestId, answers: answers(c) },
  };
}
describe("bounded preview transport", () => {
  it("requires the exact fixed source and caller requestId for success", async () => {
    const { entry, reveal, request } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, value: entry })),
    );
    expect(await fetchPreviewEntry(request.binding, signal())).toEqual(entry);
    await expect(
      fetchPreviewEntry({ ...request.binding, revision: 2 }, signal()),
    ).rejects.toThrow("PREVIEW_BINDING_MISMATCH");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          value: {
            ...reveal,
            requestId: "33333333-3333-4333-8333-333333333333",
          },
        }),
      ),
    );
    await expect(
      fetchPreviewScore(request, "synthetic-csrf", signal()),
    ).rejects.toThrow("PREVIEW_BINDING_MISMATCH");
  });
  it("accepts a finite HTTP failure using its own observation ID and requires the correct status", async () => {
    const { request } = await fixture();
    const body = {
      code: "PREVIEW_INVALID_ANSWERS",
      requestId: "33333333-3333-4333-8333-333333333333",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body, { status: 422 })),
    );
    await expect(
      fetchPreviewScore(request, "synthetic-csrf", signal()),
    ).rejects.toThrow("PREVIEW_INVALID_ANSWERS");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body, { status: 400 })),
    );
    await expect(
      fetchPreviewScore(request, "synthetic-csrf", signal()),
    ).rejects.toThrow("STUDIO_UNAVAILABLE");
  });
  it("keeps credentials private, sends only actual choices and does not use write UNKNOWN semantics", async () => {
    const { request, reveal } = await fixture(),
      fetcher = vi.fn(async () => Response.json({ ok: true, value: reveal }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await fetchPreviewScore(request, "synthetic-csrf", signal()),
    ).toEqual(reveal);
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).not.toContain("csrf");
    expect(options.credentials).toBe("same-origin");
    expect(options.cache).toBe("no-store");
    expect(JSON.parse(options.body as string)).toEqual(request);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Error("private details");
      }),
    );
    await expect(
      fetchPreviewScore(request, "synthetic-csrf", signal()),
    ).rejects.toThrow("STUDIO_UNAVAILABLE");
  });
  it("rejects oversized or malformed success envelopes and unknown fields", async () => {
    const { entry, request } = await fixture();
    for (const response of [
      new Response("x".repeat(524289), {
        headers: { "content-type": "application/json" },
      }),
      Response.json({ ok: true, value: entry, extra: true }),
      new Response(new Uint8Array([0xff]), {
        headers: { "content-type": "application/json" },
      }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      await expect(
        fetchPreviewEntry(request.binding, signal()),
      ).rejects.toThrow("STUDIO_UNAVAILABLE");
    }
  });
});
