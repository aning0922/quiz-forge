import { createHash } from "node:crypto";
import { z } from "zod";
import {
  scoreSnapshotV2Schema,
  type V2Result,
  type ScoreSnapshotV2,
} from "@/lib/assessment-contract/scoring-api-v2";
import {
  assessmentReferenceSchema,
  assessmentVersionSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import {
  prepareScoringV2,
  scoreCompleteAnswersV2,
  type PreparedScoringV2,
} from "@/features/quiz/scoring/v2";
import {
  canonicalV2,
  failure,
  freeze,
  refKey,
} from "@/features/quiz/scoring/v2/boundary";
import { validateContentV3 } from "./v3-references";
import type { QuizPackContentV3 } from "./v3";

declare const identity: unique symbol;
export type PreparedContentV3 = Readonly<{ [identity]: true }>;
const issued = new WeakMap<
  object,
  { content: QuizPackContentV3; core: PreparedScoringV2; contentSha256: string }
>();
const issuedScores = new WeakMap<object, PreparedContentV3>();
/** Server composition port only. Never serialize a prepared source to a consumer. */
export function readPreparedContentV3ForComposition(handle: PreparedContentV3) {
  return handle !== null && typeof handle === "object"
    ? issued.get(handle)?.content
    : undefined;
}
export const contentScoreV3Schema = z.strictObject({
  contentSchemaVersion: z.literal("quizpack-content.v3"),
  canonicalContentSha256: sha256Schema,
  reportVersion: assessmentVersionSchema,
  reportTemplateRef: assessmentReferenceSchema,
  score: scoreSnapshotV2Schema,
});
export type ContentScoreV3 = z.infer<typeof contentScoreV3Schema>;
export function prepareContentV3(input: unknown): V2Result<PreparedContentV3> {
  const parsed = validateContentV3(input);
  if (!parsed.ok) return parsed;
  const core = prepareScoringV2(parsed.value.core.scoringDefinition);
  if (!core.ok) return core;
  const handle = Object.freeze({}) as PreparedContentV3;
  issued.set(handle, {
    content: parsed.value,
    core: core.value,
    contentSha256: createHash("sha256")
      .update(canonicalV2(parsed.value), "utf8")
      .digest("hex"),
  });
  return { ok: true, value: handle };
}
export function scorePreparedContentV3(
  handle: PreparedContentV3,
  input: unknown,
): V2Result<ContentScoreV3> {
  const fixed =
    handle !== null && typeof handle === "object"
      ? issued.get(handle)
      : undefined;
  if (!fixed) return failure("INVALID_PREPARED_DEFINITION");
  const score = scoreCompleteAnswersV2(fixed.core, input);
  if (!score.ok) return score;
  const template = fixed.content.bindings.resultReports.find(
    (r) =>
      refKey(r.resultRef) === refKey(score.value.decision.selectedResultRef),
  )!;
  const value = contentScoreV3Schema.parse({
    contentSchemaVersion: "quizpack-content.v3" as const,
    canonicalContentSha256: fixed.contentSha256,
    reportVersion: fixed.content.bindings.reportVersion,
    reportTemplateRef: template.templateRef,
    score: score.value,
  });
  try {
    canonicalV2(value, 64 * 1024);
  } catch {
    return failure("INPUT_LIMIT_EXCEEDED");
  }
  issuedScores.set(value, handle);
  return freeze({ ok: true, value });
}

/** D1 gate only. D2 composes approved cards and snapshots the complete six volumes. */
export function inspectComposedClaimV3(
  handle: PreparedContentV3,
  input: unknown,
  templateId: string,
  claimId: string,
): V2Result<{
  status: "accepted" | "facts-only" | "not-matched";
  evidence: {
    questionId: string;
    optionId: string;
    text: string;
    scope: string;
  }[];
}> {
  const score = scorePreparedContentV3(handle, input);
  return score.ok
    ? inspectScoredClaimV3(handle, score.value, templateId, claimId)
    : score;
}
export function inspectScoredClaimV3(
  handle: PreparedContentV3,
  scored: ContentScoreV3,
  templateId: string,
  claimId: string,
): ReturnType<typeof inspectComposedClaimV3> {
  const fixed =
    handle !== null && typeof handle === "object"
      ? issued.get(handle)
      : undefined;
  if (
    !fixed ||
    scored === null ||
    typeof scored !== "object" ||
    issuedScores.get(scored) !== handle
  )
    return failure("INVALID_PREPARED_DEFINITION");
  const score: ScoreSnapshotV2 = scored.score;
  const selectedTemplate = fixed.content.bindings.resultReports.find(
    (r) => refKey(r.resultRef) === refKey(score.decision.selectedResultRef),
  )!;
  const template = fixed.content.bindings.reportTemplates.find(
    (t) => t.ref.id === templateId,
  );
  if (
    !template ||
    refKey(template.ref) !== refKey(selectedTemplate.templateRef)
  )
    return failure("INVALID_REPORT_RULES");
  const claim = template?.claims.find((c) => c.ref.id === claimId);
  if (!claim) return failure("INVALID_REPORT_RULES");
  const c = fixed.content.core;
  const answers = new Map(
    score.normalizedAnswers.map((a) => [a.questionId, a.optionId]),
  );
  const hit = (e: (typeof claim.evidence)[number]) =>
    answers.get(e.questionRef.id) === e.optionRef.id;
  if (
    ![...claim.evidence, ...claim.counterevidence, ...claim.when.answers].every(
      hit,
    )
  )
    return freeze({ ok: true, value: { status: "not-matched", evidence: [] } });
  const dim = score.dimensions.find(
    (v) => refKey(v.dimensionRef) === refKey(claim.dimensionRef),
  )!;
  if (
    (claim.when.selectedResultRef &&
      refKey(claim.when.selectedResultRef) !==
        refKey(score.decision.selectedResultRef)) ||
    (claim.when.scoreRange &&
      (dim.score < claim.when.scoreRange.min ||
        dim.score > claim.when.scoreRange.max)) ||
    (claim.when.nearTie !== null &&
      claim.when.nearTie !== (score.decision.status === "near-tie"))
  )
    return freeze({ ok: true, value: { status: "not-matched", evidence: [] } });
  let allowed = true;
  if (claim.kind === "summary") {
    const sign = claim.direction === "high" ? 1 : -1;
    const axisEvidence = c.evidenceFamilies.entries
      .filter(
        (e) => e.core && refKey(e.dimensionRef) === refKey(claim.dimensionRef),
      )
      .map((e) => {
        const q = c.scoringDefinition.questions.find(
          (q) => refKey(q.ref) === refKey(e.questionRef),
        )!;
        const o = q.options.find((o) => o.ref.id === answers.get(q.ref.id))!;
        return {
          ...e,
          effect: o.contributions.find(
            (v) => refKey(v.dimensionRef) === refKey(e.dimensionRef),
          )!.value,
        };
      });
    const supporters = axisEvidence.filter(
      (e) =>
        claim.evidence.some(
          (s) => refKey(s.questionRef) === refKey(e.questionRef),
        ) && Math.sign(e.effect) === sign,
    );
    allowed =
      new Set(supporters.map((s) => s.family)).size >= 2 &&
      !axisEvidence.some((e) => Math.sign(e.effect) === -sign) &&
      claim.counterevidence.length === 0;
  }
  if (claim.kind === "literary")
    allowed =
      claim.literaryBridge?.review === "approved" &&
      claim.literaryBridge.grade === "medium" &&
      refKey(claim.literaryBridge.roleRef) ===
        refKey(score.decision.selectedResultRef);
  const evidence = [...claim.evidence, ...claim.counterevidence].map((e) => ({
    questionId: e.questionRef.id,
    optionId: e.optionRef.id,
    text: c.questions
      .find((q) => refKey(q.ref) === refKey(e.questionRef))!
      .options.find((o) => refKey(o.ref) === refKey(e.optionRef))!.label,
    scope: e.scope,
  }));
  return freeze({
    ok: true,
    value: { status: allowed ? "accepted" : "facts-only", evidence },
  });
}
