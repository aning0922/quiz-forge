import { z } from "zod";
import {
  assessmentIdSchema as id,
  assessmentVersionSchema as version,
  assessmentReferenceSchema as ref,
  engineDeclarationSchema,
  sha256Schema,
} from "./primitives";
import { SCORING_LIMITS } from "./scoring-v1";
import {
  previewTextSchema,
  previewShortText,
  previewLayoutPropsSchema,
  previewVisualPresentationSchema,
  previewBaselineSchema,
  previewCardSchema,
} from "./display-shapes-v1";
import {
  DISPLAY_COMPONENT_IDS_V1,
  DISPLAY_POSTER_LIMITS_V1,
  DISPLAY_LIMITS_V1,
} from "./display-limits-v1";
/** Pure display vocabulary; schema validity is never scoring, session, or approval authority. */
export type DisplayAnswers = Readonly<Record<string, string>>;
export const displayAssetV1Schema = z.strictObject({
  resourceRef: ref,
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  bytes: z.number().int().min(1).max(DISPLAY_LIMITS_V1.imageBytes),
  sha256: sha256Schema,
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
  purpose: z.enum(["cover", "portrait", "decoration"]),
  approval: z.enum(["pending", "approved"]),
  alt: previewShortText(240),
});
export type DisplayAssetV1 = z.infer<typeof displayAssetV1Schema>;
const neutralAsset = displayAssetV1Schema.extend({
  purpose: z.enum(["cover", "decoration"]),
});
const portraitAsset = displayAssetV1Schema.extend({
  purpose: z.literal("portrait"),
});
function layout<S extends keyof typeof DISPLAY_COMPONENT_IDS_V1>(state: S) {
  return z.strictObject({
    component: z.strictObject({
      id: z.literal(DISPLAY_COMPONENT_IDS_V1[state]),
      version: z.literal("2.0.0"),
      propsSchemaVersion: z.literal("1.0.0"),
    }),
    props: previewLayoutPropsSchema,
  });
}
export const displayQuestionV1Schema = ref.extend({
  prompt: previewTextSchema,
  options: ref
    .extend({ label: previewTextSchema })
    .array()
    .min(2)
    .max(SCORING_LIMITS.optionsPerQuestion),
});
export const displayEntryBodyShapeV1 = z.strictObject({
  contentSchemaVersion: z.literal("quizpack-content.v2"),
  kind: z.enum(["synthetic", "authored"]),
  engine: engineDeclarationSchema,
  product: z.strictObject({ productId: id, title: previewTextSchema }),
  layouts: z.strictObject({
    cover: layout("cover"),
    question: layout("question"),
    resume: layout("resume"),
  }),
  questions: displayQuestionV1Schema
    .array()
    .min(1)
    .max(SCORING_LIMITS.questions),
  visualPresentation: previewVisualPresentationSchema,
  assets: neutralAsset.array().min(1).max(64),
});
type Ref = z.infer<typeof ref>;
const refKey = (value: Ref) =>
  JSON.stringify([value.productId, value.id, value.version]);
export function checkDisplayEntryRelationsV1(
  value: z.infer<typeof displayEntryBodyShapeV1>,
  ctx: z.RefinementCtx,
  productId = value.product.productId,
) {
  const reject = () =>
    ctx.addIssue({
      code: "custom",
      message: "Preview source relationships must agree.",
    });
  const pid = productId;
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
  const sections = new Set(value.visualPresentation.sections.map((s) => s.id));
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
}
export const displayEntryBodyV1Schema = displayEntryBodyShapeV1.superRefine(
  (value, ctx) => checkDisplayEntryRelationsV1(value, ctx),
);
export type DisplayEntryBodyV1 = z.infer<typeof displayEntryBodyV1Schema>;
export const displayDimensionV1Schema = z.strictObject({
  dimensionRef: ref,
  label: previewTextSchema,
  normalizedText: z
    .string()
    .regex(/^(?:(?:[0-9]|[1-9][0-9])\.[0-9]|100\.0)(?![\s\S])/),
});
const dimensions = displayDimensionV1Schema
  .array()
  .min(1)
  .max(SCORING_LIMITS.dimensions);
const card = previewCardSchema;
const fitsText = (value: string, maximum: number, lines: number) =>
  [...value].length <= maximum && value.split(/\r\n|\r|\n/).length <= lines;
const posterDimension = displayDimensionV1Schema.extend({
  label: displayDimensionV1Schema.shape.label.refine((v) =>
    fitsText(v, DISPLAY_POSTER_LIMITS_V1.dimensionLabelCodepoints, 1),
  ),
});
export const displayPosterV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ready"),
    layout: layout("poster"),
    displayName: card.shape.displayName.refine((v) =>
      fitsText(v, DISPLAY_POSTER_LIMITS_V1.displayNameCodepoints, 1),
    ),
    subtitle: card.shape.subtitle.refine((v) =>
      fitsText(v, DISPLAY_POSTER_LIMITS_V1.subtitleCodepoints, 1),
    ),
    posterLine: card.shape.posterLine.extend({
      text: card.shape.posterLine.shape.text.refine((v) =>
        fitsText(v, DISPLAY_POSTER_LIMITS_V1.lineCodepoints, 2),
      ),
    }),
    posterDisclosure: card.shape.posterDisclosure.refine((v) =>
      fitsText(v, DISPLAY_POSTER_LIMITS_V1.disclosureCodepoints, 2),
    ),
    portrait: portraitAsset,
    dimensions: posterDimension
      .array()
      .min(1)
      .max(DISPLAY_POSTER_LIMITS_V1.dimensions),
  }),
  z.strictObject({
    kind: z.literal("unavailable"),
    code: z.literal("POSTER_LIMIT_EXCEEDED"),
  }),
]);
export type DisplayPosterV1 = z.infer<typeof displayPosterV1Schema>;
export const resultDisplaySnapshotShapeV1 = z.strictObject({
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
  poster: displayPosterV1Schema,
});
export function checkResultDisplayRelationsV1(
  value: z.infer<typeof resultDisplaySnapshotShapeV1>,
  ctx: z.RefinementCtx,
  productId = value.selectedResultRef.productId,
) {
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
    refs.some((r) => r.productId !== productId) ||
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
}
export const resultDisplaySnapshotV1Schema =
  resultDisplaySnapshotShapeV1.superRefine((value, ctx) =>
    checkResultDisplayRelationsV1(value, ctx),
  );
export type ResultDisplaySnapshotV1 = z.infer<
  typeof resultDisplaySnapshotV1Schema
>;
export const displayPosterExportBodyShapeV1 = z.strictObject({
  answersHash: sha256Schema,
  logicHash: sha256Schema,
  selectedResultRef: ref,
  reportTemplateRef: ref,
  poster: displayPosterV1Schema.options[0],
});
export function checkDisplayPosterExportRelationsV1(
  value: z.infer<typeof displayPosterExportBodyShapeV1>,
  ctx: z.RefinementCtx,
  productId = value.selectedResultRef.productId,
) {
  const refs = [
    value.selectedResultRef,
    value.reportTemplateRef,
    value.poster.portrait.resourceRef,
    ...value.poster.dimensions.map((d) => d.dimensionRef),
  ];
  if (refs.some((r) => r.productId !== productId))
    ctx.addIssue({
      code: "custom",
      message: "Export references must belong to the fixed Product.",
    });
}
export const displayPosterExportBodyV1Schema =
  displayPosterExportBodyShapeV1.superRefine((value, ctx) =>
    checkDisplayPosterExportRelationsV1(value, ctx),
  );
export type DisplayPosterExportBodyV1 = z.infer<
  typeof displayPosterExportBodyV1Schema
>;

/** Supplied only by a compiled application adapter; no URL or authorization is inferred here. */
export type DisplayResourceTransport = (
  asset: DisplayAssetV1,
  signal: AbortSignal,
  deadlineMonotonicMs: number,
) => Promise<Response>;
/** Construct only from a trusted registered descriptor, never from a request or QuizPack. */
export type DisplayFontDescriptorV1 = Readonly<{
  id: string;
  version: string;
  family: string;
  weight: 600;
  file: `/assets/fonts/${string}`;
  fileSha256: string;
  bytes: number;
  coverage: `/assets/fonts/${string}`;
  coverageSha256: string;
  licenseFile: `/assets/fonts/${string}`;
}>;
