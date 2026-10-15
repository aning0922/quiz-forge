import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assessmentReferenceSchema,
  assessmentVersionSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import {
  scoreSnapshotSchema,
  witnessEvidenceSchema,
  coverageEvidenceSchema,
  type DeepReadonly,
  type ScoringResult,
} from "@/lib/assessment-contract/scoring-api-v1";
import { scoringSourceBindingSchema } from "@/lib/assessment-contract/authoring-review-v1";
import {
  prepareScoringDefinition,
  readScoringIdentity,
  scoreCompleteAnswers,
  verifyDeclaredWitnesses,
  analyzeDimensionsCoverage,
  type PreparedScoringDefinition,
} from "@/features/quiz/scoring";
import { canonicalP1Json } from "../v1/canonical";
import type { ContentReference } from "../v1/content";
import {
  freezeContent,
  parseSupportedContent,
  type SupportedContent,
} from "./supported";
import { validateParsedContentReferences } from "./references";
import {
  contentScoringFailure as failure,
  contentScoringOutput,
} from "./scoring-output";

declare const preparedContentIdentity: unique symbol;
export type PreparedContent = Readonly<{ [preparedContentIdentity]: true }>;
type FixedContent = {
  content: SupportedContent;
  canonicalContentSha256: string;
  logicHash: string;
  core: PreparedScoringDefinition;
  reports: ReadonlyMap<string, ContentReference>;
};
const prepared = new WeakMap<object, FixedContent>();
const ref = ({ id, productId, version }: ContentReference) => ({
  id,
  productId,
  version,
});
const key = (value: ContentReference) =>
  JSON.stringify([value.productId, value.id, value.version]);

// The content adapter can only issue the complete-content arm. An authoring
// review has different authority and cannot substitute for a content snapshot.
const contentSourceBindingSchema = scoringSourceBindingSchema.options[0];
export const contentWitnessEvidenceSchema = z.strictObject({
  sourceBinding: contentSourceBindingSchema,
  evidence: witnessEvidenceSchema,
});
export const contentCoverageEvidenceSchema = z.strictObject({
  sourceBinding: contentSourceBindingSchema,
  evidence: coverageEvidenceSchema,
});
export type ContentWitnessEvidence = DeepReadonly<
  z.infer<typeof contentWitnessEvidenceSchema>
>;
export type ContentCoverageEvidence = DeepReadonly<
  z.infer<typeof contentCoverageEvidenceSchema>
>;

export const contentScoreSchema = z.strictObject({
  contentSchemaVersion: z.enum(["quizpack-content.v1", "quizpack-content.v2"]),
  contentVersion: assessmentVersionSchema,
  reportVersion: assessmentVersionSchema,
  canonicalContentSha256: sha256Schema,
  reportTemplateRef: assessmentReferenceSchema,
  score: scoreSnapshotSchema,
});
export type ContentScore = DeepReadonly<z.infer<typeof contentScoreSchema>>;

/** The snapshot is structural content only; it grants no package, asset or publication qualification. */
export function prepareContentForScoring(
  input: unknown,
): ScoringResult<PreparedContent> {
  const parsed = parseSupportedContent(input);
  if (!parsed.ok)
    return failure(
      parsed.issues[0]?.code === "CONTENT_INPUT_LIMIT_EXCEEDED"
        ? "INPUT_LIMIT_EXCEEDED"
        : "INVALID_DEFINITION",
    );
  const content = parsed.value;
  if (
    validateParsedContentReferences(content, content.product.productId).length
  )
    return failure("REFERENCE_MISMATCH");
  const core = prepareScoringDefinition({
    schemaVersion: "quiz-scoring-definition.v1",
    productId: content.product.productId,
    contentVersion: content.contentVersion,
    engine: content.engine,
    dimensions: content.dimensions.map(ref),
    questions: content.questions.map((question) => ({
      ref: ref(question),
      options: question.options.map((option) => ({
        ref: ref(option),
        contributions: option.contributions,
      })),
    })),
    results: content.results.map(ref),
    rules: content.rules,
  });
  if (!core.ok) return core;
  const identity = readScoringIdentity(core.value);
  if (!identity.ok) return identity;
  const handle = Object.freeze({}) as PreparedContent;
  prepared.set(handle, {
    content,
    canonicalContentSha256: createHash("sha256")
      .update(canonicalP1Json(content), "utf8")
      .digest("hex"),
    core: core.value,
    logicHash: identity.value.logicHash,
    reports: new Map(
      content.results.map((result) => [
        key(result),
        ref(result.reportTemplateRef),
      ]),
    ),
  });
  return freezeContent({ ok: true, value: handle });
}

/** No caller-supplied score is accepted. Only this handle's actual core execution selects its report. */
export function scorePreparedContent(
  handle: PreparedContent,
  answers: unknown,
): ScoringResult<ContentScore> {
  const fixed =
    handle !== null && typeof handle === "object"
      ? prepared.get(handle)
      : undefined;
  if (!fixed) return failure("INVALID_PREPARED_DEFINITION");
  const actual = scoreCompleteAnswers(fixed.core, answers);
  if (!actual.ok) return actual;
  if (actual.value.logicHash !== fixed.logicHash)
    return failure("REFERENCE_MISMATCH");
  const reportTemplateRef = fixed.reports.get(
    key(actual.value.decision.selectedResultRef),
  );
  if (!reportTemplateRef) return failure("REFERENCE_MISMATCH");
  return contentScoringOutput(
    contentScoreSchema,
    {
      contentSchemaVersion: fixed.content.schemaVersion,
      contentVersion: fixed.content.contentVersion,
      reportVersion: fixed.content.reportVersion,
      canonicalContentSha256: fixed.canonicalContentSha256,
      reportTemplateRef,
      score: actual.value,
    },
    "score",
  );
}

function fixedContent(handle: PreparedContent) {
  return handle !== null && typeof handle === "object"
    ? prepared.get(handle)
    : undefined;
}
const sourceBinding = (fixed: FixedContent) => ({
  kind: "content" as const,
  contentSchemaVersion: fixed.content.schemaVersion,
  contentVersion: fixed.content.contentVersion,
  canonicalContentSha256: fixed.canonicalContentSha256,
});
/** Execute the exact declarations held by the prepared complete-content snapshot. */
export function verifyPreparedContentWitnesses(
  handle: PreparedContent,
): ScoringResult<ContentWitnessEvidence> {
  const fixed = fixedContent(handle);
  if (!fixed) return failure("INVALID_PREPARED_DEFINITION");
  const declared = {
    schemaVersion: "quiz-witness-input.v1" as const,
    entries: fixed.content.results.map((result) => ({
      expectedResultRef: ref(result),
      answers: result.witness.answers.map((answer) => ({
        questionId: answer.questionRef.id,
        optionId: answer.optionRef.id,
      })),
    })),
  };
  // The actual core bounds and snapshots this complete derived witness input
  // before its strict parser; no unbounded pre-parse or external evidence input.
  const actual = verifyDeclaredWitnesses(fixed.core, declared);
  if (!actual.ok) return actual;
  if (actual.value.logicHash !== fixed.logicHash)
    return failure("REFERENCE_MISMATCH");
  return contentScoringOutput(
    contentWitnessEvidenceSchema,
    { sourceBinding: sourceBinding(fixed), evidence: actual.value },
    "evidence",
  );
}
/** Preserve the core's proven/uncovered/inconclusive distinctions and exact policy facts. */
export function analyzePreparedContentCoverage(
  handle: PreparedContent,
): ScoringResult<ContentCoverageEvidence> {
  const fixed = fixedContent(handle);
  if (!fixed) return failure("INVALID_PREPARED_DEFINITION");
  const actual = analyzeDimensionsCoverage(fixed.core);
  if (!actual.ok) return actual;
  if (actual.value.logicHash !== fixed.logicHash)
    return failure("REFERENCE_MISMATCH");
  return contentScoringOutput(
    contentCoverageEvidenceSchema,
    { sourceBinding: sourceBinding(fixed), evidence: actual.value },
    "evidence",
  );
}
