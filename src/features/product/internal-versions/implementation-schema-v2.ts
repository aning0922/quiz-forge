import { z } from "zod";
import { rendererImplementationDescriptorSchema } from "./implementation-schema";
import { engineDeclarationV2Schema } from "@/lib/assessment-contract/scoring-v2";
import {
  assessmentIdSchema,
  assessmentVersionSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import { CONTENT_COMPONENTS_V3 } from "@/lib/assessment-contract/presentation-v3";
import { structuredFontIdentityV2Schema } from "@/lib/consumer-contract/v2/identities";
import {
  consumerCanonicalText,
  consumerTextSha256,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";

/** Reuse immutable closure vocabulary; never widen the historical v1 descriptor. */
export const implementationClosureV2Schema =
  rendererImplementationDescriptorSchema.shape.closure;
export const implementationFontV2Schema = z.union([
  structuredFontIdentityV2Schema,
  rendererImplementationDescriptorSchema.shape.font,
]);
export const implementationPresentationV2Shape = {
  presentationMode: z.enum(["structured-only", "authored-product"]),
  exports: z.strictObject({
    posterPng: z.boolean(),
    fullReportPng: z.boolean(),
  }),
  font: implementationFontV2Schema,
};
export function implementationPresentationCoherentV2(value: {
  presentationMode: "structured-only" | "authored-product";
  exports: { posterPng: boolean; fullReportPng: boolean };
  font: z.infer<typeof implementationFontV2Schema>;
}) {
  const system = "kind" in value.font;
  return value.presentationMode === "structured-only"
    ? system && !value.exports.posterPng && !value.exports.fullReportPng
    : !system;
}
const sourceComponent = (state: keyof typeof CONTENT_COMPONENTS_V3) =>
  z.strictObject({
    id: z.literal(CONTENT_COMPONENTS_V3[state]),
    version: z.literal("1.0.0"),
    propsSchemaVersion: z.literal("1.0.0"),
  });
export const fixedDisplayComponentsV2Schema = z.strictObject({
  cover: sourceComponent("cover"),
  question: sourceComponent("question"),
  resume: sourceComponent("resume"),
  result: sourceComponent("result"),
  report: sourceComponent("report"),
  poster: sourceComponent("poster"),
});
const common = {
  schemaVersion: z.literal("quizforge.implementation-entry.v2"),
  id: assessmentIdSchema,
  version: assessmentVersionSchema,
  contentSchemaVersion: z.literal("quizpack-content.v3"),
  closure: implementationClosureV2Schema,
  implementationSha256: sha256Schema,
};
export const engineImplementationDescriptorV2Schema = z
  .strictObject({
    ...common,
    kind: z.literal("engine"),
    ...engineDeclarationV2Schema.shape,
    algorithm: engineDeclarationV2Schema,
  })
  .refine((v) => v.id === v.algorithm.id && v.version === v.algorithm.version);
export const rendererImplementationDescriptorV2Schema = z
  .strictObject({
    ...common,
    kind: z.literal("renderer"),
    capability: z.literal("studio-internal-preview"),
    components: fixedDisplayComponentsV2Schema,
    ...implementationPresentationV2Shape,
  })
  .refine(implementationPresentationCoherentV2);
export const engineImplementationEntryV2Schema = z.strictObject({
  descriptor: engineImplementationDescriptorV2Schema,
  entrySha256: sha256Schema,
});
export const rendererImplementationEntryV2Schema = z.strictObject({
  descriptor: rendererImplementationDescriptorV2Schema,
  entrySha256: sha256Schema,
});
export const internalImplementationEntryV2Schema = z.union([
  engineImplementationEntryV2Schema,
  rendererImplementationEntryV2Schema,
]);
export type EngineImplementationEntryV2 = z.infer<
  typeof engineImplementationEntryV2Schema
>;
export type RendererImplementationEntryV2 = z.infer<
  typeof rendererImplementationEntryV2Schema
>;
export type InternalImplementationEntryV2 = z.infer<
  typeof internalImplementationEntryV2Schema
>;
/** Metadata self-consistency is not compiled availability or permission to use it. */
export async function verifyInternalImplementationEntryV2(input: unknown) {
  const entry = internalImplementationEntryV2Schema.parse(input);
  if (!withinConsumerBytes(entry, 262_144))
    throw Error("IMPLEMENTATION_METADATA_LIMIT");
  const [descriptorHash, closureHash] = await Promise.all([
    consumerTextSha256(consumerCanonicalText(entry.descriptor, 262_144)),
    consumerTextSha256(
      consumerCanonicalText(entry.descriptor.closure, 262_144),
    ),
  ]);
  if (
    descriptorHash !== entry.entrySha256 ||
    closureHash !== entry.descriptor.implementationSha256
  )
    throw Error("IMPLEMENTATION_METADATA_MISMATCH");
  return entry;
}
