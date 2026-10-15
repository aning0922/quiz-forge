import { afterEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { readVerifiedBytes, loadPreviewImage } from "./media";
import {
  sourceBinding,
  previewFixture,
} from "@/features/theme/preview/fixtures.test-support";
import type { PreviewAsset } from "@/features/product/preview/contracts";
const bytes = new Uint8Array([1, 2, 3, 4]),
  hash = createHash("sha256").update(bytes).digest("hex");
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
describe("complete private image verification", () => {
  it("accepts exact bytes and rejects truncation, extra bytes and same-length hash corruption", async () => {
    expect(
      await readVerifiedBytes(
        new Response(bytes),
        4,
        hash,
        signal(),
        performance.now() + 1000,
      ),
    ).toEqual(bytes);
    for (const value of [
      bytes.slice(0, 3),
      new Uint8Array([1, 2, 3, 4, 5]),
      new Uint8Array([1, 2, 3, 5]),
    ]) {
      await expect(
        readVerifiedBytes(
          new Response(value),
          4,
          hash,
          signal(),
          performance.now() + 1000,
        ),
      ).rejects.toThrow("PREVIEW_RESOURCE_UNAVAILABLE");
    }
  });
  it("deadline and abort settle a body whose producer never returns", async () => {
    for (const kind of ["deadline", "abort"]) {
      const controller = new AbortController();
      let cancelled = false;
      const response = new Response(
        new ReadableStream({
          pull: () => new Promise(() => {}),
          cancel: () => {
            cancelled = true;
          },
        }),
      );
      const task = readVerifiedBytes(
        response,
        4,
        hash,
        controller.signal,
        performance.now() + (kind === "deadline" ? 5 : 1000),
      );
      if (kind === "abort") controller.abort();
      await expect(task).rejects.toThrow(
        kind === "abort" ? "PREVIEW_CANCELLED" : "PREVIEW_TIMEOUT",
      );
      expect(cancelled).toBe(true);
    }
  });
  it("does not create a decode URL for unverified bytes, and revokes a verified URL after dimension mismatch", async () => {
    const content = await previewFixture(),
      binding = sourceBinding(content),
      asset: PreviewAsset = {
        resourceRef: {
          productId: binding.productId,
          id: "portrait",
          version: "1.0.0",
        },
        bytes: 4,
        sha256: hash,
        mediaType: "image/png",
        width: 48,
        height: 48,
        purpose: "portrait",
        approval: "pending",
        alt: "合成测试素材",
      };
    const create = vi.fn(() => "blob:synthetic"),
      revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bytes.slice(0, 3), {
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    await expect(loadPreviewImage(binding, asset, signal())).rejects.toThrow(
      "PREVIEW_RESOURCE_UNAVAILABLE",
    );
    expect(create).not.toHaveBeenCalled();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bytes, { headers: { "content-type": "image/png" } }),
      ),
    );
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 1;
        naturalHeight = 1;
        src = "";
        decode = async () => {};
      },
    );
    await expect(loadPreviewImage(binding, asset, signal())).rejects.toThrow(
      "PREVIEW_RESOURCE_UNAVAILABLE",
    );
    expect(revoke).toHaveBeenCalledWith("blob:synthetic");
  });
  it("late image decode cannot publish after cancellation and its URL is revoked", async () => {
    const content = await previewFixture(),
      binding = sourceBinding(content),
      asset: PreviewAsset = {
        resourceRef: {
          productId: binding.productId,
          id: "portrait",
          version: "1.0.0",
        },
        bytes: 4,
        sha256: hash,
        mediaType: "image/png",
        width: 48,
        height: 48,
        purpose: "portrait",
        approval: "pending",
        alt: "合成测试素材",
      };
    let finish: (() => void) | undefined;
    const controller = new AbortController(),
      revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = () => "blob:late";
        static revokeObjectURL = revoke;
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bytes, { headers: { "content-type": "image/png" } }),
      ),
    );
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 48;
        naturalHeight = 48;
        src = "";
        decode = () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          });
      },
    );
    const task = loadPreviewImage(binding, asset, controller.signal);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    controller.abort();
    await expect(task).rejects.toThrow("PREVIEW_CANCELLED");
    finish!();
    expect(revoke).toHaveBeenCalledWith("blob:late");
  });
});
