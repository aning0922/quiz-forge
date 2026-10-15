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
import type { PreviewPosterExport } from "@/features/product/preview/contracts";
import { exportPreviewPoster } from "./export";
const release = vi.hoisted(() => vi.fn());
vi.mock("./font", () => ({
  withPreviewFont: async (
    _texts: unknown,
    _signal: AbortSignal,
    render: (f: string, signal: AbortSignal) => unknown,
  ) => render("VerifiedTestFace", _signal),
}));
vi.mock("@/features/studio/preview/media", () => ({
  loadPreviewImage: async () => ({
    image: { naturalWidth: 48, naturalHeight: 48 },
    release,
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  release.mockClear();
});
async function input(): Promise<PreviewPosterExport> {
  const c = await previewFixture(),
    p = preparePreviewContent(c, sourceBinding(c));
  if (!p.ok) throw Error(p.code);
  const r = scorePreview(p.value.prepared, answers(c), requestId);
  if (!r.ok || r.value.poster.kind !== "ready") throw Error("fixture");
  const v = r.value;
  return {
    binding: v.binding,
    requestId: v.requestId,
    answersHash: v.answersHash,
    logicHash: v.logicHash,
    selectedResultRef: v.selectedResultRef,
    reportTemplateRef: v.reportTemplateRef,
    poster: v.poster as PreviewPosterExport["poster"],
  };
}
function canvas(encode: (callback: (b: Blob | null) => void) => void) {
  const ctx = {
    font: "",
    textBaseline: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: (s: string) => ({
      width: [...s].length * 24,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxAscent: 0,
      actualBoundingBoxRight: [...s].length * 24,
      actualBoundingBoxDescent: 24,
    }),
  };
  const element = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: encode,
  };
  vi.stubGlobal("document", { createElement: () => element });
  return { element, ctx };
}
describe("canvas generation gate (mock canvas, not visual acceptance)", () => {
  it("encodes exactly 1080×1920 and releases the verified portrait", async () => {
    const { element, ctx } = canvas((cb) =>
        cb(new Blob(["synthetic"], { type: "image/png" })),
      ),
      result = await exportPreviewPoster(
        await input(),
        new AbortController().signal,
        () => true,
      );
    expect(result.type).toBe("image/png");
    expect([element.width, element.height]).toEqual([1080, 1920]);
    expect(ctx.drawImage).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
  it("a late encoding completion cannot return an outdated poster", async () => {
    let finish: ((b: Blob | null) => void) | undefined,
      current = true;
    canvas((cb) => {
      finish = cb;
    });
    const task = exportPreviewPoster(
      await input(),
      new AbortController().signal,
      () => current,
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    current = false;
    finish!(new Blob(["late"], { type: "image/png" }));
    await expect(task).rejects.toThrow("PREVIEW_CANCELLED");
    expect(release).toHaveBeenCalledOnce();
  });
  it("null PNG and cancellation settle finite failures without a successful download", async () => {
    canvas((cb) => cb(null));
    await expect(
      exportPreviewPoster(
        await input(),
        new AbortController().signal,
        () => true,
      ),
    ).rejects.toThrow("PNG_UNAVAILABLE");
    let finish: ((b: Blob | null) => void) | undefined;
    canvas((cb) => {
      finish = cb;
    });
    const controller = new AbortController(),
      task = exportPreviewPoster(await input(), controller.signal, () => true);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    controller.abort();
    await expect(task).rejects.toThrow("PNG_UNAVAILABLE");
    finish!(new Blob(["late"], { type: "image/png" }));
  });
});
