import {
  COMPOSED_BUDGET_V1 as B,
  COMPOSED_FACT_ONLY_V1,
  COMPOSED_NOTICE_V1,
} from "@/lib/assessment-contract/composed-report-v1";
import { quoteContentEvidenceV3, contentRoleFactV3 } from "./v3-report-facts";
import type { QuizPackContentV3 } from "./v3";
import { refKey } from "@/features/quiz/scoring/v2/boundary";
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");
const largest = <T>(values: T[]) =>
  values.reduce((a, b) => (bytes(a) > bytes(b) ? a : b));

/** Conservative combinations; never enumerate answer paths or assume conditions are exclusive. */
export function estimateContentReportBudgetV3(content: QuizPackContentV3) {
  const core = content.core;
  const role = largest(
    core.results.map((r) => contentRoleFactV3(content, r.ref, 100)),
  );
  const answers = core.questions.map((q) =>
    largest(
      q.options.map((o) => ({
        questionRef: q.ref,
        optionRef: o.ref,
        prompt: q.prompt,
        optionText: o.label,
        act: q.act,
      })),
    ),
  );
  const templateBounds = content.bindings.reportTemplates.map((template) => {
    const volumes = template.volumes.map((v) => {
      const fallback = {
        claimRef: null,
        kind: "fallback",
        status: "fallback",
        text: v.fallbackText,
        evidence: [],
        counterevidence: [],
      };
      const candidates = v.claimRefs
        .map((r) => {
          const c = template.claims.find((c) => refKey(c.ref) === refKey(r))!;
          return {
            claimRef: c.ref,
            kind: c.kind,
            status: "facts-only",
            text: largest([c.text, COMPOSED_FACT_ONLY_V1]),
            evidence: c.evidence.map((e) => quoteContentEvidenceV3(content, e)),
            counterevidence: c.counterevidence.map((e) =>
              quoteContentEvidenceV3(content, e),
            ),
          };
        })
        .sort((a, b) => bytes(b) - bytes(a))
        .slice(0, v.maxClaims);
      return {
        id: v.id,
        title: v.title,
        paragraphs:
          bytes(candidates) >= bytes([fallback]) ? candidates : [fallback],
      };
    });
    const body = {
      schemaVersion: "quiz-composed-report.v1",
      title: core.title,
      notice: COMPOSED_NOTICE_V1,
      provenance: {
        canonicalContentSha256: "f".repeat(64),
        templateRef: template.ref,
        reportVersion: content.bindings.reportVersion,
        evidenceFamilyVersion: core.evidenceFamilies.version,
        logicHash: "f".repeat(64),
        inputHash: "f".repeat(64),
        answersHash: "f".repeat(64),
        matchingContextSha256: "f".repeat(64),
      },
      matching: {
        selected: role,
        runnerUp: role,
        status: "single-candidate",
        gapTotal: 1600,
      },
      dimensions: core.dimensions.map((d) => ({
        dimensionRef: d.ref,
        label: d.label,
        score: 100,
      })),
      answers,
      volumes,
    };
    const bodyUpperBound = bytes(body);
    return {
      templateRef: template.ref,
      bodyUpperBound,
      snapshotUpperBound:
        B.reservedSnapshotBytes + B.bodyCopiesInSnapshot * bodyUpperBound,
      responseUpperBound: B.reservedResponseBytes + bodyUpperBound,
    };
  });
  return {
    policy: B.policy,
    ok: templateBounds.every(
      (v) =>
        v.snapshotUpperBound <= B.reportSnapshotBytes &&
        v.responseUpperBound <= B.reportResponseBytes,
    ),
    templateBounds,
  };
}
