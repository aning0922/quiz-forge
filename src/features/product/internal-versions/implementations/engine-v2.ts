import "server-only";
import { engineDeclarationV2Schema } from "@/lib/assessment-contract/scoring-v2";
import { failure } from "@/features/quiz/scoring/v2/boundary";
import {
  prepareContentV3,
  scorePreparedContentV3,
  readPreparedContentV3ForComposition,
  type PreparedContentV3,
} from "@/features/quizpack/content/v3-scoring-adapter";
import { composePreparedReportV3 } from "@/features/report/composed-v1/compose";
import { verifyPreparedContentWitnessesV3 } from "@/features/quizpack/content/v3-witnesses";

/** One exact compiled algorithm; request fields cannot select or replace executable code. */
export function bindEngineV2(algorithmInput: {
  id: "archetype-l1";
  version: "1.0.0";
}) {
  const algorithm = Object.freeze(
    engineDeclarationV2Schema.parse(algorithmInput),
  );
  const issued = new WeakSet<object>();
  const owns = (handle: PreparedContentV3) =>
    handle && typeof handle === "object" && issued.has(handle);
  return Object.freeze({
    prepare(input: unknown) {
      const prepared = prepareContentV3(input);
      if (!prepared.ok) return prepared;
      const content = readPreparedContentV3ForComposition(prepared.value)!;
      const actual = content.core.scoringDefinition.engine;
      if (actual.id !== algorithm.id || actual.version !== algorithm.version)
        return failure("REFERENCE_MISMATCH");
      issued.add(prepared.value);
      return prepared;
    },
    score(handle: PreparedContentV3, input: unknown) {
      if (!owns(handle)) return failure("INVALID_PREPARED_DEFINITION");
      return scorePreparedContentV3(handle, input);
    },
    compose(handle: PreparedContentV3, input: unknown) {
      if (!owns(handle)) return failure("INVALID_PREPARED_DEFINITION");
      return composePreparedReportV3(handle, input);
    },
    witnesses(handle: PreparedContentV3) {
      if (!owns(handle)) return failure("INVALID_PREPARED_DEFINITION");
      return verifyPreparedContentWitnessesV3(handle);
    },
  });
}
