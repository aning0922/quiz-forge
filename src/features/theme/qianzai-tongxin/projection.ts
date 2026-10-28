import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "../preview/v3-projection";
import {
  readPreparedContentV3ForComposition,
  type PreparedContentV3,
} from "@/features/quizpack/content/v3-scoring-adapter";
import { failure, freeze } from "@/features/quiz/scoring/v2/boundary";
import { QIANZAI_PRESENTATION } from "./component-map";

/** The dedicated renderer has no cover/background substitution for a missing preference scene. */
export function projectQianzaiEntry(input: unknown, expectedHash: string) {
  const projected = projectContentEntryV3(input, expectedHash);
  if (!projected.ok) return projected;
  if (!projected.value.slots.preferenceScene)
    return failure("REFERENCE_MISMATCH");
  return freeze({
    ok: true as const,
    value: { ...projected.value, ...QIANZAI_PRESENTATION },
  });
}
export function projectQianzaiResult(
  handle: PreparedContentV3,
  input: unknown,
) {
  const source = readPreparedContentV3ForComposition(handle);
  if (!source?.bindings.slots.neutral.preferenceScene)
    return failure("REFERENCE_MISMATCH");
  const result = projectPreparedResultV3(handle, input);
  if (!result.ok) return result;
  return freeze({
    ok: true as const,
    value: {
      ...result.value,
      display: { ...result.value.display, ...QIANZAI_PRESENTATION },
    },
  });
}
