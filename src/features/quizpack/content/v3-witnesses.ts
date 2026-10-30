import {
  readPreparedContentV3ForComposition,
  scorePreparedContentV3,
  type PreparedContentV3,
} from "./v3-scoring-adapter";
import {
  digestV2,
  failure,
  freeze,
  refKey,
} from "@/features/quiz/scoring/v2/boundary";
export function verifyPreparedContentWitnessesV3(handle: PreparedContentV3) {
  const c = readPreparedContentV3ForComposition(handle);
  if (!c) return failure("INVALID_PREPARED_DEFINITION");
  const entries = [];
  let canonicalContentSha256 = "",
    logicHash = "";
  for (const profile of c.core.scoringDefinition.profiles) {
    const w = c.bindings.witnesses.entries.find(
      (w) => refKey(w.expectedResultRef) === refKey(profile.resultRef),
    )!;
    const scored = scorePreparedContentV3(handle, {
      schemaVersion: "quiz-scoring-input.v2",
      answers: w.answers,
      matchingContext: {
        schemaVersion: "quiz-matching-context.v1",
        preference: w.preference,
        policyRef: c.core.scoringDefinition.matchingPolicy.ref,
      },
    });
    if (!scored.ok) return scored;
    if (
      refKey(scored.value.score.decision.selectedResultRef) !==
      refKey(w.expectedResultRef)
    )
      return failure("REFERENCE_MISMATCH");
    canonicalContentSha256 = scored.value.canonicalContentSha256;
    logicHash = scored.value.score.logicHash;
    entries.push({
      expectedResultRef: w.expectedResultRef,
      selectedResultRef: scored.value.score.decision.selectedResultRef,
      inputHash: scored.value.score.inputHash,
      logicHash,
    });
  }
  const evidence = {
    schemaVersion: "quiz-witness-evidence.v2",
    status: "passed",
    logicHash,
    entries,
  };
  return freeze({
    ok: true as const,
    value: {
      sourceBinding: {
        kind: "complete-content",
        contentSchemaVersion: "quizpack-content.v3",
        productId: c.core.scoringDefinition.productId,
        contentVersion: c.core.scoringDefinition.contentVersion,
        canonicalContentSha256,
      },
      evidence: {
        ...evidence,
        evidenceSha256: digestV2("quiz-witnesses.v2", evidence),
      },
    },
  });
}
