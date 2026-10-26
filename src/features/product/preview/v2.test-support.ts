import { createHash } from "node:crypto";
import { synthetic24ContentV3 } from "@/features/quizpack/content/v3-synthetic.test-support";
import { canonicalV2 } from "@/features/quiz/scoring/v2/boundary";
import { prepareContentV3 } from "@/features/quizpack/content/v3-scoring-adapter";
import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "@/features/theme/preview/v3-projection";
import { PREVIEW_RENDERER_V2, previewBindingV2Schema } from "./contracts-v2";
import { STRUCTURED_FONT_V2 } from "@/lib/consumer-contract/v2/identities";
import { readContentMetadata } from "@/features/quizpack/content/current";
/** Only invented content/pixels/DTOs. No stored draft, authorization or consumer record. */
export async function temporaryPreviewFixtureV2(
  preference: "any" | "female" | "male" = "any",
) {
  const { content } = await synthetic24ContentV3(),
    m = readContentMetadata(content);
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const scope = {
    productId: m.productId,
    draftId: "11111111-1111-4111-8111-111111111111",
    revision: 1,
  };
  const text = canonicalV2(content),
    contentHash = hash(text);
  const ledger = {
    schemaVersion: "quizpack-candidate-asset-set.v1",
    productId: scope.productId,
    resources: m.resources
      .map((r) => ({
        productId: r.productId,
        resourceId: r.id,
        resourceVersion: r.version,
        blobSha256: r.sha256,
        declarationSha256: hash(canonicalV2(r)),
      }))
      .sort((a, b) =>
        a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0,
      ),
  };
  const assetText = canonicalV2(ledger),
    assetHash = hash(assetText);
  const binding = previewBindingV2Schema.parse({
    ...scope,
    schemaVersion: "quizforge.preview-binding.v2",
    canonicalContentSha256: contentHash,
    assetSetSha256: assetHash,
    renderer: PREVIEW_RENDERER_V2,
    font: STRUCTURED_FONT_V2,
  });
  const e = projectContentEntryV3(content, contentHash),
    p = prepareContentV3(content);
  if (!e.ok || !p.ok) throw Error("SYNTHETIC_PREVIEW_FAILED");
  const answers = content.bindings.witnesses.entries[0]!.answers;
  const matchingContext = {
    schemaVersion: "quiz-matching-context.v1" as const,
    preference,
    policyRef: content.core.scoringDefinition.matchingPolicy.ref,
  };
  const request = {
    binding,
    requestId: "22222222-2222-4222-8222-222222222222",
    answers,
    matchingContext,
  };
  const scored = projectPreparedResultV3(p.value, {
    schemaVersion: "quiz-scoring-input.v2",
    answers,
    matchingContext,
  });
  if (!scored.ok) throw Error("SYNTHETIC_SCORE_FAILED");
  const entry = { kind: "temporary-preview" as const, binding, entry: e.value };
  const result = {
    kind: "temporary-preview" as const,
    binding,
    requestId: request.requestId,
    result: scored.value.display,
  };
  const row = {
    product_id: scope.productId,
    draft_id: scope.draftId,
    revision: 1,
    canonical_content_text: text,
    canonical_content_sha256: contentHash,
    asset_set_text: assetText,
    asset_set_sha256: assetHash,
    resource_count: m.resources.length,
    content_schema_version: content.schemaVersion,
    content_kind: m.kind,
    content_version: m.contentVersion,
    visual_version: m.visualVersion,
    report_version: m.reportVersion,
    resource_version: m.resourceVersion,
    component_version: m.componentVersion,
    engine_id: m.engine.id,
    engine_version: m.engine.version,
  };
  return { content, scope, binding, entry, result, request, row };
}
