import { z } from "zod";
import { CONTENT_COMPONENTS_V3 } from "@/lib/assessment-contract/presentation-v3";
import { engineDeclarationV2Schema } from "@/lib/assessment-contract/scoring-v2";
import {
  consumerIdSchema,
  consumerVersionSchema,
  consumerSha256Schema,
} from "../v1/primitives";
import { consumerCanonicalText, consumerTextSha256 } from "../v1/integrity";

export const consumerEngineIdentityV2Schema = z.strictObject({
  kind: z.literal("engine"),
  ...engineDeclarationV2Schema.shape,
  entrySha256: consumerSha256Schema,
});
const pair = (state: keyof typeof CONTENT_COMPONENTS_V3) =>
  z.strictObject({
    source: z.strictObject({
      id: z.literal(CONTENT_COMPONENTS_V3[state]),
      version: z.literal("1.0.0"),
      propsSchemaVersion: z.literal("1.0.0"),
    }),
    runtime: z.strictObject({
      id: consumerIdSchema.refine((id) => id.startsWith("consumer-")),
      version: consumerVersionSchema,
      propsSchemaVersion: z.literal("1.0.0"),
    }),
  });
export const consumerComponentMappingV2Schema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-component-map.v2"),
    states: z.strictObject({
      cover: pair("cover"),
      question: pair("question"),
      resume: pair("resume"),
      result: pair("result"),
      report: pair("report"),
      poster: pair("poster"),
    }),
  })
  .refine(
    (v) => new Set(Object.values(v.states).map((p) => p.runtime.id)).size === 6,
  );
export const consumerMappingSha256V2 = (input: unknown) =>
  consumerTextSha256(
    consumerCanonicalText(consumerComponentMappingV2Schema.parse(input), 8192),
  );
export const CONSUMER_PROTOCOLS_V2 = Object.freeze({
  access: "quizforge.consumer-access.v1",
  state: "quizforge.consumer-state.v2",
  answers: "quizforge.consumer-state-answers.v1",
  progress: "quizforge.consumer-state-progress.v1",
  matching: "quiz-matching-context.v1",
  save: "quizforge.consumer-save.v2",
  complete: "quizforge.consumer-complete.v2",
  report: "quizforge.consumer-report-snapshot.v2",
} as const);
export const consumerProtocolsV2Schema = z.strictObject({
  access: z.literal(CONSUMER_PROTOCOLS_V2.access),
  state: z.literal(CONSUMER_PROTOCOLS_V2.state),
  answers: z.literal(CONSUMER_PROTOCOLS_V2.answers),
  progress: z.literal(CONSUMER_PROTOCOLS_V2.progress),
  matching: z.literal(CONSUMER_PROTOCOLS_V2.matching),
  save: z.literal(CONSUMER_PROTOCOLS_V2.save),
  complete: z.literal(CONSUMER_PROTOCOLS_V2.complete),
  report: z.literal(CONSUMER_PROTOCOLS_V2.report),
});
export type ConsumerComponentMappingV2 = z.infer<
  typeof consumerComponentMappingV2Schema
>;
