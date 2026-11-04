import { QIANZAI_EXPERIENCE_CONTENT_SHA256 } from "@/features/quizpack/content/private-test-known-ten-experience-source";

/** Actual content-only staging at b3's normal root. Presentation eligibility only;
 * no QuizPack/manifest/asset-set, database, renderer or commercial approval. */
export const QIANZAI_KNOWN_PRESENTATION_SOURCE_SHA256 =
  "6f003080c99d9c3565a90ea583dd71410969593afe5ff322e2a28142d8b0ccf1";
/** Current presentation only; source admission and runtime qualification remain separate. */
export const QIANZAI_EXPERIENCE_PRESENTATION_SOURCE_SHA256 =
  QIANZAI_EXPERIENCE_CONTENT_SHA256;
export const QIANZAI_KNOWN_SHARED_TEMPLATE_REF = Object.freeze({
  productId: "qianzai-tongxin",
  id: "report-ten-literary-shared",
  version: "2.0.0",
});

export function qianzaiKnownPresentationSourceMatches(
  value: string | undefined,
) {
  return value === QIANZAI_EXPERIENCE_PRESENTATION_SOURCE_SHA256;
}
