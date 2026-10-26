import { validateContentGraph } from "../content/reference-graph";
import { validatePresentationReferences } from "../content/references";
import { V2_STATE_COMPONENT_CONTRACTS } from "../content/v2";
import { P1_STATE_COMPONENT_CONTRACTS } from "../v1/compatibility";
import type { SupportedParsedPack, IssueBatch } from "./api";
import { collectIssues } from "./issues";
import { PACK_LIMITS } from "../v1/limits";
import { validateContentV3 } from "../content/v3-references";
import { readContentMetadata } from "../content/current";
import { canonicalP1Json } from "../v1/canonical";
/** Full manifest/content reference closure, with the shared base graph run exactly once. */
export function validateSupportedPackReferences(
  pack: SupportedParsedPack,
  targetProductId: string,
): IssueBatch {
  if (pack.contentSchemaVersion === "quizpack-content.v3") {
    const c = pack.content,
      m = pack.manifest,
      metadata = readContentMetadata(c);
    const checked = validateContentV3(c),
      issues: import("../v1/api").PackIssue[] = [];
    const mismatch = () =>
      issues.push({
        code: "CONTENT_DECLARATION_MISMATCH",
        path: [],
        message:
          "Manifest and content must match the expected content schema version.",
      });
    if (!checked.ok)
      for (const i of checked.issues)
        issues.push({
          code: i.code,
          path: [],
          message: "Value does not satisfy the declared v3 content contract.",
        });
    if (
      metadata.productId !== targetProductId ||
      m.productId !== targetProductId ||
      canonicalP1Json(m.engine) !== canonicalP1Json(metadata.engine) ||
      m.components.length !== 6 ||
      new Set(m.components.map((v) => canonicalP1Json(v))).size !== 6 ||
      metadata.components.some(
        (v) =>
          !m.components.some((b) => canonicalP1Json(b) === canonicalP1Json(v)),
      )
    )
      mismatch();
    for (const resource of metadata.resources) {
      const f = m.files.filter((f) => f.path === resource.path);
      if (
        f.length !== 1 ||
        f[0]!.bytes !== resource.bytes ||
        f[0]!.sha256 !== resource.sha256 ||
        f[0]!.mediaType !== resource.mediaType
      )
        mismatch();
    }
    if (
      new Set(metadata.resources.map((r) => r.path)).size !==
        metadata.resources.length ||
      m.files.length !== metadata.resources.length + 1 ||
      m.files.filter((f) => f.path === "content.json").length !== 1
    )
      mismatch();
    return collectIssues(issues, PACK_LIMITS.issues);
  }
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
