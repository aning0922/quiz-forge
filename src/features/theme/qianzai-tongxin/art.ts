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
export type QianzaiVisualProps = {
  images?: readonly QianzaiResolvedImage[];
};
type Ref = DisplayAssetV1["resourceRef"];
export const sameArtRef = (a: Ref, b: Ref) =>
  a.productId === b.productId && a.id === b.id && a.version === b.version;

/** Only exact scoped view-contract assets, never paths, arbitrary URLs or a
 * full character library. A completed report exposes its selected character.
 */
export function qianzaiImage(
  model: ConsumerV2ReaderModel,
  ref: Ref | null | undefined,
  images: readonly QianzaiResolvedImage[] = [],
) {
  if (!ref || model.phase === "denied") return undefined;
  const assets = model.report?.view.display.assets ?? model.entry?.assets ?? [];
  const declared = assets.find((a) => sameArtRef(a.resourceRef, ref));
  if (!declared || declared.approval !== "approved") return undefined;
  return images.find(
    (image) =>
      image.layer === "clean" &&
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

export function qianzaiCharacter(model: ConsumerV2ReaderModel) {
  const display = model.report?.view.display;
  return display &&
    sameArtRef(display.selectedResultRef, display.slots.character.resultRef)
    ? display.slots.character
    : undefined;
}
