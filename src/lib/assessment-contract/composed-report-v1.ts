import { z } from "zod";
import {
  assessmentReferenceSchema as ref,
  assessmentVersionSchema,
  sha256Schema,
} from "./primitives";

export const COMPOSED_VOLUME_IDS_V1 = [
  "encounter",
  "dimensions",
  "patterns",
  "counterevidence",
  "literature",
  "closure",
] as const;
export const COMPOSED_NOTICE_V1 =
  "本报告是基于本轮情境选择的娱乐性文学匹配，不是人格诊断、能力评级或历史人物心理测量。";
export const COMPOSED_FACT_ONLY_V1 =
  "以下仅记录本轮具体情境中的选择，不作更广泛的概括。";
const text = z.string().min(1).max(4000);
export const composedEvidenceV1Schema = z.strictObject({
  questionRef: ref,
  optionRef: ref,
  prompt: text,
  optionText: text,
  scope: text,
});
export const composedParagraphV1Schema = z.strictObject({
  claimRef: ref.nullable(),
  kind: z.enum(["fact", "summary", "context", "literary", "fallback"]),
  status: z.enum(["accepted", "facts-only", "fallback"]),
  text,
  evidence: z.array(composedEvidenceV1Schema).max(100),
  counterevidence: z.array(composedEvidenceV1Schema).max(100),
});
const role = z.strictObject({
  ref,
  label: text,
  kind: z.enum(["documented-historical", "literary-legendary"]),
  narrativeIndex: z.number().int().min(0).max(100),
});
export const composedReportBodyV1Schema = z.strictObject({
  schemaVersion: z.literal("quiz-composed-report.v1"),
  title: text,
  notice: z.literal(COMPOSED_NOTICE_V1),
  provenance: z.strictObject({
    canonicalContentSha256: sha256Schema,
    templateRef: ref,
    reportVersion: assessmentVersionSchema,
    evidenceFamilyVersion: assessmentVersionSchema,
    logicHash: sha256Schema,
    inputHash: sha256Schema,
    answersHash: sha256Schema,
    matchingContextSha256: sha256Schema,
  }),
  matching: z.strictObject({
    selected: role,
    runnerUp: role.nullable(),
    status: z.enum(["single-candidate", "near-tie", "distinct"]),
    gapTotal: z.number().int().min(0).max(1600).nullable(),
  }),
  dimensions: z
    .array(
      z.strictObject({
        dimensionRef: ref,
        label: text,
        score: z.number().int().min(0).max(100),
      }),
    )
    .min(1)
    .max(16),
  answers: z
    .array(
      z.strictObject({
        questionRef: ref,
        optionRef: ref,
        prompt: text,
        optionText: text,
        act: z.number().int().min(1).max(8),
      }),
    )
    .min(1)
    .max(100),
  volumes: z
    .array(
      z.strictObject({
        id: z.enum(COMPOSED_VOLUME_IDS_V1),
        title: text,
        paragraphs: z.array(composedParagraphV1Schema).min(1).max(16),
      }),
    )
    .length(6),
});
export type ComposedReportBodyV1 = z.infer<typeof composedReportBodyV1Schema>;
export const COMPOSED_BUDGET_V1 = Object.freeze({
  policy: "quiz-composed-size.v1",
  reportSnapshotBytes: 524288,
  reportResponseBytes: 524288,
  // Covers full play detail (96 KiB), score (64 KiB), state facts (72 KiB),
  // binding/display/receipt identities and JSON framing (88 KiB).
  reservedSnapshotBytes: 320 * 1024,
  reservedResponseBytes: 96 * 1024,
  bodyCopiesInSnapshot: 2,
});
