import rules from "./known-art-presentation.json";
import type { DisplayAssetV2 } from "@/lib/assessment-contract/display-v2";
import type { QianzaiResultPresentation } from "@/features/report/qianzai-tongxin/result-presentation";
import { QIANZAI_CLASSICAL_EDITION } from "@/features/report/qianzai-tongxin/classical-edition";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";

/** Styling only, after the resource owner and trusted presentation selector.
 * No role-name guess, resource URL, alpha conversion or approval is introduced. */
export function knownQianzaiArtPresentation(
  result: QianzaiResultPresentation | null,
  asset: DisplayAssetV2 | undefined,
  use: "reveal" | "nameArt",
) {
  if (
    !result ||
    !asset ||
    result.profileVersion !== QIANZAI_CLASSICAL_EDITION.presentationVersion ||
    result.source.renderer.id !== "consumer-qianzai-tongxin" ||
    result.source.renderer.version !== QIANZAI_CLASSICAL_EDITION.consumerVersion
  )
    return undefined;
  const { alt, ...facts } = asset;
  void alt;
  return rules.rows.find(
    (row) =>
      row.use === use &&
      sameConsumerFact(row.resultRef, result.role.ref, 8192) &&
      sameConsumerFact(row.asset, facts, 8192),
  )?.presentation;
}
