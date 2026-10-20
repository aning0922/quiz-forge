import { z } from "zod";
import { DISPLAY_COMPONENT_IDS_V1 } from "@/lib/assessment-contract/display-limits-v1";
import { engineDeclarationSchema } from "@/lib/assessment-contract/primitives";
import {
  consumerIdSchema as id,
  consumerVersionSchema as version,
  consumerSha256Schema as sha,
} from "./primitives";
import { consumerCanonicalText, consumerTextSha256 } from "./integrity";
import { CONSUMER_LIMITS_V1 as L } from "./limits";

/** Historical metadata may remain readable while an exact compiled implementation is unavailable. */
export const consumerRendererIdentitySchema = z.strictObject({
  kind: z.literal("consumer-renderer"),
  id,
  version,
  entrySha256: sha,
});
export const consumerEngineIdentitySchema = z.strictObject({
  kind: z.literal("engine"),
  ...engineDeclarationSchema.shape,
  entrySha256: sha,
});
export const consumerFontIdentitySchema = z.strictObject({
  id,
  version,
  fileSha256: sha,
  coverageSha256: sha,
  licenseSha256: sha,
  weight: z.literal(600),
});
const runtimeComponent = z.strictObject({
  id: id.refine((value) => value.startsWith("consumer-")),
  version,
  propsSchemaVersion: z.literal("1.0.0"),
});
const binding = <S extends keyof typeof DISPLAY_COMPONENT_IDS_V1>(state: S) =>
  z.strictObject({
    source: z.strictObject({
      id: z.literal(DISPLAY_COMPONENT_IDS_V1[state]),
      version: z.literal("2.0.0"),
      propsSchemaVersion: z.literal("1.0.0"),
    }),
    runtime: runtimeComponent,
  });
export const consumerComponentMappingSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-component-map.v1"),
    states: z.strictObject({
      cover: binding("cover"),
      question: binding("question"),
      resume: binding("resume"),
      result: binding("result"),
      report: binding("report"),
      poster: binding("poster"),
    }),
  })
  .refine(
    (value) =>
      new Set(Object.values(value.states).map((item) => item.runtime.id))
        .size === 6,
  );
export const consumerMappingText = (input: unknown) =>
  consumerCanonicalText(
    consumerComponentMappingSchema.parse(input),
    L.playRequestBytes,
  );
export const consumerMappingSha256 = (input: unknown) =>
  consumerTextSha256(consumerMappingText(input));

export const CONSUMER_PROTOCOLS_V1 = Object.freeze({
  access: "quizforge.consumer-access.v1",
  state: "quizforge.consumer-state.v1",
  answers: "quizforge.consumer-state-answers.v1",
  progress: "quizforge.consumer-state-progress.v1",
  save: "quizforge.consumer-save.v1",
  complete: "quizforge.consumer-complete.v1",
  report: "quizforge.consumer-report-snapshot.v1",
} as const);
export const consumerProtocolsSchema = z.strictObject({
  access: z.literal(CONSUMER_PROTOCOLS_V1.access),
  state: z.literal(CONSUMER_PROTOCOLS_V1.state),
  answers: z.literal(CONSUMER_PROTOCOLS_V1.answers),
  progress: z.literal(CONSUMER_PROTOCOLS_V1.progress),
  save: z.literal(CONSUMER_PROTOCOLS_V1.save),
  complete: z.literal(CONSUMER_PROTOCOLS_V1.complete),
  report: z.literal(CONSUMER_PROTOCOLS_V1.report),
});
export type ConsumerRendererIdentity = z.infer<
  typeof consumerRendererIdentitySchema
>;
export type ConsumerEngineIdentity = z.infer<
  typeof consumerEngineIdentitySchema
>;
export type ConsumerFontIdentity = z.infer<typeof consumerFontIdentitySchema>;
export type ConsumerComponentMapping = z.infer<
  typeof consumerComponentMappingSchema
>;
