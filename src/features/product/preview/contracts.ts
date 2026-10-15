import { z } from "zod";
import {
  assessmentIdSchema as id,
  assessmentVersionSchema as version,
  assessmentReferenceSchema as ref,
  engineDeclarationSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import { SCORING_LIMITS } from "@/lib/assessment-contract/scoring-v1";
import { importIdSchema as draftIdSchema } from "@/features/quizpack/import/contracts";
import {
  previewTextSchema,
  previewShortText,
  previewLayoutPropsSchema,
  previewVisualPresentationSchema,
  previewBaselineSchema,
  previewCardSchema,
} from "./display-shapes";
import {
  PREVIEW_FONT,
  PREVIEW_RENDERER,
  PREVIEW_COMPONENT_IDS,
} from "./descriptor";
import { PREVIEW_POSTER_LIMITS, PREVIEW_LIMITS } from "./limits";

export const previewScopeSchema = z.strictObject({
  productId: id,
  draftId: draftIdSchema,
  revision: z.number().int().min(1).max(2_147_483_647),
});
export const previewBindingSchema = previewScopeSchema.extend({
  canonicalContentSha256: sha256Schema,
  assetSetSha256: sha256Schema,
  renderer: z.strictObject({ id, version }),
  font: z.strictObject({
    id,
    version,
    fileSha256: sha256Schema,
    coverageSha256: sha256Schema,
  }),
});
export type PreviewBinding = z.infer<typeof previewBindingSchema>;
export type PreviewScope = z.infer<typeof previewScopeSchema>;
export function bindingUsesCurrentRenderer(binding: PreviewBinding): boolean {
  return (
    binding.renderer.id === PREVIEW_RENDERER.id &&
    binding.renderer.version === PREVIEW_RENDERER.version &&
    binding.font.id === PREVIEW_FONT.id &&
    binding.font.version === PREVIEW_FONT.version &&
    binding.font.fileSha256 === PREVIEW_FONT.fileSha256 &&
    binding.font.coverageSha256 === PREVIEW_FONT.coverageSha256
  );
}
export function samePreviewBinding(
  a: PreviewBinding,
  b: PreviewBinding,
): boolean {
  return (
    a.productId === b.productId &&
    a.draftId === b.draftId &&
    a.revision === b.revision &&
    a.canonicalContentSha256 === b.canonicalContentSha256 &&
    a.assetSetSha256 === b.assetSetSha256 &&
    a.renderer.id === b.renderer.id &&
    a.renderer.version === b.renderer.version &&
    a.font.id === b.font.id &&
    a.font.version === b.font.version &&
    a.font.fileSha256 === b.font.fileSha256 &&
    a.font.coverageSha256 === b.font.coverageSha256
  );
}
export const previewErrorCodeSchema = z.enum([
  "PREVIEW_UNSUPPORTED",
  "PREVIEW_BINDING_MISMATCH",
  "PREVIEW_LIMIT_EXCEEDED",
  "PREVIEW_INVALID_ANSWERS",
  "PREVIEW_RESOURCE_UNAVAILABLE",
  "PREVIEW_BUSY",
  "PREVIEW_TIMEOUT",
  "PREVIEW_CANCELLED",
]);
export type PreviewErrorCode = z.infer<typeof previewErrorCodeSchema>;
export type PreviewResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: PreviewErrorCode }>;
export const previewAssetSchema = z.strictObject({
  resourceRef: ref,
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  bytes: z.number().int().min(1).max(PREVIEW_LIMITS.imageBytes),
  sha256: sha256Schema,
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
  purpose: z.enum(["cover", "portrait", "decoration"]),
  approval: z.enum(["pending", "approved"]),
  alt: previewShortText(240),
});
export type PreviewAsset = z.infer<typeof previewAssetSchema>;
const neutralAsset = previewAssetSchema.extend({
  purpose: z.enum(["cover", "decoration"]),
});
const portraitAsset = previewAssetSchema.extend({
  purpose: z.literal("portrait"),
});
function layout<S extends keyof typeof PREVIEW_COMPONENT_IDS>(state: S) {
  return z.strictObject({
    component: z.strictObject({
      id: z.literal(PREVIEW_COMPONENT_IDS[state]),
      version: z.literal("2.0.0"),
      propsSchemaVersion: z.literal("1.0.0"),
    }),
    props: previewLayoutPropsSchema,
  });
}
export const previewQuestionSchema = ref.extend({
  prompt: previewTextSchema,
  options: ref
    .extend({ label: previewTextSchema })
    .array()
    .min(2)
    .max(SCORING_LIMITS.optionsPerQuestion),
});
const previewEntryShape = z.strictObject({
  binding: previewBindingSchema,
  contentSchemaVersion: z.literal("quizpack-content.v2"),
  kind: z.enum(["synthetic", "authored"]),
  engine: engineDeclarationSchema,
  product: z.strictObject({ productId: id, title: previewTextSchema }),
  layouts: z.strictObject({
    cover: layout("cover"),
    question: layout("question"),
    resume: layout("resume"),
  }),
  questions: previewQuestionSchema.array().min(1).max(SCORING_LIMITS.questions),
  visualPresentation: previewVisualPresentationSchema,
  assets: neutralAsset.array().min(1).max(64),
});
type Ref = z.infer<typeof ref>;
const refKey = (value: Ref) =>
  JSON.stringify([value.productId, value.id, value.version]);
export const previewEntrySchema = previewEntryShape.superRefine(
  (value, ctx) => {
    const reject = () =>
      ctx.addIssue({
        code: "custom",
        message: "Preview source relationships must agree.",
      });
    const pid = value.binding.productId;
    if (value.product.productId !== pid) reject();
    const refs: Ref[] = [value.visualPresentation.coverSceneRef];
    const qkeys = new Set(value.questions.map(refKey));
    if (qkeys.size !== value.questions.length) reject();
    for (const q of value.questions) {
      if (
        q.productId !== pid ||
        q.options.some((o) => o.productId !== pid) ||
        new Set(q.options.map((o) => o.id)).size !== q.options.length
      )
        reject();
    }
    const sections = new Set(
      value.visualPresentation.sections.map((s) => s.id),
    );
    if (sections.size !== value.visualPresentation.sections.length) reject();
    refs.push(...value.visualPresentation.sections.map((s) => s.sceneRef));
    const framed = new Set<string>();
    for (const frame of value.visualPresentation.questionFrames) {
      const k = refKey(frame.questionRef);
      if (!qkeys.has(k) || framed.has(k) || !sections.has(frame.sectionId))
        reject();
      framed.add(k);
      if (frame.sceneOverrideRef) refs.push(frame.sceneOverrideRef);
    }
    if (framed.size !== qkeys.size) reject();
    const needed = new Set(refs.map(refKey));
    const declared = new Set(value.assets.map((a) => refKey(a.resourceRef)));
    if (
      declared.size !== value.assets.length ||
      declared.size !== needed.size ||
      refs.some((r) => r.productId !== pid || !declared.has(refKey(r))) ||
      value.assets.some((a) => a.resourceRef.productId !== pid)
    )
      reject();
  },
);
export type PreviewEntry = z.infer<typeof previewEntrySchema>;
export const previewAnswersSchema = z
  .array(z.strictObject({ questionId: id, optionId: id }))
  .min(1)
  .max(SCORING_LIMITS.questions);
export const previewRequestIdSchema = draftIdSchema;
export const previewScoreRequestSchema = z.strictObject({
  binding: previewBindingSchema,
  requestId: previewRequestIdSchema,
  answers: previewAnswersSchema,
});
export type PreviewScoreRequest = z.infer<typeof previewScoreRequestSchema>;
export const previewDimensionSchema = z.strictObject({
  dimensionRef: ref,
  label: previewTextSchema,
  normalizedText: z
    .string()
    .regex(/^(?:(?:[0-9]|[1-9][0-9])\.[0-9]|100\.0)(?![\s\S])/),
});
const dimensions = previewDimensionSchema
  .array()
  .min(1)
  .max(SCORING_LIMITS.dimensions);
const card = previewCardSchema;
const fitsText = (value: string, maximum: number, lines: number) =>
  [...value].length <= maximum && value.split(/\r\n|\r|\n/).length <= lines;
const posterDimension = previewDimensionSchema.extend({
  label: previewDimensionSchema.shape.label.refine((v) =>
    fitsText(v, PREVIEW_POSTER_LIMITS.dimensionLabelCodepoints, 1),
  ),
});
export const previewPosterSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ready"),
    layout: layout("poster"),
    displayName: card.shape.displayName.refine((v) =>
      fitsText(v, PREVIEW_POSTER_LIMITS.displayNameCodepoints, 1),
    ),
    subtitle: card.shape.subtitle.refine((v) =>
      fitsText(v, PREVIEW_POSTER_LIMITS.subtitleCodepoints, 1),
    ),
    posterLine: card.shape.posterLine.extend({
      text: card.shape.posterLine.shape.text.refine((v) =>
        fitsText(v, PREVIEW_POSTER_LIMITS.lineCodepoints, 2),
      ),
    }),
    posterDisclosure: card.shape.posterDisclosure.refine((v) =>
      fitsText(v, PREVIEW_POSTER_LIMITS.disclosureCodepoints, 2),
    ),
    portrait: portraitAsset,
    dimensions: posterDimension
      .array()
      .min(1)
      .max(PREVIEW_POSTER_LIMITS.dimensions),
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    code: z.literal("POSTER_LIMIT_EXCEEDED"),
  }),
]);
export type PreviewPoster = z.infer<typeof previewPosterSchema>;
const previewRevealShape = z.strictObject({
  binding: previewBindingSchema,
  requestId: previewRequestIdSchema,
  answersHash: sha256Schema,
  logicHash: sha256Schema,
  contentSchemaVersion: z.literal("quizpack-content.v2"),
  contentVersion: version,
  reportVersion: version,
  selectedResultRef: ref,
  reportTemplateRef: ref,
  dimensions,
  result: z.strictObject({
    layout: layout("result"),
    displayName: card.shape.displayName,
    subtitle: card.shape.subtitle,
    portrait: portraitAsset,
  }),
  report: z.strictObject({
    layout: layout("report"),
    mode: z.literal("DETERMINISTIC"),
    baseline: previewBaselineSchema,
  }),
  poster: previewPosterSchema,
});
export const previewRevealSchema = previewRevealShape.superRefine(
  (value, ctx) => {
    const reject = () =>
      ctx.addIssue({
        code: "custom",
        message: "Reveal source and selected poster must agree.",
      });
    const refs = [
      value.selectedResultRef,
      value.reportTemplateRef,
      value.result.portrait.resourceRef,
      ...value.dimensions.map((d) => d.dimensionRef),
    ];
    if (
      refs.some((r) => r.productId !== value.binding.productId) ||
      new Set(value.dimensions.map((d) => refKey(d.dimensionRef))).size !==
        value.dimensions.length
    )
      reject();
    if (value.poster.kind === "ready") {
      const poster = value.poster;
      if (
        poster.displayName !== value.result.displayName ||
        poster.subtitle !== value.result.subtitle ||
        JSON.stringify(poster.portrait) !==
          JSON.stringify(value.result.portrait) ||
        JSON.stringify(poster.dimensions) !== JSON.stringify(value.dimensions)
      )
        reject();
    }
  },
);
export type PreviewReveal = z.infer<typeof previewRevealSchema>;
export const previewEntryResponseSchema = z
  .strictObject({ ok: z.literal(true), value: previewEntrySchema })
  .superRefine((v, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(v)).byteLength >
      PREVIEW_LIMITS.entryResponseBytes
    )
      ctx.addIssue({
        code: "custom",
        message: "Complete preview entry envelope exceeds its byte budget.",
      });
  });
export const previewRevealResponseSchema = z
  .strictObject({ ok: z.literal(true), value: previewRevealSchema })
  .superRefine((v, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(v)).byteLength >
      PREVIEW_LIMITS.revealResponseBytes
    )
      ctx.addIssue({
        code: "custom",
        message: "Complete preview reveal envelope exceeds its byte budget.",
      });
  });
export const previewResourceRequestSchema = z.strictObject({
  binding: previewBindingSchema,
  resourceRef: ref,
});
export type PreviewResourceRequest = z.infer<
  typeof previewResourceRequestSchema
>;
/** Standalone export input retains the actual accepted result's identity. */
export const previewPosterExportSchema = z
  .strictObject({
    binding: previewBindingSchema,
    requestId: previewRequestIdSchema,
    answersHash: sha256Schema,
    logicHash: sha256Schema,
    selectedResultRef: ref,
    reportTemplateRef: ref,
    poster: previewPosterSchema.options[0],
  })
  .superRefine((value, ctx) => {
    const refs = [
      value.selectedResultRef,
      value.reportTemplateRef,
      value.poster.portrait.resourceRef,
      ...value.poster.dimensions.map((d) => d.dimensionRef),
    ];
    if (refs.some((r) => r.productId !== value.binding.productId))
      ctx.addIssue({
        code: "custom",
        message: "Export references must belong to the fixed Product.",
      });
  });
export type PreviewPosterExport = z.infer<typeof previewPosterExportSchema>;
/** Transport errors use the server observation ID; successful scoring echoes the caller requestId. */
export const previewHttpErrorSchema = z.strictObject({
  code: z.union([
    previewErrorCodeSchema,
    z.enum([
      "INVALID_REQUEST",
      "PAYLOAD_TOO_LARGE",
      "UNAUTHENTICATED",
      "ORIGIN_REJECTED",
      "CSRF_REJECTED",
      "CAPABILITY_DENIED",
      "PRODUCT_NOT_FOUND",
      "DRAFT_NOT_FOUND",
      "DRAFT_REVISION_NOT_FOUND",
      "STUDIO_UNAVAILABLE",
    ]),
  ]),
  requestId: previewRequestIdSchema,
});
