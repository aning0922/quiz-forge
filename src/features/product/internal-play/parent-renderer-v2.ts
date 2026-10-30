import type { InternalVersionSnapshot } from "../internal-versions/contracts";
import type { ConsumerRendererIdentity } from "@/lib/consumer-contract/v1/identities";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { rendererImplementationAvailableV2 } from "../internal-versions/implementation-catalog-v2";
import {
  consumerImplementationAvailableV2,
  findConsumerImplementationDescriptorV2,
} from "./implementation-catalog-v2";
import {
  QIANZAI_CONSUMER_RENDERER,
  QIANZAI_PREVIEW_RENDERER,
} from "@/features/theme/qianzai-tongxin/component-map";

/** Exact parent family/font/mapping selection only; no latest-version or cross-family fallback. */
export function selectParentConsumerRendererV2(
  parent: InternalVersionSnapshot,
  candidates: readonly ConsumerRendererIdentity[],
) {
  if (
    parent.schemaVersion !== "quizforge.internal-version-snapshot.v2" ||
    !rendererImplementationAvailableV2(parent.renderer)
  )
    return null;
  const id =
    parent.renderer.id === QIANZAI_PREVIEW_RENDERER.id
      ? QIANZAI_CONSUMER_RENDERER.id
      : parent.renderer.id === "structured-composed-preview"
        ? "consumer-structured-composed"
        : null;
  if (!id) return null;
  for (const candidate of candidates) {
    if (candidate.id !== id || !consumerImplementationAvailableV2(candidate))
      continue;
    const d = findConsumerImplementationDescriptorV2(candidate)!.descriptor;
    const font =
      "kind" in d.font
        ? d.font
        : {
            id: d.font.id,
            version: d.font.version,
            weight: d.font.weight,
            fileSha256: d.font.fileSha256,
            coverageSha256: d.font.coverageSha256,
            licenseSha256: d.font.licenseSha256,
          };
    if (
      !sameConsumerFact(font, parent.font, 8192) ||
      Object.entries(d.mapping.states).some(
        ([state, pair]) =>
          !sameConsumerFact(
            pair.source,
            parent.components[state as keyof typeof parent.components],
            8192,
          ),
      )
    )
      continue;
    return candidate;
  }
  return null;
}
