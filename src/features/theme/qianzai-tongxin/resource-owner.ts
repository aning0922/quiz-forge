import type { DisplayAssetV1 } from "@/lib/assessment-contract/display-v1";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import type { ConsumerResourceLeaseV2 } from "../consumer-v2/resource-port";
import {
  loadVerifiedImage,
  type VerifiedImage,
} from "@/lib/browser/display-assets";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";

export type QianzaiImageLayer =
  "clean" | "prototype-scene-base" | "prototype-option-skin";
export type QianzaiAssetSlot =
  | "cover"
  | "preferenceScene"
  | "reportPaper"
  | "reportBorder"
  | "seal"
  | `acts.${0 | 1 | 2}.${"background" | "questionPaper" | "optionIdle" | "optionSelected"}`
  | `character.${"reveal" | "nameArt" | "report" | "poster"}`;
export type QianzaiAssetBinding = Readonly<{
  asset: Omit<DisplayAssetV1, "alt">;
  slot: QianzaiAssetSlot;
  layer: QianzaiImageLayer;
}>;
export type QianzaiAdmittedBinding = Omit<QianzaiAssetBinding, "asset"> &
  Readonly<{ asset: DisplayAssetV1 }>;
export type QianzaiOwnedImage = QianzaiAdmittedBinding &
  Readonly<{ objectUrl: `blob:${string}` }>;
const sameRef = (
  a: DisplayAssetV1["resourceRef"],
  b: DisplayAssetV1["resourceRef"] | undefined,
) =>
  !!b &&
  a.productId === b.productId &&
  a.id === b.id &&
  a.version === b.version;
/** A role label is granted only by the fixed byte mapping AND its typed slot. */
export function admittedQianzaiBindings(
  model: ConsumerV2ReaderModel,
  fixed: readonly QianzaiAssetBinding[],
) {
  if (model.phase === "denied") return [];
  const assets = model.report?.view.display.assets ?? model.entry?.assets ?? [];
  const n = model.report?.view.display.slots.neutral ?? model.entry?.slots;
  return fixed.flatMap((binding) => {
    const a = binding.asset;
    const declared = assets.find((v) => {
      const { alt, ...facts } = v;
      void alt;
      return sameConsumerFact(facts, a, 8192);
    });
    if (a.approval !== "approved" || !declared || !n) return [];
    const parts = binding.slot.split(".");
    const character = model.report?.view.display.slots.character;
    if (
      parts[0] === "character" &&
      (!character ||
        !sameRef(
          character.resultRef,
          model.report?.view.display.selectedResultRef,
        ))
    )
      return [];
    const ref =
      parts[0] === "acts"
        ? n.acts[Number(parts[1])]?.[
            parts[2] as
              "background" | "questionPaper" | "optionIdle" | "optionSelected"
          ]
        : parts[0] === "character"
          ? character?.[parts[1] as "reveal" | "nameArt" | "report" | "poster"]
          : n[
              binding.slot as
                | "cover"
                | "preferenceScene"
                | "reportPaper"
                | "reportBorder"
                | "seal"
            ];
    if (!sameRef(a.resourceRef, ref ?? undefined)) return [];
    if (
      binding.layer === "prototype-scene-base" &&
      (model.report ||
        !(
          binding.slot === "cover" ||
          binding.slot === "preferenceScene" ||
          /^acts\.[0-2]\.background$/.test(binding.slot)
        ))
    )
      return [];
    if (
      binding.layer === "prototype-option-skin" &&
      (model.report ||
        !/^acts\.[0-2]\.(optionIdle|optionSelected)$/.test(binding.slot))
    )
      return [];
    return [{ ...binding, asset: declared }];
  });
}
type Loader = typeof loadVerifiedImage;
/** One view/authority generation owns every URL. Late completions are released, never adopted. */
export class QianzaiResourceOwner {
  #abort = new AbortController();
  #live = true;
  #loaded: VerifiedImage[] = [];
  #images: readonly QianzaiOwnedImage[] = [];
  #listeners = new Set<() => void>();
  constructor(
    readonly lease: ConsumerResourceLeaseV2,
    readonly loader: Loader = loadVerifiedImage,
  ) {
    lease.signal.addEventListener("abort", this.dispose, { once: true });
    if (lease.signal.aborted || !lease.current()) this.dispose();
  }
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getSnapshot = () => this.#images;
  current = () =>
    this.#live && !this.#abort.signal.aborted && this.lease.current();
  async load(bindings: readonly QianzaiAdmittedBinding[]) {
    // Bounded two-at-a-time; no directory fetch, other-character prefetch or automatic retry.
    let cursor = 0;
    const worker = async () => {
      while (this.current() && cursor < bindings.length) {
        const binding = bindings[cursor++]!;
        try {
          const image = await this.loader(
            binding.asset,
            this.lease.transport,
            this.#abort.signal,
          );
          if (!this.current()) {
            image.release();
            continue;
          }
          if (!image.url.startsWith("blob:")) {
            image.release();
            continue;
          }
          this.#loaded.push(image);
          this.#images = Object.freeze([
            ...this.#images,
            Object.freeze({
              ...binding,
              objectUrl: image.url as `blob:${string}`,
            }),
          ]);
          for (const listener of this.#listeners) listener();
        } catch {
          /* Missing/invalid art falls back to the view's opaque program surface. */
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }
  dispose = () => {
    if (!this.#live) return;
    this.#live = false;
    this.#abort.abort();
    this.lease.signal.removeEventListener("abort", this.dispose);
    for (const image of this.#loaded) image.release();
    this.#loaded = [];
    this.#images = Object.freeze([]);
    for (const listener of this.#listeners) listener();
  };
}
