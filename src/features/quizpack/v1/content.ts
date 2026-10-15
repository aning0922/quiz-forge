import { z } from "zod";
import { assessmentReferenceSchema as contentReferenceSchema } from "@/lib/assessment-contract/primitives";
import {
  dimensionContributionSchema as dimensionContribution,
  scoringRulesSchema as rules,
} from "@/lib/assessment-contract/scoring-v1";
export { assessmentReferenceSchema as contentReferenceSchema } from "@/lib/assessment-contract/primitives";
import type { Result } from "./api";
import { PACK_LIMITS } from "./limits";
import {
  assetPathSchema,
  componentDeclarationSchema,
  engineDeclarationSchema,
  imageMediaTypeSchema,
  packIdSchema as id,
  packVersionSchema as version,
  sha256Schema,
} from "./manifest";

// Regex constraints are also emitted in the generated JSON Schema; no transforms.
const text = z
  .string()
  .min(1)
  .max(4000)
  .regex(/\S/)
  .regex(/^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/)
  .regex(
    /^(?![\s\S]*(?:[hH][tT][tT][pP][sS]?:|[fF][tT][pP]:|[fF][iI][lL][eE]:|[dD][aA][tT][aA]:|[jJ][aA][vV][aA][sS][cC][rR][iI][pP][tT]:|\/\/))[\s\S]*$/,
  );
const definition = { id, productId: id, version };
const layout = z.strictObject({
  component: componentDeclarationSchema,
  props: z.strictObject({
    heading: text,
    body: text,
    density: z.enum(["comfortable", "compact"]),
    showProgress: z.boolean(),
  }),
  resourceRefs: z.array(contentReferenceSchema).min(1).max(16),
});
export const quizPackContentSchema = z.strictObject({
  schemaVersion: z.literal("quizpack-content.v1"),
  kind: z.enum(["synthetic", "authored"]),
  product: z.strictObject({
    productId: id,
    slug: id,
    title: text,
    categoryId: id,
    tags: z.array(id).max(12),
  }),
  contentVersion: version,
  visualVersion: version,
  reportVersion: version,
  resourceVersion: version,
  componentVersion: version,
  engine: engineDeclarationSchema,
  dimensions: z
    .array(z.strictObject({ ...definition, label: text }))
    .min(1)
    .max(PACK_LIMITS.dimensions),
  questions: z
    .array(
      z.strictObject({
        ...definition,
        prompt: text,
        options: z
          .array(
            z.strictObject({
              ...definition,
              label: text,
              contributions: z
                .array(dimensionContribution)
                .min(1)
                .max(PACK_LIMITS.dimensions),
            }),
          )
          .min(2)
          .max(PACK_LIMITS.optionsPerQuestion),
      }),
    )
    .min(1)
    .max(PACK_LIMITS.questions),
  rules,
  results: z
    .array(
      z.strictObject({
        ...definition,
        label: text,
        portraitRef: contentReferenceSchema,
        reportTemplateRef: contentReferenceSchema,
        witness: z.strictObject({
          status: z.literal("declared-not-executed"),
          answers: z
            .array(
              z.strictObject({
                questionRef: contentReferenceSchema,
                optionRef: contentReferenceSchema,
              }),
            )
            .min(1)
            .max(PACK_LIMITS.questions),
        }),
      }),
    )
    .min(1)
    .max(PACK_LIMITS.results),
  reportTemplates: z
    .array(
      z.strictObject({
        ...definition,
        mode: z.literal("DETERMINISTIC"),
        component: componentDeclarationSchema,
        baseline: z.strictObject({
          title: text,
          summary: text,
          strengths: z.array(text).min(1).max(8),
          tensions: z.array(text).min(1).max(8),
          reflection: text,
          disclaimer: text,
        }),
      }),
    )
    .min(1)
    .max(PACK_LIMITS.results),
  layouts: z.strictObject({
    cover: layout,
    question: layout,
    resume: layout,
    result: layout,
    report: layout,
    poster: layout,
  }),
  resources: z
    .array(
      z.strictObject({
        ...definition,
        path: assetPathSchema,
        mediaType: imageMediaTypeSchema,
        bytes: z.number().int().positive().max(PACK_LIMITS.resourceBytes),
        sha256: sha256Schema,
        width: z.number().int().positive().max(PACK_LIMITS.imageDimension),
        height: z.number().int().positive().max(PACK_LIMITS.imageDimension),
        purpose: z.enum(["cover", "portrait", "decoration"]),
        source: z.strictObject({
          kind: z.enum(["original", "licensed", "ai-generated"]),
          attribution: text,
          evidence: text,
        }),
        license: z.strictObject({
          commercialUse: z.literal(true),
          redistribution: z.literal(true),
          evidence: text,
        }),
        approval: z.enum(["pending", "approved"]),
      }),
    )
    .min(1)
    .max(PACK_LIMITS.resources),
});
export type QuizPackContent = z.infer<typeof quizPackContentSchema>;
export type ContentReference = z.infer<typeof contentReferenceSchema>;
export function parseQuizPackContent(input: unknown): Result<QuizPackContent> {
  const parsed = quizPackContentSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      code: "CONTENT_STRUCTURE",
      path: issue.path.filter(
        (part): part is string | number =>
          typeof part === "string" || typeof part === "number",
      ),
      message: "Value does not satisfy the quizpack-content.v1 contract.",
    })),
  };
}
export function getQuizPackContentJsonSchema() {
  return z.toJSONSchema(quizPackContentSchema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
  });
}
