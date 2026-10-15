import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assessmentReferenceSchema,
  assessmentVersionSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import {
  SCORING_API_LIMITS,
  scoreSnapshotSchema,
  type DeepReadonly,
  type ScoringResult,
  type ScoringErrorCode,
} from "@/lib/assessment-contract/scoring-api-v1";
import {
  prepareScoringDefinition,
  readScoringIdentity,
  scoreCompleteAnswers,
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

declare const preparedContentIdentity: unique symbol;
export type PreparedContent = Readonly<{ [preparedContentIdentity]: true }>;
type FixedContent = {
  content: SupportedContent;
  canonicalContentSha256: string;
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
const failure = (code: ScoringErrorCode): ScoringResult<never> =>
  freezeContent({
    ok: false,
    issues: [{ code, path: [] }],
    issuesTruncated: false,
  });

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
  const reportTemplateRef = fixed.reports.get(
    key(actual.value.decision.selectedResultRef),
  );
  if (!reportTemplateRef) return failure("REFERENCE_MISMATCH");
  const result = {
    ok: true as const,
    value: {
      contentSchemaVersion: fixed.content.schemaVersion,
      contentVersion: fixed.content.contentVersion,
      reportVersion: fixed.content.reportVersion,
      canonicalContentSha256: fixed.canonicalContentSha256,
      reportTemplateRef,
      score: actual.value,
    },
  };
  // Measure the entire result envelope, including the fixed content/report binding.
  if (
    Buffer.byteLength(JSON.stringify(result), "utf8") >
    SCORING_API_LIMITS.scoreBytes
  )
    return failure("INPUT_LIMIT_EXCEEDED");
  const checked = contentScoreSchema.safeParse(result.value);
  if (!checked.success) return failure("INVALID_DEFINITION");
  return freezeContent({ ok: true, value: checked.data });
}
