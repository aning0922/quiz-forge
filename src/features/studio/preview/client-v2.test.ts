import {
  PREVIEW_FONT,
  PREVIEW_RENDERER,
} from "@/features/product/preview/descriptor";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { temporaryPreviewFixtureV2 } from "@/features/product/preview/v2.test-support";
import { fetchCurrentPreviewEntry, fetchTemporaryPreviewV2 } from "./client-v2";
let f: Awaited<ReturnType<typeof temporaryPreviewFixtureV2>>;
beforeAll(async () => {
  f = await temporaryPreviewFixtureV2();
});
afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
it("binds current fixed revision and sends only explicit temporary inputs to the read-only score route", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, o) =>
    json({
      ok: true,
      value:
        o?.method === "POST"
          ? f.result
          : { mode: "structured", value: f.entry },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    (await fetchCurrentPreviewEntry(f.scope, new AbortController().signal))
      .mode,
  ).toBe("structured");
  expect(
    (
      await fetchTemporaryPreviewV2(
        f.request,
        "synthetic-csrf",
        new AbortController().signal,
      )
    ).result.body.volumes,
  ).toHaveLength(6);
  expect(fetcher.mock.calls[0]![0]).toMatch(/preview\/current$/);
  expect(fetcher.mock.calls[1]![0]).toMatch(/preview\/current\/score$/);
  expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toMatchObject({
    matchingContext: f.request.matchingContext,
  });
  expect(
    Object.keys(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))),
  ).toEqual(["binding", "requestId", "answers", "matchingContext"]);
});
it("rejects changed revision/request identity without old-entry or old-score fallback", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, o) =>
    json({
      ok: true,
      value:
        o?.method === "POST"
          ? { ...f.result, requestId: "33333333-3333-4333-8333-333333333333" }
          : {
              mode: "structured",
              value: { ...f.entry, binding: { ...f.binding, revision: 2 } },
            },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    fetchCurrentPreviewEntry(f.scope, new AbortController().signal),
  ).rejects.toThrow("PREVIEW_BINDING_MISMATCH");
  await expect(
    fetchTemporaryPreviewV2(
      f.request,
      "synthetic-csrf",
      new AbortController().signal,
    ),
  ).rejects.toThrow("PREVIEW_BINDING_MISMATCH");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("accepts an explicit legacy selection only with the original fixed renderer and font", async () => {
  const binding = {
    ...f.scope,
    canonicalContentSha256: f.binding.canonicalContentSha256,
    assetSetSha256: f.binding.assetSetSha256,
    renderer: PREVIEW_RENDERER,
    font: PREVIEW_FONT,
  };
  const fetcher = vi.fn<typeof fetch>(async () =>
    json({ ok: true, value: { mode: "legacy", binding } }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    (await fetchCurrentPreviewEntry(f.scope, new AbortController().signal))
      .mode,
  ).toBe("legacy");
  fetcher.mockImplementation(async () =>
    json({
      ok: true,
      value: {
        mode: "legacy",
        binding: {
          ...binding,
          renderer: { ...PREVIEW_RENDERER, version: "9.0.0" },
        },
      },
    }),
  );
  await expect(
    fetchCurrentPreviewEntry(f.scope, new AbortController().signal),
  ).rejects.toThrow("PREVIEW_BINDING_MISMATCH");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
