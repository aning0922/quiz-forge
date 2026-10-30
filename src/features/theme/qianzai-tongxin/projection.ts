import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "../preview/v3-projection";
import {
  readPreparedContentV3ForComposition,
  type PreparedContentV3,
} from "@/features/quizpack/content/v3-scoring-adapter";
import { failure, freeze } from "@/features/quiz/scoring/v2/boundary";
import {
  QIANZAI_PREVIEW_PRESENTATION,
  QIANZAI_CONSUMER_PRESENTATION,
} from "./component-map";

/** The dedicated renderer has no cover/background substitution for a missing preference scene. */
function projectEntry(
  input: unknown,
  expectedHash: string,
  presentation:
    typeof QIANZAI_PREVIEW_PRESENTATION | typeof QIANZAI_CONSUMER_PRESENTATION,
) {
  const projected = projectContentEntryV3(input, expectedHash);
  if (!projected.ok) return projected;
  if (!projected.value.slots.preferenceScene)
    return failure("REFERENCE_MISMATCH");
  return freeze({
    ok: true as const,
    value: { ...projected.value, ...presentation },
  });
}
function projectResult(
  handle: PreparedContentV3,
  input: unknown,
  presentation:
    typeof QIANZAI_PREVIEW_PRESENTATION | typeof QIANZAI_CONSUMER_PRESENTATION,
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
      display: { ...result.value.display, ...presentation },
    },
  });
}

/** Fixed previews never gain consumer export authority. */
export const projectQianzaiEntry = (input: unknown, hash: string) =>
  projectEntry(input, hash, QIANZAI_PREVIEW_PRESENTATION);
export const projectQianzaiResult = (
  handle: PreparedContentV3,
  input: unknown,
) => projectResult(handle, input, QIANZAI_PREVIEW_PRESENTATION);
/** Server-side projection for the newly registered consumer version only. */
export const projectQianzaiConsumerEntry = (input: unknown, hash: string) =>
  projectEntry(input, hash, QIANZAI_CONSUMER_PRESENTATION);
export const projectQianzaiConsumerResult = (
  handle: PreparedContentV3,
  input: unknown,
) => projectResult(handle, input, QIANZAI_CONSUMER_PRESENTATION);
