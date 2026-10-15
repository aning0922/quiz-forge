import { z } from "zod";
import {
  assessmentIdSchema,
  assessmentReferenceSchema as ref,
} from "@/lib/assessment-contract/primitives";
import { quizPackContentSchema } from "../v1/content";

// Scalar validation works both with Unicode-aware and UTF-16 regexp engines.
const scalarText =
  /^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*(?![\s\S])/;
const permittedText =
  /^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*(?![\s\S])/;
const localText =
  /^(?![\s\S]*(?:[hH][tT][tT][pP][sS]?:|[fF][tT][pP]:|[fF][iI][lL][eE]:|[dD][aA][tT][aA]:|[jJ][aA][vV][aA][sS][cC][rR][iI][pP][tT]:|\/\/))[\s\S]*(?![\s\S])/;
const shortTextSchemas = new Map<object, number>();
function shortText(maximum: number) {
  const schema = z
    .string()
    .regex(/\S/)
    .regex(scalarText)
    .regex(permittedText)
    .regex(localText)
    .regex(new RegExp(`^[\\s\\S]{1,${maximum}}(?![\\s\\S])`, "u"));
  shortTextSchemas.set(schema, maximum);
  return schema;
}
const component = (id: string) =>
  z.strictObject({
    id: z.literal(id),
    version: z.literal("2.0.0"),
    propsSchemaVersion: z.literal("1.0.0"),
  });
const ids = {
  cover: "folio-cover",
  question: "folio-question",
  resume: "folio-resume",
  result: "cabinet-result",
  report: "folio-report",
  poster: "folio-poster",
} as const;
export const V2_STATE_COMPONENT_CONTRACTS = Object.freeze(
  Object.fromEntries(
    Object.entries(ids).map(([state, id]) => [
      state,
      Object.freeze({ id, version: "2.0.0", propsSchemaVersion: "1.0.0" }),
    ]),
  ) as Readonly<
    Record<
      keyof typeof ids,
      { id: string; version: "2.0.0"; propsSchemaVersion: "1.0.0" }
    >
  >,
);
const layout = (state: keyof typeof ids) =>
  quizPackContentSchema.shape.layouts.shape[state].extend({
    component: component(ids[state]),
    resourceRefs: z.array(ref).min(1).max(64),
  });
export const quizPackContentV2Schema = quizPackContentSchema.extend({
  schemaVersion: z.literal("quizpack-content.v2"),
  componentVersion: z.literal("2.0.0"),
  layouts: z.strictObject({
    cover: layout("cover"),
    question: layout("question"),
    resume: layout("resume"),
    result: layout("result"),
    report: layout("report"),
    poster: layout("poster"),
  }),
  reportTemplates: quizPackContentSchema.shape.reportTemplates.element
    .extend({ component: component(ids.report) })
    .array()
    .min(1)
    .max(32),
  visualPresentation: z.strictObject({
    coverSceneRef: ref,
    sections: z
      .array(
        z.strictObject({
          id: assessmentIdSchema,
          name: shortText(40),
          chapter: shortText(40),
          introduction: shortText(400),
          sceneRef: ref,
        }),
      )
      .min(1)
      .max(8),
    questionFrames: z
      .array(
        z.strictObject({
          questionRef: ref,
          sectionId: assessmentIdSchema,
          caption: shortText(80),
          sceneOverrideRef: ref.optional(),
        }),
      )
      .min(1)
      .max(100),
    resourceDescriptions: z
      .array(z.strictObject({ resourceRef: ref, alt: shortText(240) }))
      .min(1)
      .max(64),
  }),
  reportPresentation: z.strictObject({
    resultCards: z
      .array(
        z.strictObject({
          resultRef: ref,
          displayName: shortText(80),
          subtitle: shortText(120),
          posterLine: z.strictObject({
            kind: z.literal("original"),
            text: shortText(120),
          }),
          posterDisclosure: shortText(240),
        }),
      )
      .min(1)
      .max(32),
  }),
});
export type QuizPackContentV2 = z.infer<typeof quizPackContentV2Schema>;
export function getQuizPackContentV2JsonSchema() {
  return z.toJSONSchema(quizPackContentV2Schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
    override: ({ zodSchema, jsonSchema }) => {
      const maximum = shortTextSchemas.get(zodSchema);
      if (maximum === undefined) return;
      // JSON Schema measures Unicode code points. Do not emit the runtime's /u
      // length regexp without its flag, which would count surrogate halves.
      jsonSchema.minLength = 1;
      jsonSchema.maxLength = maximum;
      delete jsonSchema.pattern;
      jsonSchema.allOf = [/\S/, scalarText, permittedText, localText].map(
        (rule) => ({ pattern: rule.source }),
      );
    },
  });
}
