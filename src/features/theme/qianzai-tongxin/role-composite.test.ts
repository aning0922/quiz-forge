import { describe, expect, it } from "vitest";
import { structuredReaderFixtureV2 } from "../consumer-v2/fixtures.test-support";
import {
  admittedQianzaiBindings,
  QianzaiResourceOwner,
  type QianzaiAssetBinding,
} from "./resource-owner";
import { qianzaiRoleComposite, qianzaiImage } from "./art";
import { qianzaiRolePresentation } from "@/features/report/qianzai-tongxin/role-presentation";

function fixture() {
  const model = structuredReaderFixtureV2().completed;
  const display = model.report!.view.display;
  const exemplar = display.assets[0]!;
  const images = ["before", "full"].map((stage, i) => ({
    layer: "role-composite" as const,
    asset: {
      ...exemplar,
      resourceRef: { ...exemplar.resourceRef, id: `composite-${stage}` },
      sha256: String(i + 1).repeat(64),
      width: 780,
      height: 1688,
      purpose: "decoration" as const,
      approval: "approved" as const,
    },
    objectUrl: `blob:${stage}` as `blob:${string}`,
  }));
  display.assets.push(...images.map((i) => i.asset));
  display.slots.character.revealComposite = {
    kind: "role-composite.v1",
    before: images[0]!.asset.resourceRef,
    full: images[1]!.asset.resourceRef,
  };
  const bindings: QianzaiAssetBinding[] = images.map((image, i) => {
    const { alt, ...asset } = image.asset;
    void alt;
    return {
      asset,
      layer: image.layer,
      slot:
        i === 0
          ? "character.revealComposite.before"
          : "character.revealComposite.full",
    };
  });
  return { model, display, images, bindings };
}

describe("selected role composite artwork", () => {
  it("admits only both exact registered frames without mutating the sealed report", () => {
    const { model, bindings, images } = fixture();
    const before = structuredClone(model.report);
    expect(admittedQianzaiBindings(model, bindings)).toHaveLength(2);
    expect(qianzaiRoleComposite(model, images)?.full.objectUrl).toBe(
      "blob:full",
    );
    expect(qianzaiRoleComposite(model, [images[0]!])).toBeUndefined();
    expect(admittedQianzaiBindings(model, bindings.slice(0, 1))).toEqual([]);
    expect(
      qianzaiImage(model, images[0]!.asset.resourceRef, []),
    ).toBeUndefined();
    expect(model.report).toEqual(before);
  });
  it("rejects mismatched roles, byte facts, slots, dimensions, pending completion and lost authority", () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.display.body.matching.selected.ref.id = "other-role";
      },
      (f: ReturnType<typeof fixture>) => {
        f.display.selectedResultRef.version = "other-version";
      },
      (f: ReturnType<typeof fixture>) => {
        f.bindings[0]!.asset.sha256 = "0".repeat(64);
      },
      (f: ReturnType<typeof fixture>) => {
        f.bindings[0] = { ...f.bindings[0]!, slot: "character.nameArt" };
      },
      (f: ReturnType<typeof fixture>) => {
        f.display.assets.at(-1)!.height++;
        f.bindings[1]!.asset.height++;
      },
      (f: ReturnType<typeof fixture>) => {
        f.model.pendingOperation = "complete";
      },
      (f: ReturnType<typeof fixture>) => {
        f.model.phase = "denied";
      },
    ]) {
      const f = fixture();
      mutate(f);
      expect(admittedQianzaiBindings(f.model, f.bindings)).toEqual([]);
    }
  });
  it("releases both artwork URLs with their original authority lease", async () => {
    const { model, bindings } = fixture(),
      abort = new AbortController();
    let releases = 0;
    const owner = new QianzaiResourceOwner(
      {
        generation: 1,
        model,
        getSnapshot: () => model,
        view: model.report!.view,
        signal: abort.signal,
        current: () => !abort.signal.aborted,
        transport: async () => {
          throw Error("not used");
        },
      },
      async (asset) => ({
        url: `blob:${asset.resourceRef.id}`,
        image: {} as HTMLImageElement,
        release: () => {
          releases++;
        },
      }),
    );
    await owner.load(admittedQianzaiBindings(model, bindings));
    expect(owner.getSnapshot()).toHaveLength(2);
    abort.abort();
    expect(owner.getSnapshot()).toEqual([]);
    expect(releases).toBe(2);
  });
  it("never supplies Li Bai literary metadata to another result or version", () => {
    const ref = {
      productId: "qianzai-tongxin",
      id: "li-bai",
      version: "1.0.0",
    };
    expect(qianzaiRolePresentation(ref)?.identity.honorific).toBe("诗仙");
    for (const changed of [
      { ...ref, id: "su-shi" },
      { ...ref, version: "2.0.0" },
      { ...ref, productId: "other" },
    ])
      expect(qianzaiRolePresentation(changed)).toBeUndefined();
  });
});
