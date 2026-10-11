import { z } from "zod";
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

const text = z
  .string()
  .min(1)
  .max(4000)
  .regex(/^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/)
  .refine(
    (value) => !/(?:https?:|ftp:|file:|data:|javascript:|\/\/)/i.test(value),
    "Text must be plain local content.",
  );
export const contentReferenceSchema = z.strictObject({
  id,
  productId: id,
  version,
});
const definition = { id, productId: id, version };
const dimensionContribution = z.strictObject({
  dimensionRef: contentReferenceSchema,
  value: z.number().int().min(-100).max(100),
});
const normalization = z.strictObject({
  kind: z.literal("linear-to-0-100"),
  bounds: z
    .array(
      z.strictObject({
        dimensionRef: contentReferenceSchema,
        min: z.number().int().min(-10000).max(10000),
        max: z.number().int().min(-10000).max(10000),
      }),
    )
    .min(1)
    .max(PACK_LIMITS.dimensions),
});
const ruleBase = {
  aggregation: z.literal("sum"),
  normalization,
  tieBreak: z.literal("result-order"),
  resultOrder: z.array(contentReferenceSchema).min(1).max(PACK_LIMITS.results),
};
const rules = z.discriminatedUnion("kind", [
  z.strictObject({
    ...ruleBase,
    kind: z.literal("dimensions"),
    profiles: z
      .array(
        z.strictObject({
          resultRef: contentReferenceSchema,
          ranges: z
            .array(
              z.strictObject({
                dimensionRef: contentReferenceSchema,
                min: z.number().int().min(0).max(100),
                max: z.number().int().min(0).max(100),
              }),
            )
            .min(1)
            .max(PACK_LIMITS.dimensions),
        }),
      )
      .min(1)
      .max(PACK_LIMITS.results),
  }),
  z.strictObject({
    ...ruleBase,
    kind: z.literal("archetype"),
    distance: z.literal("squared-euclidean"),
    profiles: z
      .array(
        z.strictObject({
          resultRef: contentReferenceSchema,
          targets: z
            .array(
              z.strictObject({
                dimensionRef: contentReferenceSchema,
                value: z.number().int().min(0).max(100),
              }),
            )
            .min(1)
            .max(PACK_LIMITS.dimensions),
        }),
      )
      .min(1)
      .max(PACK_LIMITS.results),
  }),
]);
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
