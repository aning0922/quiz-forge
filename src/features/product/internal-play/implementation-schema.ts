import { z } from "zod";
import { rendererImplementationDescriptorSchema } from "../internal-versions/implementation-schema";
import {
  consumerIdSchema,
  consumerVersionSchema,
  consumerSha256Schema,
} from "@/lib/consumer-contract/v1/primitives";
import {
  consumerComponentMappingSchema,
  consumerMappingSha256,
  consumerProtocolsSchema,
} from "@/lib/consumer-contract/v1/identities";
import {
  consumerCanonicalText,
  consumerTextSha256,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";

export const CONSUMER_IMPLEMENTATION_DESCRIPTOR_BYTES = 262_144;
/**
 * Immutable metadata vocabulary only. No supplied descriptor can register executable code.
 * Reuse the stable source/lock/font vocabulary while preserving all old descriptor bytes.
 */
export const consumerImplementationDescriptorSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-implementation-entry.v1"),
    kind: z.literal("consumer-renderer"),
    id: consumerIdSchema,
    version: consumerVersionSchema,
    capability: z.literal("local-internal-consumer"),
    contentSchemaVersion: z.literal("quizpack-content.v2"),
    mapping: consumerComponentMappingSchema,
    mappingSha256: consumerSha256Schema,
    protocols: consumerProtocolsSchema,
    font: rendererImplementationDescriptorSchema.shape.font,
    closure: rendererImplementationDescriptorSchema.shape.closure,
    implementationSha256: consumerSha256Schema,
  })
  .superRefine((v, ctx) => {
    if (
      !withinConsumerBytes(v, CONSUMER_IMPLEMENTATION_DESCRIPTOR_BYTES) ||
      !v.closure.entrypoints.some((e) => e.runtime === "browser") ||
      !v.closure.entrypoints.some((e) => e.runtime === "server") ||
      v.closure.runtimePolicy.browser !== "standards-dom-canvas-webcrypto" ||
      v.closure.runtimePolicy.jsxImport !== "react/jsx-runtime"
    )
      ctx.addIssue({
        code: "custom",
        message: "Incomplete consumer implementation metadata.",
      });
  });
export const consumerImplementationEntrySchema = z
  .strictObject({
    descriptor: consumerImplementationDescriptorSchema,
    entrySha256: consumerSha256Schema,
  })
  .refine((v) =>
    withinConsumerBytes(v, CONSUMER_IMPLEMENTATION_DESCRIPTOR_BYTES),
  );
export const consumerImplementationDescriptorText = (input: unknown) =>
  consumerCanonicalText(
    consumerImplementationDescriptorSchema.parse(input),
    CONSUMER_IMPLEMENTATION_DESCRIPTOR_BYTES,
  );
export const consumerImplementationDescriptorSha256 = (input: unknown) =>
  consumerTextSha256(consumerImplementationDescriptorText(input));
export const consumerImplementationClosureSha256 = (input: unknown) =>
  consumerTextSha256(
    consumerCanonicalText(
      rendererImplementationDescriptorSchema.shape.closure.parse(input),
      CONSUMER_IMPLEMENTATION_DESCRIPTOR_BYTES,
    ),
  );

/** Self-consistency only. Files, lock records, compiled mapping and availability are checked separately. */
export async function verifyConsumerImplementationEntry(input: unknown) {
  const v = consumerImplementationEntrySchema.parse(input);
  const [entry, closure, mapping] = await Promise.all([
    consumerImplementationDescriptorSha256(v.descriptor),
    consumerImplementationClosureSha256(v.descriptor.closure),
    consumerMappingSha256(v.descriptor.mapping),
  ]);
  if (
    entry !== v.entrySha256 ||
    closure !== v.descriptor.implementationSha256 ||
    mapping !== v.descriptor.mappingSha256
  )
    throw Error("CONSUMER_IMPLEMENTATION_METADATA_MISMATCH");
  return v;
}
export type ConsumerImplementationEntry = z.infer<
  typeof consumerImplementationEntrySchema
>;
export type ConsumerImplementationDescriptor = z.infer<
  typeof consumerImplementationDescriptorSchema
>;
