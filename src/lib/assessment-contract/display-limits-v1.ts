/** Frozen display-v1 budgets. A caller may shorten an absolute deadline, never extend it. */
export const DISPLAY_LIMITS_V1 = Object.freeze({
  imageBytes: 8_388_608,
  deadlineMs: 15_000,
});
export const DISPLAY_POSTER_LIMITS_V1 = Object.freeze({
  width: 1080,
  height: 1920,
  dimensions: 4,
  dimensionLabelCodepoints: 8,
  displayNameCodepoints: 12,
  subtitleCodepoints: 24,
  lineCodepoints: 48,
  disclosureCodepoints: 72,
});
export const DISPLAY_COMPONENT_IDS_V1 = Object.freeze({
  cover: "folio-cover",
  question: "folio-question",
  resume: "folio-resume",
  result: "cabinet-result",
  report: "folio-report",
  poster: "folio-poster",
} as const);
