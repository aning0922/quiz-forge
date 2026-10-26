import { createHash } from "node:crypto";
import {
  displayEntryBodyV2Schema,
  resultDisplaySnapshotV2Schema,
} from "@/lib/assessment-contract/display-v2";
import {
  neutralSlotRefsV3,
  characterSlotRefsV3,
} from "@/lib/assessment-contract/presentation-v3";
import {
  canonicalV2,
  failure,
  freeze,
  refKey,
} from "@/features/quiz/scoring/v2/boundary";
import { validateContentV3 } from "@/features/quizpack/content/v3-references";
import {
  readPreparedContentV3ForComposition,
  type PreparedContentV3,
} from "@/features/quizpack/content/v3-scoring-adapter";
import { composePreparedReportV3 } from "@/features/report/composed-v1/compose";
import type { QuizPackContentV3 } from "@/features/quizpack/content/v3";

const hash = (value: unknown) =>
  createHash("sha256").update(canonicalV2(value), "utf8").digest("hex");
export function selectedDisplayAssetsV3(
  content: QuizPackContentV3,
  refs: ReturnType<typeof neutralSlotRefsV3>,
) {
  const required = new Set(refs.map(refKey));
  return content.bindings.resources
    .filter((r) => required.has(refKey(r)))
    .map((r) => ({
      resourceRef: { id: r.id, productId: r.productId, version: r.version },
      mediaType: r.mediaType,
      bytes: r.bytes,
      sha256: r.sha256,
      width: r.width,
      height: r.height,
      purpose: r.purpose,
      approval: r.approval,
      alt: content.bindings.visualPresentation.resourceDescriptions.find(
        (d) => refKey(d.resourceRef) === refKey(r),
      )!.alt,
    }));
}
export function projectContentEntryV3(
  input: unknown,
  expectedContentSha256: string,
) {
  const checked = validateContentV3(input);
  if (!checked.ok) return checked;
  const content = checked.value;
  if (hash(content) !== expectedContentSha256)
    return failure("REFERENCE_MISMATCH");
  const entry = displayEntryBodyV2Schema.parse({
    schemaVersion: "quiz-entry-display.v2",
    contentSchemaVersion: "quizpack-content.v3",
    canonicalContentSha256: expectedContentSha256,
    kind: content.bindings.kind,
    product: {
      productId: content.core.scoringDefinition.productId,
      title: content.core.title,
    },
    matchingPolicyRef: content.core.scoringDefinition.matchingPolicy.ref,
    preferences: ["male", "female", "any"],
    questions: content.core.questions,
    slots: content.bindings.slots.neutral,
    assets: selectedDisplayAssetsV3(
      content,
      neutralSlotRefsV3(content.bindings.slots),
    ),
  });
  try {
    canonicalV2(entry, 524288);
  } catch {
    return failure("INPUT_LIMIT_EXCEEDED");
  }
  return freeze({ ok: true as const, value: entry });
}
/** Exact fixed handle + actual answers/context. Never accepts a caller-supplied report. */
export function projectPreparedResultV3(
  handle: PreparedContentV3,
  input: unknown,
) {
  const content = readPreparedContentV3ForComposition(handle);
  if (!content) return failure("INVALID_PREPARED_DEFINITION");
  const composed = composePreparedReportV3(handle, input);
  if (!composed.ok) return composed;
  const { score, body, bodySha256 } = composed.value;
  const s = score.score;
  const character = content.bindings.slots.characters.find(
    (c) => refKey(c.resultRef) === refKey(s.decision.selectedResultRef),
  )!;
  const display = resultDisplaySnapshotV2Schema.parse({
    schemaVersion: "quiz-result-display.v2",
    contentSchemaVersion: "quizpack-content.v3",
    contentVersion: content.core.scoringDefinition.contentVersion,
    reportVersion: content.bindings.reportVersion,
    canonicalContentSha256: score.canonicalContentSha256,
    logicHash: s.logicHash,
    answersHash: s.answersHash,
    inputHash: s.inputHash,
    matchingContextSha256: s.matchingContextSha256,
    selectedResultRef: s.decision.selectedResultRef,
    reportTemplateRef: score.reportTemplateRef,
    body,
    bodySha256,
    slots: { neutral: content.bindings.slots.neutral, character },
    assets: selectedDisplayAssetsV3(content, [
      ...neutralSlotRefsV3(content.bindings.slots),
      ...characterSlotRefsV3(character),
    ]),
  });
  try {
    canonicalV2(display, 524288);
  } catch {
    return failure("INPUT_LIMIT_EXCEEDED");
  }
  return freeze({ ok: true as const, value: { score, display } });
}
