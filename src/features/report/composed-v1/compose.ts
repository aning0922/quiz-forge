import { createHash } from "node:crypto";
import {
  composedReportBodyV1Schema,
  COMPOSED_NOTICE_V1,
  COMPOSED_FACT_ONLY_V1,
  COMPOSED_BUDGET_V1,
  type ComposedReportBodyV1,
} from "@/lib/assessment-contract/composed-report-v1";
import type { V2Result } from "@/lib/assessment-contract/scoring-api-v2";
import {
  canonicalV2,
  failure,
  freeze,
  refKey,
} from "@/features/quiz/scoring/v2/boundary";
import {
  readPreparedContentV3ForComposition,
  scorePreparedContentV3,
  inspectScoredClaimV3,
  type PreparedContentV3,
  type ContentScoreV3,
} from "@/features/quizpack/content/v3-scoring-adapter";
import {
  quoteContentEvidenceV3,
  contentRoleFactV3,
} from "@/features/quizpack/content/v3-report-facts";

export function composePreparedReportV3(
  handle: PreparedContentV3,
  input: unknown,
): V2Result<{
  body: ComposedReportBodyV1;
  bodySha256: string;
  score: ContentScoreV3;
}> {
  const content = readPreparedContentV3ForComposition(handle);
  if (!content) return failure("INVALID_PREPARED_DEFINITION");
  const scored = scorePreparedContentV3(handle, input);
  if (!scored.ok) return scored;
  const score = scored.value.score,
    core = content.core;
  const template = content.bindings.reportTemplates.find(
    (t) => refKey(t.ref) === refKey(scored.value.reportTemplateRef),
  )!;
  const volumes: ComposedReportBodyV1["volumes"] = [];
  for (const volume of template.volumes) {
    const paragraphs: ComposedReportBodyV1["volumes"][number]["paragraphs"] =
      [];
    for (const claimRef of volume.claimRefs) {
      const claim = template.claims.find(
        (c) => refKey(c.ref) === refKey(claimRef),
      )!;
      const checked = inspectScoredClaimV3(
        handle,
        scored.value,
        template.ref.id,
        claim.ref.id,
      );
      if (!checked.ok) return checked;
      if (checked.value.status === "not-matched") continue;
      paragraphs.push({
        claimRef: claim.ref,
        kind: claim.kind,
        status: checked.value.status,
        text:
          checked.value.status === "accepted"
            ? claim.text
            : COMPOSED_FACT_ONLY_V1,
        evidence: claim.evidence.map((e) => quoteContentEvidenceV3(content, e)),
        counterevidence: claim.counterevidence.map((e) =>
          quoteContentEvidenceV3(content, e),
        ),
      });
      if (paragraphs.length >= volume.maxClaims) break;
    }
    if (!paragraphs.length)
      paragraphs.push({
        claimRef: null,
        kind: "fallback",
        status: "fallback",
        text: volume.fallbackText,
        evidence: [],
        counterevidence: [],
      });
    volumes.push({ id: volume.id, title: volume.title, paragraphs });
  }
  const selected = score.decision.rankings[0]!,
    runner = score.decision.rankings[1];
  const body = composedReportBodyV1Schema.parse({
    schemaVersion: "quiz-composed-report.v1",
    title: core.title,
    notice: COMPOSED_NOTICE_V1,
    provenance: {
      canonicalContentSha256: scored.value.canonicalContentSha256,
      templateRef: template.ref,
      reportVersion: content.bindings.reportVersion,
      evidenceFamilyVersion: core.evidenceFamilies.version,
      logicHash: score.logicHash,
      inputHash: score.inputHash,
      answersHash: score.answersHash,
      matchingContextSha256: score.matchingContextSha256,
    },
    matching: {
      selected: contentRoleFactV3(
        content,
        selected.resultRef,
        selected.narrativeIndex,
      ),
      runnerUp: runner
        ? contentRoleFactV3(content, runner.resultRef, runner.narrativeIndex)
        : null,
      status: score.decision.status,
      gapTotal: score.decision.gapTotal,
    },
    dimensions: score.dimensions.map((d) => ({
      dimensionRef: d.dimensionRef,
      label: core.dimensions.find(
        (v) => refKey(v.ref) === refKey(d.dimensionRef),
      )!.label,
      score: d.score,
    })),
    answers: score.normalizedAnswers.map((a) => {
      const q = core.questions.find((q) => q.ref.id === a.questionId)!,
        o = q.options.find((o) => o.ref.id === a.optionId)!;
      return {
        questionRef: q.ref,
        optionRef: o.ref,
        prompt: q.prompt,
        optionText: o.label,
        act: q.act,
      };
    }),
    volumes,
  });
  let text: string;
  try {
    text = canonicalV2(
      body,
      COMPOSED_BUDGET_V1.reportResponseBytes -
        COMPOSED_BUDGET_V1.reservedResponseBytes,
    );
  } catch {
    return failure("INPUT_LIMIT_EXCEEDED");
  }
  return freeze({
    ok: true,
    value: {
      body,
      bodySha256: createHash("sha256").update(text, "utf8").digest("hex"),
      score: scored.value,
    },
  });
}
