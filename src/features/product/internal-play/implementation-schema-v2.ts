import { z } from "zod";
import {
  assessmentIdSchema,
  assessmentVersionSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import {
  implementationClosureV2Schema,
  implementationPresentationV2Shape,
  implementationPresentationCoherentV2,
} from "../internal-versions/implementation-schema-v2";
import {
  consumerComponentMappingV2Schema,
  consumerMappingSha256V2,
  consumerProtocolsV2Schema,
} from "@/lib/consumer-contract/v2/identities";
import {
  consumerCanonicalText,
  consumerTextSha256,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";

export const consumerImplementationDescriptorV2Schema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-implementation-entry.v2"),
    kind: z.literal("consumer-renderer"),
    id: assessmentIdSchema,
    version: assessmentVersionSchema,
    capability: z.literal("local-internal-consumer"),
    contentSchemaVersion: z.literal("quizpack-content.v3"),
    mapping: consumerComponentMappingV2Schema,
    mappingSha256: sha256Schema,
    protocols: consumerProtocolsV2Schema,
    ...implementationPresentationV2Shape,
    closure: implementationClosureV2Schema,
    implementationSha256: sha256Schema,
  })
  .refine(implementationPresentationCoherentV2)
  .refine(
    (v) =>
      v.closure.entrypoints.some((e) => e.runtime === "browser") &&
      v.closure.entrypoints.some((e) => e.runtime === "server") &&
      v.closure.runtimePolicy.browser === "standards-dom-canvas-webcrypto" &&
      v.closure.runtimePolicy.jsxImport === "react/jsx-runtime",
  );
export const consumerImplementationEntryV2Schema = z
  .strictObject({
    descriptor: consumerImplementationDescriptorV2Schema,
    entrySha256: sha256Schema,
  })
  .refine((v) => withinConsumerBytes(v, 262_144));
export type ConsumerImplementationEntryV2 = z.infer<
  typeof consumerImplementationEntryV2Schema
>;
export type ConsumerImplementationDescriptorV2 = z.infer<
  typeof consumerImplementationDescriptorV2Schema
>;
/** Supplied metadata never installs a renderer; a compiled exact catalog is required. */
export async function verifyConsumerImplementationEntryV2(input: unknown) {
  const entry = consumerImplementationEntryV2Schema.parse(input);
  const [descriptorHash, closureHash, mappingHash] = await Promise.all([
    consumerTextSha256(consumerCanonicalText(entry.descriptor, 262_144)),
    consumerTextSha256(
      consumerCanonicalText(entry.descriptor.closure, 262_144),
    ),
    consumerMappingSha256V2(entry.descriptor.mapping),
  ]);
  if (
    descriptorHash !== entry.entrySha256 ||
    closureHash !== entry.descriptor.implementationSha256 ||
    mappingHash !== entry.descriptor.mappingSha256
  )
    throw Error("CONSUMER_IMPLEMENTATION_METADATA_MISMATCH");
  return entry;
}
