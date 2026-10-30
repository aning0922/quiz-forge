import { z } from "zod";
import {
  assessmentIdSchema,
  assessmentReferenceSchema as ref,
} from "./primitives";

export const CONTENT_COMPONENTS_V3 = Object.freeze({
  cover: "composed-cover",
  question: "composed-question",
  resume: "composed-resume",
  result: "composed-result",
  report: "composed-report",
  poster: "composed-poster",
} as const);
export const CONTENT_COMPONENT_VERSION_V3 = "1.0.0" as const;
/** These are resource references, never executable props, paths or arbitrary HTML. */
export const presentationSlotsV3Schema = z.strictObject({
  neutral: z.strictObject({
    cover: ref,
    preferenceScene: ref.optional(),
    acts: z
      .array(
        z.strictObject({
          sectionId: assessmentIdSchema,
          background: ref,
          questionPaper: ref,
          optionIdle: ref,
          optionSelected: ref,
        }),
      )
      .min(1)
      .max(8),
    reportPaper: ref,
    reportBorder: ref.nullable(),
    seal: ref.nullable(),
  }),
  characters: z
    .array(
      z.strictObject({
        resultRef: ref,
        reveal: ref,
        nameArt: ref,
        report: ref,
        poster: ref,
      }),
    )
    .min(1)
    .max(32),
});
export type PresentationSlotsV3 = z.infer<typeof presentationSlotsV3Schema>;
export function neutralSlotRefsV3(slots: PresentationSlotsV3) {
  const n = slots.neutral;
  return [
    n.cover,
    ...(n.preferenceScene ? [n.preferenceScene] : []),
    ...n.acts.flatMap((a) => [
      a.background,
      a.questionPaper,
      a.optionIdle,
      a.optionSelected,
    ]),
    n.reportPaper,
    ...(n.reportBorder ? [n.reportBorder] : []),
    ...(n.seal ? [n.seal] : []),
  ];
}
export function characterSlotRefsV3(
  character: PresentationSlotsV3["characters"][number],
) {
  return [
    character.reveal,
    character.nameArt,
    character.report,
    character.poster,
  ];
}
