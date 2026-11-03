/** Explicit local review only. Never called by a registered renderer or report
 * resolver. The original composed body and its identity are retained verbatim. */
import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import { qianzaiSnapshotDocument } from "@/features/report/qianzai-tongxin/presentation";
import type { QianzaiResultPresentation } from "@/features/report/qianzai-tongxin/result-presentation";
import { QIANZAI_CLASSICAL_EDITION } from "@/features/report/qianzai-tongxin/classical-edition";
import {
  QIANZAI_EVIDENCE_READING_VERSION,
  qianzaiSupportedThemeReading,
} from "@/features/report/qianzai-tongxin/supported-theme-reading";

export function qianzaiReadingCandidate(
  body: ComposedReportBodyV1,
  presentation: QianzaiResultPresentation,
) {
  const baseline = qianzaiSnapshotDocument(body, undefined, presentation);
  if (!baseline.consumerEdition)
    throw Error("READING_CANDIDATE_UNBOUND_SOURCE");
  const readings = qianzaiSupportedThemeReading(body);
  const original = baseline.sections.find((s) => s.id === "patterns")!;
  // Reuse the fixed literary paragraph from the qualified v2 display card.
  // Never split raw answers or composed snapshot prose into new conclusions.
  const references = readings.map((reading, index) => {
    const block = original.blocks[index];
    const parts = block?.text.split("\n\n");
    if (
      block?.snapshot !== reading.snapshot ||
      parts?.length !== 3 ||
      !parts[1]
    )
      throw Error("READING_CANDIDATE_REFERENCE_UNBOUND");
    return parts[1];
  });
  return {
    scope:
      "local-synthetic-reading-candidate-no-renderer-registration" as const,
    readingVersion: QIANZAI_EVIDENCE_READING_VERSION,
    baseline,
    document: {
      ...baseline,
      consumerCopyVersion: QIANZAI_CLASSICAL_EDITION.copyVersion,
      sections: baseline.sections.map((section) =>
        section.id !== "patterns" || readings.length === 0
          ? section
          : {
              ...section,
              title: "选择里的线索",
              blocks: readings.map((reading, index) => ({
                layout: "card" as const,
                title: reading.title,
                text: `${reading.choice}${reading.meaning}\n\n**与人物的呼应**：${references[index]}\n\n**放回具体条件看**：${reading.condition}\n\n**带进日常的一小步**：${reading.nextStep}`,
                snapshot: reading.snapshot,
              })),
            },
      ),
    },
  };
}
