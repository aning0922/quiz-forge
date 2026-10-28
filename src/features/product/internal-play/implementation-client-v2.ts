import { z } from "zod";
import { ConsumerExperienceV2 } from "@/features/theme/consumer-v2/host";
import { consumerRendererIdentitySchema } from "@/lib/consumer-contract/v1/identities";
import {
  consumerComponentMappingV2Schema,
  consumerFontIdentityV2Schema,
} from "@/lib/consumer-contract/v2/identities";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerImplementationAvailableV2,
  findConsumerImplementationDescriptorV2,
  consumerImplementationIdentityV2,
} from "./implementation-catalog-v2";
import { QianzaiTongxinRuntime } from "@/features/theme/qianzai-tongxin/runtime";
import { QIANZAI_CONSUMER_RENDERER } from "@/features/theme/qianzai-tongxin/component-map";

export function resolveConsumerRendererClientV2(input: unknown) {
  if (!consumerImplementationAvailableV2(input)) return null;
  const entry = findConsumerImplementationDescriptorV2(input)!;
  return Object.freeze({
    identity: consumerImplementationIdentityV2(entry),
    descriptor: entry.descriptor,
    Experience:
      entry.descriptor.id === QIANZAI_CONSUMER_RENDERER.id
        ? QianzaiTongxinRuntime
        : ConsumerExperienceV2,
  });
}
const runtimeFactsSchema = z.strictObject({
  renderer: consumerRendererIdentitySchema,
  mapping: consumerComponentMappingV2Schema,
  font: consumerFontIdentityV2Schema,
});
/** No nearest-version fallback; all facts must match one exact compiled descriptor. */
export function resolveConsumerExperienceRuntimeV2(input: unknown) {
  const parsed = runtimeFactsSchema.safeParse(input);
  if (!parsed.success) return null;
  const runtime = resolveConsumerRendererClientV2(parsed.data.renderer);
  if (
    !runtime ||
    !sameConsumerFact(
      parsed.data.mapping,
      runtime.descriptor.mapping,
      L.playRequestBytes,
    ) ||
    !sameConsumerFact(
      parsed.data.font,
      "kind" in runtime.descriptor.font
        ? runtime.descriptor.font
        : {
            id: runtime.descriptor.font.id,
            version: runtime.descriptor.font.version,
            weight: runtime.descriptor.font.weight,
            fileSha256: runtime.descriptor.font.fileSha256,
            coverageSha256: runtime.descriptor.font.coverageSha256,
            licenseSha256: runtime.descriptor.font.licenseSha256,
          },
      L.operationRequestBytes,
    )
  )
    return null;
  return runtime;
}
