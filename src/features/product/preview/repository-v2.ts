import "server-only";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { StudioError } from "@/lib/http-security/errors";
import {
  parseCurrentContent,
  readContentMetadata,
} from "@/features/quizpack/content/current";
import { canonicalV2 } from "@/features/quiz/scoring/v2/boundary";
import { assetSetLedgerSchema } from "@/features/quizpack/validation/repository";
import { productRow } from "../workspace/repository";
import {
  readFixedPreviewSource,
  resolveFixedPreviewResource,
} from "./repository";
import type { PreviewScope } from "./contracts";
import { previewBindingV2Schema, PREVIEW_RENDERER_V2 } from "./contracts-v2";
import { STRUCTURED_FONT_V2 } from "@/lib/consumer-contract/v2/identities";
import { DRAFT_LIMITS } from "../drafts/contracts";
const invalid = () => new StudioError("PREVIEW_UNSUPPORTED");
const hash = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");
function checked(text: string | null, sha: string, maximum: number): unknown {
  if (
    text === null ||
    Buffer.byteLength(text, "utf8") > maximum ||
    hash(text) !== sha
  )
    throw invalid();
  try {
    const v: unknown = JSON.parse(text);
    if (canonicalV2(v, maximum) !== text) throw invalid();
    return v;
  } catch {
    throw invalid();
  }
}
type Row = {
  product_id: string;
  draft_id: string;
  revision: number;
  canonical_content_text: string | null;
  canonical_content_sha256: string;
  asset_set_text: string | null;
  asset_set_sha256: string;
  resource_count: number;
  content_schema_version: string;
  content_kind: string;
  content_version: string;
  visual_version: string;
  report_version: string;
  resource_version: string;
  component_version: string;
  engine_id: string;
  engine_version: string;
};
/** Same immutable revision source and existing per-alias/blob guard; no latest-draft substitution. */
export async function readCurrentPreviewSource(
  tx: postgres.TransactionSql,
  scope: PreviewScope,
) {
  await productRow(tx, scope.productId);
  const [row] = await tx<
    Row[]
  >`SELECT product_id,draft_id,revision,canonical_content_sha256,asset_set_sha256,resource_count,
    CASE WHEN octet_length(canonical_content_text)<=2097152 THEN canonical_content_text END canonical_content_text,
    CASE WHEN octet_length(asset_set_text)<=65536 THEN asset_set_text END asset_set_text,
    content_schema_version,content_kind,content_version,visual_version,report_version,resource_version,component_version,engine_id,engine_version
    FROM qf.draft_revision WHERE product_id=${scope.productId} AND draft_id=${scope.draftId} AND revision=${scope.revision}`;
  if (!row) throw new StudioError("DRAFT_REVISION_NOT_FOUND");
  if (row.content_schema_version === "quizpack-content.v2")
    return {
      mode: "legacy" as const,
      ...(await readFixedPreviewSource(tx, scope)),
    };
  if (
    row.content_schema_version !== "quizpack-content.v3" ||
    row.product_id !== scope.productId ||
    row.draft_id !== scope.draftId ||
    row.revision !== scope.revision
  )
    throw invalid();
  const parsed = parseCurrentContent(
    checked(
      row.canonical_content_text,
      row.canonical_content_sha256,
      DRAFT_LIMITS.contentBytes,
    ),
  );
  if (!parsed.ok || parsed.value.schemaVersion !== "quizpack-content.v3")
    throw invalid();
  const c = parsed.value,
    m = readContentMetadata(c);
  if (
    m.schemaVersion !== row.content_schema_version ||
    m.productId !== scope.productId ||
    m.kind !== row.content_kind ||
    m.contentVersion !== row.content_version ||
    m.visualVersion !== row.visual_version ||
    m.reportVersion !== row.report_version ||
    m.resourceVersion !== row.resource_version ||
    m.componentVersion !== row.component_version ||
    m.engine.id !== row.engine_id ||
    m.engine.version !== row.engine_version
  )
    throw invalid();
  const ledger = assetSetLedgerSchema.safeParse(
    checked(
      row.asset_set_text,
      row.asset_set_sha256,
      DRAFT_LIMITS.assetSetBytes,
    ),
  );
  if (
    !ledger.success ||
    ledger.data.productId !== scope.productId ||
    ledger.data.resources.length !== row.resource_count ||
    ledger.data.resources.length !== m.resources.length
  )
    throw invalid();
  for (const resource of m.resources) {
    const member = ledger.data.resources.find(
      (r) =>
        r.productId === resource.productId &&
        r.resourceId === resource.id &&
        r.resourceVersion === resource.version,
    );
    if (
      !member ||
      member.blobSha256 !== resource.sha256 ||
      member.declarationSha256 !== hash(canonicalV2(resource))
    )
      throw invalid();
    const resolved = await resolveFixedPreviewResource(tx, scope, resource);
    if (
      resolved.binding.canonicalContentSha256 !==
        row.canonical_content_sha256 ||
      resolved.binding.assetSetSha256 !== row.asset_set_sha256
    )
      throw new StudioError("PREVIEW_BINDING_MISMATCH");
    const r = resolved.resource;
    if (
      r.sha256 !== resource.sha256 ||
      r.bytes !== resource.bytes ||
      r.mediaType !== resource.mediaType ||
      r.width !== resource.width ||
      r.height !== resource.height
    )
      throw new StudioError("PREVIEW_RESOURCE_UNAVAILABLE");
  }
  return {
    mode: "structured" as const,
    content: c,
    binding: previewBindingV2Schema.parse({
      ...scope,
      schemaVersion: "quizforge.preview-binding.v2",
      canonicalContentSha256: row.canonical_content_sha256,
      assetSetSha256: row.asset_set_sha256,
      renderer: PREVIEW_RENDERER_V2,
      font: STRUCTURED_FONT_V2,
    }),
  };
}
