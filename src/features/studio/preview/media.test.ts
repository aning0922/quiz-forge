import { afterEach, describe, expect, it, vi } from "vitest";
import {
  previewFixture,
  sourceBinding,
} from "@/features/theme/preview/fixtures.test-support";
import type { PreviewAsset } from "@/features/product/preview/contracts";
import { previewResourceUrl } from "@/features/product/preview/urls";
import { createPreviewResourceTransport } from "./media";
import { PreviewClientError } from "./client";
import { DisplayClientError } from "@/lib/browser/display-task";
afterEach(() => vi.unstubAllGlobals());
describe("controlled Studio resource transport", () => {
  it("captures an immutable exact binding and only selects the private resource endpoint", async () => {
    const content = await previewFixture(),
      binding = sourceBinding(content);
    const resource = content.resources[0]!;
    const asset: PreviewAsset = {
      resourceRef: {
        productId: resource.productId,
        id: resource.id,
        version: resource.version,
      },
      mediaType: resource.mediaType,
      bytes: resource.bytes,
      sha256: resource.sha256,
      width: resource.width,
      height: resource.height,
      purpose: resource.purpose,
      approval: resource.approval,
      alt: "合成素材",
    };
    const expected = previewResourceUrl({
      binding,
      resourceRef: asset.resourceRef,
    });
    const transport = createPreviewResourceTransport(binding);
    binding.revision = 2;
    binding.font.fileSha256 = "f".repeat(64);
    const response = new Response(new Uint8Array([1]));
    const fetcher = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    expect(await transport(asset, signal, performance.now() + 1000)).toBe(
      response,
    );
    expect(fetcher).toHaveBeenCalledWith(expected, {
      signal,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
  });
  it("keeps strict Studio HTTP failures and the original error-class identity", async () => {
    expect(PreviewClientError).toBe(DisplayClientError);
    const content = await previewFixture(),
      binding = sourceBinding(content);
    const resource = content.resources[0]!;
    const asset = {
      resourceRef: {
        productId: resource.productId,
        id: resource.id,
        version: resource.version,
      },
    } as PreviewAsset;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "DRAFT_REVISION_NOT_FOUND",
              requestId: "22222222-2222-4222-8222-222222222222",
            }),
            { status: 404, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await expect(
      createPreviewResourceTransport(binding)(
        asset,
        new AbortController().signal,
        performance.now() + 1000,
      ),
    ).rejects.toBeInstanceOf(PreviewClientError);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "DRAFT_REVISION_NOT_FOUND",
              requestId: "22222222-2222-4222-8222-222222222222",
            }),
            { status: 403, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await expect(
      createPreviewResourceTransport(binding)(
        asset,
        new AbortController().signal,
        performance.now() + 1000,
      ),
    ).rejects.toThrow("STUDIO_UNAVAILABLE");
  });
});
