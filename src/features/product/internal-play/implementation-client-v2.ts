import { z } from "zod";
import { ConsumerExperienceV2 } from "@/features/theme/consumer-v2/host";
import { consumerRendererIdentitySchema } from "@/lib/consumer-contract/v1/identities";
import {
  consumerComponentMappingV2Schema,
  structuredFontIdentityV2Schema,
} from "@/lib/consumer-contract/v2/identities";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  CONSUMER_IMPLEMENTATION_AVAILABILITY_V2,
  consumerImplementationAvailableV2,
  findConsumerImplementationDescriptorV2,
} from "./implementation-catalog-v2";

export function resolveConsumerRendererClientV2(input: unknown) {
  if (!consumerImplementationAvailableV2(input)) return null;
  const entry = findConsumerImplementationDescriptorV2(input)!;
  return Object.freeze({
    identity: CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.structured,
    descriptor: entry.descriptor,
    Experience: ConsumerExperienceV2,
  });
}
const runtimeFactsSchema = z.strictObject({
  renderer: consumerRendererIdentitySchema,
  mapping: consumerComponentMappingV2Schema,
  font: structuredFontIdentityV2Schema,
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
      runtime.descriptor.font,
      L.operationRequestBytes,
    )
  )
    return null;
  return runtime;
}
