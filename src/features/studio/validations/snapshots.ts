import type { ValidationDto } from "@/features/quizpack/validation/contracts";
/** Keep the highest acknowledged revision for each row within one route pair's component. */
export function mergeValidationSnapshots(
  previous: Readonly<Record<string, ValidationDto>>,
  incoming: readonly ValidationDto[],
): Record<string, ValidationDto> {
  const next = { ...previous };
  for (const row of incoming) {
    const known = next[row.id];
    if (!known || row.stateRevision > known.stateRevision) next[row.id] = row;
  }
  return next;
}
