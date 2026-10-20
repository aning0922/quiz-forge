import { z } from "zod";
import {
  assessmentIdSchema as id,
  assessmentReferenceSchema as ref,
} from "@/lib/assessment-contract/primitives";
// Explicit browser projection vocabulary; importing the full package validator would load Node I/O helpers.
const permitted =
  /^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*(?![\s\S])/;
const local =
  /^(?![\s\S]*(?:[hH][tT][tT][pP][sS]?:|[fF][tT][pP]:|[fF][iI][lL][eE]:|[dD][aA][tT][aA]:|[jJ][aA][vV][aA][sS][cC][rR][iI][pP][tT]:|\/\/))[\s\S]*(?![\s\S])/;
export const previewTextSchema = z
  .string()
  .min(1)
  .max(4000)
  .regex(/\S/)
  .regex(permitted)
  .regex(local);
export function previewShortText(maximum: number) {
  return z
    .string()
    .regex(/\S/)
    .regex(
      /^(?:[^\uD800-\uDBFF\uDC00-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*(?![\s\S])/,
    )
    .regex(permitted)
    .regex(local)
    .refine((v) => [...v].length >= 1 && [...v].length <= maximum);
}
export const previewLayoutPropsSchema = z.strictObject({
  heading: previewTextSchema,
  body: previewTextSchema,
  density: z.enum(["comfortable", "compact"]),
  showProgress: z.boolean(),
});
export const previewVisualPresentationSchema = z.strictObject({
  coverSceneRef: ref,
  sections: z
    .array(
      z.strictObject({
        id,
        name: previewShortText(40),
        chapter: previewShortText(40),
        introduction: previewShortText(400),
        sceneRef: ref,
      }),
    )
    .min(1)
    .max(8),
  questionFrames: z
    .array(
      z.strictObject({
        questionRef: ref,
        sectionId: id,
        caption: previewShortText(80),
        sceneOverrideRef: ref.optional(),
      }),
    )
    .min(1)
    .max(100),
});
export const previewBaselineSchema = z.strictObject({
  title: previewTextSchema,
  summary: previewTextSchema,
  strengths: previewTextSchema.array().min(1).max(8),
  tensions: previewTextSchema.array().min(1).max(8),
  reflection: previewTextSchema,
  disclaimer: previewTextSchema,
});
export const previewCardSchema = z.strictObject({
  displayName: previewShortText(80),
  subtitle: previewShortText(120),
  posterLine: z.strictObject({
    kind: z.literal("original"),
    text: previewShortText(120),
  }),
  posterDisclosure: previewShortText(240),
});
