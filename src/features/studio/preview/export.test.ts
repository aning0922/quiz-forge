import { afterEach, describe, expect, it, vi } from "vitest";
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
import { PREVIEW_FONT_ASSET } from "@/features/product/preview/descriptor";
import type { PreviewPosterExport } from "@/features/product/preview/contracts";
import { exportPreviewPoster } from "./export";
const render = vi.hoisted(() =>
  vi.fn(async () => new Blob(["synthetic"], { type: "image/png" })),
);
vi.mock("@/features/report/preview/export", () => ({
  exportDisplayPoster: render,
}));
afterEach(() => {
  render.mockClear();
  vi.unstubAllGlobals();
});
async function input(): Promise<PreviewPosterExport> {
  const content = await previewFixture();
  const prepared = preparePreviewContent(content, sourceBinding(content));
  if (!prepared.ok) throw Error("fixture");
  const result = scorePreview(
    prepared.value.prepared,
    answers(content),
    requestId,
  );
  if (!result.ok || result.value.poster.kind !== "ready")
    throw Error("fixture");
  const r = result.value;
  return {
    binding: r.binding,
    requestId: r.requestId,
    answersHash: r.answersHash,
    logicHash: r.logicHash,
    selectedResultRef: r.selectedResultRef,
    reportTemplateRef: r.reportTemplateRef,
    poster: result.value.poster,
  };
}
describe("Studio poster scope adapter", () => {
  it("passes only display body, controlled transport and registered font to the generic renderer", async () => {
    const value = await input();
    const signal = new AbortController().signal;
    const current = () => true;
    await exportPreviewPoster(value, signal, current);
    const [body, transport, font, observedSignal, observedCurrent] = render.mock
      .calls[0]! as unknown as [
      Record<string, unknown>,
      unknown,
      unknown,
      unknown,
      unknown,
    ];
    expect(body).not.toHaveProperty("binding");
    expect(body).not.toHaveProperty("requestId");
    expect(body.poster).toEqual(value.poster);
    expect(body.answersHash).toBe(value.answersHash);
    expect(transport).toBeTypeOf("function");
    expect(font).toBe(PREVIEW_FONT_ASSET);
    expect(observedSignal).toBe(signal);
    expect(observedCurrent).toBe(current);
  });
  it("rejects stale generation and changed renderer before generic rendering", async () => {
    const value = structuredClone(await input());
    const signal = new AbortController().signal;
    await expect(
      exportPreviewPoster(value, signal, () => false),
    ).rejects.toThrow("PREVIEW_CANCELLED");
    value.binding.renderer.version = "9.0.0";
    await expect(
      exportPreviewPoster(value, signal, () => true),
    ).rejects.toThrow("PREVIEW_BINDING_MISMATCH");
    expect(render).not.toHaveBeenCalled();
  });
});
