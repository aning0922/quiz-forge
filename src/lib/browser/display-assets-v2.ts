import { loadVerifiedImage } from "./display-assets";
import type { DisplayAssetV1 } from "@/lib/assessment-contract/display-v1";
import type {
  DisplayAssetV2,
  DisplayResourceTransportV2,
} from "@/lib/assessment-contract/display-v2";
export type { VerifiedImage } from "./display-assets";
/** The frozen byte decoder never interprets approval. Adapt its type only;
 * the actual object, including private-test-only, is passed unchanged.
 * Admission remains the exact v2 owner + server scope, never this decoder. */
export function loadVerifiedImageV2(
  asset: DisplayAssetV2,
  transport: DisplayResourceTransportV2,
  signal: AbortSignal,
  deadline = Infinity,
) {
  return loadVerifiedImage(
    asset as DisplayAssetV1,
    (_unchanged, active, until) => transport(asset, active, until),
    signal,
    deadline,
  );
}
