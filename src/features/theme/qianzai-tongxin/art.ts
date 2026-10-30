import type { DisplayAssetV1 } from "@/lib/assessment-contract/display-v1";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";

/** Supplied by the compiled resource owner AFTER authority/hash/decode checks.
 * This view neither fetches assets nor grants their admission. A clean-layer
 * decision belongs to the owner; old full-page prototypes must never enter here.
 * The owner revokes object URLs and removes this projection on authority loss.
 */
export type QianzaiResolvedImage = Readonly<{
  asset: DisplayAssetV1;
  objectUrl: `blob:${string}`;
  layer: "clean";
}>;
/** Honest local-only projection for the approved prototype composition method.
 * Scene bases contain old UI; option skins can contain a baked letter/check.
 * The compiled owner must verify/admit bytes and label these explicitly.
 * They never pass qianzaiImage's clean character/resource port. */
export type QianzaiPrototypeImage = Omit<QianzaiResolvedImage, "layer"> & {
  layer: "prototype-scene-base" | "prototype-option-skin";
};
export type QianzaiVisualProps = {
  images?: readonly QianzaiResolvedImage[];
  prototypeImages?: readonly QianzaiPrototypeImage[];
};
type Ref = DisplayAssetV1["resourceRef"];
export const sameArtRef = (a: Ref, b: Ref) =>
  a.productId === b.productId && a.id === b.id && a.version === b.version;

/** Only exact scoped view-contract assets, never paths, arbitrary URLs or a
 * full character library. A completed report exposes its selected character.
 */
function scopedImage<T extends QianzaiResolvedImage | QianzaiPrototypeImage>(
  model: ConsumerV2ReaderModel,
  ref: Ref | null | undefined,
  images: readonly T[],
  layer: T["layer"],
) {
  if (!ref || model.phase === "denied") return undefined;
  const assets = model.report?.view.display.assets ?? model.entry?.assets ?? [];
  const declared = assets.find((a) => sameArtRef(a.resourceRef, ref));
  if (!declared || declared.approval !== "approved") return undefined;
  return images.find(
    (image) =>
      image.layer === layer &&
      image.objectUrl.startsWith("blob:") &&
      sameArtRef(image.asset.resourceRef, ref) &&
      image.asset.sha256 === declared.sha256 &&
      image.asset.bytes === declared.bytes &&
      image.asset.width === declared.width &&
      image.asset.height === declared.height &&
      image.asset.mediaType === declared.mediaType &&
      image.asset.purpose === declared.purpose &&
      image.asset.approval === declared.approval,
  );
}

export function qianzaiImage(
  model: ConsumerV2ReaderModel,
  ref: Ref | null | undefined,
  images: readonly QianzaiResolvedImage[] = [],
) {
  return scopedImage(model, ref, images, "clean");
}
export function qianzaiPrototypeImage(
  model: ConsumerV2ReaderModel,
  ref: Ref | null | undefined,
  images: readonly QianzaiPrototypeImage[] = [],
  layer: QianzaiPrototypeImage["layer"] = "prototype-scene-base",
  scope: { act?: number } = {},
) {
  // Finite neutral-slot allowlist. Entry existence alone grants no layer role.
  if (!ref || !model.entry || model.report) return undefined;
  const slots = model.entry.slots as typeof model.entry.slots & {
    preferenceScene?: Ref;
  };
  const act =
    scope.act ??
    model.entry.questions.find(
      (q) => q.ref.id === model.draft?.progress.questionId,
    )?.act;
  const scene = act ? slots.acts[act - 1] : undefined;
  const allowed =
    layer === "prototype-scene-base"
      ? [
          slots.cover,
          slots.preferenceScene,
          ...slots.acts.map((a) => a.background),
        ]
      : [scene?.optionIdle, scene?.optionSelected];
  if (!allowed.some((candidate) => candidate && sameArtRef(candidate, ref)))
    return undefined;
  return scopedImage(model, ref, images, layer);
}

/** A's optional neutral.preferenceScene is projected directly into entry.slots.
 * Local optional typing keeps this UI branch independent of shared-schema edits. */
export function qianzaiPreferenceScene(model: ConsumerV2ReaderModel) {
  return (
    model.entry?.slots as
      | (NonNullable<ConsumerV2ReaderModel["entry"]>["slots"] & {
          preferenceScene?: Ref;
        })
      | undefined
  )?.preferenceScene;
}

export function qianzaiCharacter(model: ConsumerV2ReaderModel) {
  const display = model.report?.view.display;
  return display &&
    sameArtRef(display.selectedResultRef, display.slots.character.resultRef)
    ? display.slots.character
    : undefined;
}
