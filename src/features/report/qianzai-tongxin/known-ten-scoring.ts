import {
  scoringDefinitionV2Schema,
  type ScoringDefinitionV2,
} from "@/lib/assessment-contract/scoring-v2";
import {
  QIANZAI_KNOWN_TEN_ROLES,
  QIANZAI_KNOWN_ROLE_VERSION,
} from "./known-ten-catalog";

/** Candidate configuration adapter only: existing questions, dimension rules and
 * matching algorithm remain unchanged. No source or runtime admission occurs. */
export function qianzaiKnownScoringDefinition(input: ScoringDefinitionV2) {
  const original = scoringDefinitionV2Schema.parse(input);
  if (original.productId !== "qianzai-tongxin")
    throw Error("KNOWN_CATALOG_PRODUCT_MISMATCH");
  return scoringDefinitionV2Schema.parse({
    ...original,
    contentVersion: QIANZAI_KNOWN_ROLE_VERSION,
    profiles: QIANZAI_KNOWN_TEN_ROLES.map((role) => ({
      resultRef: role.ref,
      sex: role.sex,
      kind: role.kind,
      stableRankKey:
        original.profiles.find((p) => p.resultRef.id === role.id)
          ?.stableRankKey ?? role.id.replaceAll("-", "_"),
      targets: original.dimensions.map((dimension, index) => ({
        dimensionRef: dimension.ref,
        value: role.designTargets[index],
      })),
    })),
  });
}
