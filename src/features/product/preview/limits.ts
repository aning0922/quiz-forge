import { DISPLAY_LIMITS_V1 } from "@/lib/assessment-contract/display-limits-v1";
export const PREVIEW_LIMITS = Object.freeze({
  answersBytes: 65_536,
  scoreRequestBytes: 98_304,
  entryResponseBytes: 524_288,
  revealResponseBytes: 262_144,
  errorResponseBytes: 4096,
  resourceQueryBytes: 4096,
  imageBytes: DISPLAY_LIMITS_V1.imageBytes,
  imageReadSlots: 4,
  imageChunkBytes: 65_536,
  deadlineMs: DISPLAY_LIMITS_V1.deadlineMs,
  lockDeadlineMs: 2000,
  fileDeadlineMs: 5000,
  closeObservationMs: 5000,
  depth: 32,
});
export { DISPLAY_POSTER_LIMITS_V1 as PREVIEW_POSTER_LIMITS } from "@/lib/assessment-contract/display-limits-v1";
