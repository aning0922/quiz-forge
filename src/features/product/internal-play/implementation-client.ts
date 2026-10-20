import { z } from "zod";
import type { DisplayFontDescriptorV1 } from "@/lib/assessment-contract/display-v1";
import {
  consumerRendererIdentitySchema,
  consumerComponentMappingSchema,
  consumerFontIdentitySchema,
} from "@/lib/consumer-contract/v1/identities";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  findConsumerImplementationDescriptor,
  consumerImplementationAvailable,
} from "./implementation-catalog";
import { bindConsumerRendererClientV1 } from "@/features/theme/consumer-v1/renderer-client-v1";
/** Never binds a nearby version, a source preview identity, or input-provided executable code. */
export function resolveConsumerRendererClient(input: unknown) {
  const parsed = consumerRendererIdentitySchema.safeParse(input);
  if (!parsed.success || !consumerImplementationAvailable(parsed.data))
    return null;
  const entry = findConsumerImplementationDescriptor(parsed.data);
  if (!entry) return null;
  const selected = entry.descriptor.font;
  const font: DisplayFontDescriptorV1 = {
    ...selected,
    file: selected.file as DisplayFontDescriptorV1["file"],
    coverage: selected.coverage as DisplayFontDescriptorV1["coverage"],
    licenseFile: selected.licenseFile as DisplayFontDescriptorV1["licenseFile"],
  };
  const runtime = bindConsumerRendererClientV1(entry.descriptor.mapping, font);
  if (!runtime) return null;
  return Object.freeze({
    identity: Object.freeze(parsed.data),
    descriptor: entry.descriptor,
    ...runtime,
  });
}
const runtimeFactsSchema = z.strictObject({
  renderer: consumerRendererIdentitySchema,
  mapping: consumerComponentMappingSchema,
  font: consumerFontIdentitySchema,
});
/** Host injection boundary validates the verified server facts against this exact compiled descriptor. */
export function resolveConsumerExperienceRuntime(input: unknown) {
  const parsed = runtimeFactsSchema.safeParse(input);
  if (!parsed.success) return null;
  const runtime = resolveConsumerRendererClient(parsed.data.renderer);
  if (!runtime) return null;
  const font = runtime.descriptor.font;
  const expectedFont = {
    id: font.id,
    version: font.version,
    weight: font.weight,
    fileSha256: font.fileSha256,
    coverageSha256: font.coverageSha256,
    licenseSha256: font.licenseSha256,
  };
  if (
    !sameConsumerFact(
      parsed.data.mapping,
      runtime.descriptor.mapping,
      L.playRequestBytes,
    ) ||
    !sameConsumerFact(parsed.data.font, expectedFont, L.operationRequestBytes)
  )
    return null;
  return runtime;
}
