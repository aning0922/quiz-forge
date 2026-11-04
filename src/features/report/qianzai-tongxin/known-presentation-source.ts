/** Actual content-only staging at b3's normal root. Presentation eligibility only;
 * no QuizPack/manifest/asset-set, database, renderer or commercial approval. */
export const QIANZAI_KNOWN_PRESENTATION_SOURCE_SHA256 =
  "6f003080c99d9c3565a90ea583dd71410969593afe5ff322e2a28142d8b0ccf1";
export const QIANZAI_KNOWN_SHARED_TEMPLATE_REF = Object.freeze({
  productId: "qianzai-tongxin",
  id: "report-ten-literary-shared",
  version: "2.0.0",
});

export function qianzaiKnownPresentationSourceMatches(
  value: string | undefined,
) {
  return value === QIANZAI_KNOWN_PRESENTATION_SOURCE_SHA256;
}
