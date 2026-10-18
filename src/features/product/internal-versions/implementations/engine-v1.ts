import "server-only";
import { engineDeclarationSchema } from "@/lib/assessment-contract/primitives";
import type { ScoringResult } from "@/lib/assessment-contract/scoring-api-v1";
import { parseSupportedContent } from "@/features/quizpack/content/supported";
import {
  prepareContentForScoring,
  scorePreparedContent,
  verifyPreparedContentWitnesses,
  type PreparedContent,
  type ContentScore,
  type ContentWitnessEvidence,
} from "@/features/quizpack/content/scoring-adapter";
import { contentScoringFailure } from "@/features/quizpack/content/scoring-output";
declare const fixedEngineHandle: unique symbol;
export type FixedEngineHandle = Readonly<{ [fixedEngineHandle]: true }>;
/** Bound by a compiled exact resolver, never by a caller-selected executable or URL. */
export function bindEngineV1(algorithmInput: {
  id: "dimensions" | "archetype";
  version: "1.0.0";
}) {
  const algorithm = Object.freeze(
    engineDeclarationSchema.parse(algorithmInput),
  );
  const issued = new WeakMap<object, PreparedContent>();
  const read = (handle: FixedEngineHandle) =>
    handle && typeof handle === "object" ? issued.get(handle) : undefined;
  return Object.freeze({
    prepare(input: unknown): ScoringResult<FixedEngineHandle> {
      const content = parseSupportedContent(input);
      if (!content.ok) return contentScoringFailure("INVALID_DEFINITION");
      if (
        content.value.engine.id !== algorithm.id ||
        content.value.engine.version !== algorithm.version
      )
        return contentScoringFailure("REFERENCE_MISMATCH");
      const prepared = prepareContentForScoring(content.value);
      if (!prepared.ok) return prepared;
      const handle = Object.freeze({}) as FixedEngineHandle;
      issued.set(handle, prepared.value);
      return Object.freeze({ ok: true, value: handle });
    },
    score(
      handle: FixedEngineHandle,
      answers: unknown,
    ): ScoringResult<ContentScore> {
      const prepared = read(handle);
      if (!prepared)
        return contentScoringFailure("INVALID_PREPARED_DEFINITION");
      const result = scorePreparedContent(prepared, answers);
      if (
        result.ok &&
        (result.value.score.engine.id !== algorithm.id ||
          result.value.score.engine.version !== algorithm.version)
      )
        return contentScoringFailure("REFERENCE_MISMATCH");
      return result;
    },
    witnesses(
      handle: FixedEngineHandle,
    ): ScoringResult<ContentWitnessEvidence> {
      const prepared = read(handle);
      return prepared
        ? verifyPreparedContentWitnesses(prepared)
        : contentScoringFailure("INVALID_PREPARED_DEFINITION");
    },
  });
}
