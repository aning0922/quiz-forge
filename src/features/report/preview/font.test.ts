import { afterEach, describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PREVIEW_FONT_ASSET } from "@/features/product/preview/descriptor";
import { withPreviewFont } from "./font";
import { DisplayClientError as PreviewClientError } from "@/lib/browser/display-task";
afterEach(() => vi.unstubAllGlobals());
async function setup(corrupt = false) {
  const bytes = await readFile(`public${PREVIEW_FONT_ASSET.file}`),
    coverage = await readFile(`public${PREVIEW_FONT_ASSET.coverage}`),
    add = vi.fn(),
    remove = vi.fn(),
    constructed = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          new Uint8Array(
            path === PREVIEW_FONT_ASSET.file
              ? corrupt
                ? bytes.subarray(1)
                : bytes
              : coverage,
          ),
        ),
    ),
  );
  vi.stubGlobal("document", {
    fonts: { add, delete: remove, check: () => true },
  });
  vi.stubGlobal(
    "FontFace",
    class {
      status = "loaded";
      constructor() {
        constructed();
      }
      async load() {
        return this;
      }
    },
  );
  return { add, remove, constructed };
}
describe("verified controlled poster font", () => {
  it("loads only hash-verified bytes, checks coverage and releases the exact face after use", async () => {
    const { add, remove } = await setup();
    const render = vi.fn(async () => "rendered");
    expect(
      await withPreviewFont(
        PREVIEW_FONT_ASSET,
        ["内部预览／待审／非正式报告", "100.0"],
        new AbortController().signal,
        render,
      ),
    ).toBe("rendered");
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(add.mock.calls[0]![0]);
    expect(render).toHaveBeenCalledOnce();
  });
  it("a corrupted font never constructs or renders a face", async () => {
    const { constructed } = await setup(true),
      render = vi.fn();
    await expect(
      withPreviewFont(
        PREVIEW_FONT_ASSET,
        ["内部预览"],
        new AbortController().signal,
        render,
      ),
    ).rejects.toThrow("FONT_UNAVAILABLE");
    expect(constructed).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
  it("uncovered characters block export before font construction", async () => {
    const { constructed } = await setup(),
      render = vi.fn();
    await expect(
      withPreviewFont(
        PREVIEW_FONT_ASSET,
        ["🧪"],
        new AbortController().signal,
        render,
      ),
    ).rejects.toThrow("FONT_COVERAGE");
    expect(constructed).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
  it("font loading which finishes after abort cannot register or render", async () => {
    const { add } = await setup();
    let finish: ((value: unknown) => void) | undefined;
    vi.stubGlobal(
      "FontFace",
      class {
        status = "loaded";
        load() {
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
      },
    );
    const controller = new AbortController(),
      render = vi.fn(),
      task = withPreviewFont(
        PREVIEW_FONT_ASSET,
        ["内部预览"],
        controller.signal,
        render,
      );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    controller.abort();
    await expect(task).rejects.toThrow("PREVIEW_CANCELLED");
    finish!({});
    expect(add).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
  it("preserves image/layout/encoding failures raised after verified font loading", async () => {
    await setup();
    await expect(
      withPreviewFont(
        PREVIEW_FONT_ASSET,
        ["内部预览"],
        new AbortController().signal,
        async () => {
          throw new PreviewClientError("POSTER_LIMIT_EXCEEDED");
        },
      ),
    ).rejects.toThrow("POSTER_LIMIT_EXCEEDED");
  });
});
