import { z } from "zod";
import { privateTestUseSchema } from "./private-test";
import {
  assessmentReferenceSchema as ref,
  assessmentVersionSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import { scoringDefinitionV2Schema } from "@/lib/assessment-contract/scoring-v2";
import { scoringAnswersV2Schema } from "@/lib/assessment-contract/scoring-api-v2";
import { matchingPreferenceSchema } from "@/lib/assessment-contract/matching-v1";
import { quizPackContentSchema } from "../v1/content";
import { componentDeclarationSchema } from "../v1/manifest";
import { quizPackContentV2Schema } from "./v2";
import { COMPOSED_VOLUME_IDS_V1 } from "@/lib/assessment-contract/composed-report-v1";
import {
  presentationSlotsV3Schema,
  CONTENT_COMPONENT_VERSION_V3,
} from "@/lib/assessment-contract/presentation-v3";

const text = z
  .string()
  .min(1)
  .max(4000)
  .regex(/\S/)
  .regex(/^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/)
  .regex(/^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/)
  .regex(/^(?![\s\S]*(?:https?:|file:|data:|javascript:|\/\/))[\s\S]*$/i);
const evidence = z.strictObject({
  questionRef: ref,
  optionRef: ref,
  scope: text,
});
export const composedClaimV1Schema = z.strictObject({
  ref,
  kind: z.enum(["fact", "summary", "context", "literary"]),
  dimensionRef: ref,
  direction: z.enum(["low", "high"]),
  text,
  evidence: z.array(evidence).min(1).max(100),
  counterevidence: z.array(evidence).max(100),
  when: z.strictObject({
    answers: z.array(evidence).max(100),
    selectedResultRef: ref.nullable(),
    scoreRange: z
      .strictObject({
        min: z.number().int().min(0).max(100),
        max: z.number().int().min(0).max(100),
      })
      .nullable(),
    nearTie: z.boolean().nullable(),
  }),
  literaryBridge: z
    .strictObject({
      roleRef: ref,
      grade: z.enum(["medium", "weak", "none"]),
      sources: z
        .array(z.strictObject({ ref, sha256: sha256Schema }))
        .min(1)
        .max(16),
      review: z.enum(["pending", "approved"]),
    })
    .nullable(),
});
export const COMPOSED_VOLUME_IDS = COMPOSED_VOLUME_IDS_V1;
export const composedTemplateV1Schema = z.strictObject({
  ref,
  mode: z.literal("COMPOSED"),
  schemaVersion: z.literal("quiz-composed-template.v1"),
  claims: z.array(composedClaimV1Schema).max(256),
  volumes: z
    .array(
      z.strictObject({
        id: z.enum(COMPOSED_VOLUME_IDS),
        title: text,
        claimRefs: z.array(ref).max(64),
        maxClaims: z.number().int().min(1).max(16),
        fallbackText: text,
      }),
    )
    .length(6),
});
export const contentCoreV3Schema = z.strictObject({
  schemaVersion: z.literal("quizpack-core.v3"),
  title: text,
  scoringDefinition: scoringDefinitionV2Schema,
  dimensions: z
    .array(z.strictObject({ ref, label: text }))
    .min(1)
    .max(16),
  questions: z
    .array(
      z.strictObject({
        ref,
        prompt: text,
        act: z.number().int().min(1).max(8),
        options: z
          .array(z.strictObject({ ref, label: text }))
          .min(2)
          .max(8),
      }),
    )
    .min(1)
    .max(100),
  results: z
    .array(z.strictObject({ ref, label: text }))
    .min(1)
    .max(32),
  evidenceFamilies: z.strictObject({
    version: assessmentVersionSchema,
    entries: z
      .array(
        z.strictObject({
          questionRef: ref,
          dimensionRef: ref,
          family: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,79}$/),
          core: z.boolean(),
        }),
      )
      .max(1600),
  }),
  provenance: z
    .array(
      z.strictObject({
        kind: z.enum(["questions", "personas", "families"]),
        sha256: sha256Schema,
      }),
    )
    .min(2)
    .max(3),
});
const formalResource = quizPackContentSchema.shape.resources.element;
export const privateTestResourceV3Schema = formalResource.extend({
  source: formalResource.shape.source.extend({
    kind: z.enum([
      "user-supplied-reference",
      "ai-generated-candidate",
      "program-font-sample",
      "confirmed-prototype",
    ]),
  }),
  license: z.strictObject({
    scope: z.literal("private-test-only"),
    commercialUse: z.literal(false),
    redistribution: z.literal(false),
    evidence: formalResource.shape.license.shape.evidence,
  }),
  approval: z.literal("private-test-only"),
});
export const currentResourceV3Schema = z.union([
  formalResource,
  privateTestResourceV3Schema,
]);
export type CurrentResourceV3 = z.infer<typeof currentResourceV3Schema>;
export const contentBindingsV3Schema = z.strictObject({
  schemaVersion: z.literal("quizpack-bindings.v3"),
  kind: z.enum(["synthetic", "authored"]),
  visualVersion: assessmentVersionSchema,
  resourceVersion: assessmentVersionSchema,
  componentVersion: z.literal(CONTENT_COMPONENT_VERSION_V3),
  witnesses: z.strictObject({
    schemaVersion: z.literal("quiz-content-witnesses.v3"),
    status: z.literal("declared-not-executed"),
    entries: z
      .array(
        z.strictObject({
          expectedResultRef: ref,
          preference: matchingPreferenceSchema,
          answers: scoringAnswersV2Schema,
        }),
      )
      .min(1)
      .max(32),
  }),
  reportVersion: assessmentVersionSchema,
  reportTemplates: z.array(composedTemplateV1Schema).min(1).max(32),
  resultReports: z
    .array(z.strictObject({ resultRef: ref, templateRef: ref }))
    .min(1)
    .max(32),
  slots: presentationSlotsV3Schema,
  privateTestUse: privateTestUseSchema.optional(),
  resources: z.array(currentResourceV3Schema).min(1).max(64),
  layouts: z.strictObject(
    Object.fromEntries(
      ["cover", "question", "resume", "result", "report", "poster"].map(
        (name) => [
          name,
          z.strictObject({
            component: componentDeclarationSchema,
            resourceRefs: z.array(ref).min(1).max(64),
          }),
        ],
      ),
    ) as Record<
      "cover" | "question" | "resume" | "result" | "report" | "poster",
      z.ZodObject<{
        component: typeof componentDeclarationSchema;
        resourceRefs: z.ZodArray<typeof ref>;
      }>
    >,
  ),
  visualPresentation: quizPackContentV2Schema.shape.visualPresentation,
});
export const quizPackContentV3Schema = z
  .strictObject({
    schemaVersion: z.literal("quizpack-content.v3"),
    core: contentCoreV3Schema,
    bindings: contentBindingsV3Schema,
  })
  .superRefine((value, ctx) => {
    const privateCount = value.bindings.resources.filter(
      (r) => r.approval === "private-test-only",
    ).length;
    if (
      value.bindings.privateTestUse
        ? value.bindings.kind !== "authored" ||
          privateCount !== value.bindings.resources.length
        : privateCount !== 0
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Private candidate declaration and every private resource must remain linked.",
      });
  });
export const contentBuildInputV3Schema = z.strictObject({
  schemaVersion: z.literal("quizpack-build-input.v3"),
  core: contentCoreV3Schema,
  bindings: contentBindingsV3Schema.nullable(),
});
export type ContentCoreV3 = z.infer<typeof contentCoreV3Schema>;
export type QuizPackContentV3 = z.infer<typeof quizPackContentV3Schema>;
export type ComposedClaimV1 = z.infer<typeof composedClaimV1Schema>;
