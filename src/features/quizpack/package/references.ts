import { validateContentGraph } from "../content/reference-graph";
import { validatePresentationReferences } from "../content/references";
import { V2_STATE_COMPONENT_CONTRACTS } from "../content/v2";
import { P1_STATE_COMPONENT_CONTRACTS } from "../v1/compatibility";
import type { SupportedParsedPack, IssueBatch } from "./api";
import { collectIssues } from "./issues";
import { PACK_LIMITS } from "../v1/limits";
/** Full manifest/content reference closure, with the shared base graph run exactly once. */
export function validateSupportedPackReferences(
  pack: SupportedParsedPack,
  targetProductId: string,
): IssueBatch {
  return collectIssues(
    [
      ...validateContentGraph(
        pack.content,
        targetProductId,
        pack.contentSchemaVersion === "quizpack-content.v1"
          ? P1_STATE_COMPONENT_CONTRACTS
          : V2_STATE_COMPONENT_CONTRACTS,
        pack.manifest,
      ),
      ...(pack.contentSchemaVersion === "quizpack-content.v2"
        ? validatePresentationReferences(pack.content)
        : []),
    ],
    PACK_LIMITS.issues,
  );
}
