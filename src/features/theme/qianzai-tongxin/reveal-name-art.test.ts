import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { qianzaiPresentationFixture } from "@/features/report/qianzai-tongxin/result-presentation.test-support";
import { QianzaiReveal } from "./views";
import type { QianzaiResolvedImage } from "./art";
async function fixture() {
  const f = await qianzaiPresentationFixture(),
    character = f.view.display.slots.character;
  character.resultRef = { ...f.body.matching.selected.ref };
  const images: QianzaiResolvedImage[] = [
    character.reveal,
    character.nameArt,
  ].map((ref) => ({
    asset: f.view.display.assets.find((a) => a.resourceRef.id === ref.id)!,
    objectUrl: `blob:synthetic-${ref.id}`,
    layer: "clean",
  }));
  const render = (next = f.model, resources = images) =>
    renderToStaticMarkup(
      createElement(QianzaiReveal, {
        model: next,
        images: resources,
        onRead() {},
        onEvent() {},
      }),
    );
  return { ...f, character, images, render };
}
describe("Qianzai selected name-art image", () => {
  it("uses the selected admitted nameArt blob instead of runtime brush text", async () => {
    const f = await fixture(),
      before = structuredClone(f.model),
      html = f.render();
    expect(html).toContain(`src="${f.images[1]!.objectUrl}"`);
    expect(html).toContain('alt="李白姓名字图"');
    expect(html).toContain("data-qianzai-name-art");
    expect(html).not.toContain("data-qztx-program-name");
    expect(f.model).toEqual(before);
  });
  it("does not replace missing, mismatched or unscoped name pixels with generated lettering", async () => {
    const f = await fixture(),
      name = f.images[1]!;
    for (const bad of [
      undefined,
      { ...name, asset: { ...name.asset, sha256: "0".repeat(64) } },
      {
        ...name,
        asset: {
          ...name.asset,
          resourceRef: { ...name.asset.resourceRef, version: "2.0.0" },
        },
      },
      { ...name, objectUrl: "https://example.invalid/name.png" },
    ]) {
      const html = f.render(f.model, [
        f.images[0]!,
        ...(bad ? [bad as QianzaiResolvedImage] : []),
      ]);
      expect(html).not.toContain("data-qianzai-name-art");
      expect(html).toContain("姓名字图暂未就绪");
      expect(html).not.toContain("data-qztx-program-name");
    }
    f.character.resultRef = { ...f.character.resultRef, id: "other-role" };
    expect(f.render()).not.toContain("data-qianzai-name-art");
  });
  it("uses uncropped full-frame geometry only for the exact admitted Li Bai candidate", async () => {
    const f = await fixture();
    const original = f.images[0]!.asset;
    const ref = {
      productId: "qianzai-tongxin",
      id: "qztx-art-li-bai-reveal",
      version: "1.0.0",
    };
    const asset = {
      ...original,
      resourceRef: ref,
      sha256:
        "36e83a15493c4dcbc298fda7b242b13929f4a1c138ab137bf1411af8e9790f91",
      width: 853,
      height: 1844,
      bytes: 2965650,
    };
    const index = f.view.display.assets.indexOf(original);
    const render = (next = asset) => {
      f.view.display.assets[index] = next;
      f.character.reveal = next.resourceRef;
      return f.render(f.model, [
        { ...f.images[0]!, asset: next },
        f.images[1]!,
      ]);
    };
    expect(render()).toContain('data-qianzai-full-reveal="true"');
    expect(render()).not.toContain("data-qianzai-art-crop");
    for (const changed of [
      { ...asset, width: 854 },
      { ...asset, sha256: "0".repeat(64) },
      { ...asset, resourceRef: { ...ref, version: "2.0.0" } },
      { ...asset, resourceRef: { ...ref, id: "another-reveal" } },
    ])
      expect(render(changed)).not.toContain("data-qianzai-full-reveal");
    expect(render(original)).not.toContain("data-qianzai-full-reveal");
  });
});
