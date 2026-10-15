import "server-only";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { StudioError } from "@/lib/http-security/errors";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  quizPackContentSchema,
  type ContentReference,
} from "@/features/quizpack/v1/content";
import {
  parseSupportedContent,
  type SupportedContent,
} from "@/features/quizpack/content/supported";
import { validateParsedContentReferences } from "@/features/quizpack/content/references";
import { assetSetLedgerSchema } from "@/features/quizpack/validation/repository";
import { productRow } from "../workspace/repository";
import { DRAFT_LIMITS } from "../drafts/contracts";
import { PREVIEW_FONT, PREVIEW_RENDERER } from "./descriptor";
import {
  previewBindingSchema,
  type PreviewBinding,
  type PreviewScope,
} from "./contracts";

type Tx = postgres.TransactionSql;
type Revision = {
  product_id: string;
  draft_id: string;
  revision: number;
  canonical_content_sha256: string;
  asset_set_sha256: string;
  resource_count: number;
  asset_set_text: string | null;
};
type Body = Revision & {
  canonical_content_text: string | null;
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
type AssetRow = {
  product_id: string;
  resource_id: string;
  resource_version: string;
  blob_sha256: string;
  declaration_text: string;
  declaration_sha256: string;
  purpose: string;
  platform_approval: string;
  blob_hash: string;
  blob_bytes: number;
  media_type: string;
  width: number;
  height: number;
  frames: number;
  storage_key: string;
};
export type ResolvedPreviewResource = Readonly<{
  resourceRef: ContentReference;
  sha256: string;
  bytes: number;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
}>;
const unavailable = () => new StudioError("PREVIEW_RESOURCE_UNAVAILABLE");
const invalid = () => new StudioError("PREVIEW_UNSUPPORTED");
const hash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const refKey = (r: ContentReference) =>
  JSON.stringify([r.productId, r.id, r.version]);
function checkedJson(
  text: string | null,
  sha: string,
  maximum: number,
): unknown {
  if (
    text === null ||
    Buffer.byteLength(text, "utf8") > maximum ||
    hash(text) !== sha
  )
    throw invalid();
  try {
    const parsed: unknown = JSON.parse(text);
    if (canonicalP1Json(parsed, "content") !== text) throw invalid();
    return parsed;
  } catch {
    throw invalid();
  }
}
export function fixedPreviewBinding(row: Revision): PreviewBinding {
  const value = previewBindingSchema.safeParse({
    productId: row.product_id,
    draftId: row.draft_id,
    revision: row.revision,
    canonicalContentSha256: row.canonical_content_sha256,
    assetSetSha256: row.asset_set_sha256,
    renderer: PREVIEW_RENDERER,
    font: PREVIEW_FONT,
  });
  if (!value.success) throw invalid();
  return value.data;
}
function ledger(row: Revision) {
  const parsed = assetSetLedgerSchema.safeParse(
    checkedJson(
      row.asset_set_text,
      row.asset_set_sha256,
      DRAFT_LIMITS.assetSetBytes,
    ),
  );
  if (
    !parsed.success ||
    parsed.data.productId !== row.product_id ||
    parsed.data.resources.length !== row.resource_count
  )
    throw invalid();
  return parsed.data;
}
async function storedResource(
  tx: Tx,
  productId: string,
  member: ReturnType<typeof ledger>["resources"][number],
) {
  // Alias rows intentionally retain their FIRST validation source; it is not this revision's authority.
  const rows = await tx<
    AssetRow[]
  >`SELECT p.product_id,p.resource_id,p.resource_version,p.blob_sha256,
    p.declaration_text,p.declaration_sha256,p.purpose,p.platform_approval,b.sha256 AS blob_hash,
    b.bytes AS blob_bytes,b.media_type,b.width,b.height,b.frames,b.storage_key
    FROM qf.product_asset p JOIN qf.asset_blob b ON b.sha256=p.blob_sha256
    WHERE p.product_id=${productId} AND p.resource_id=${member.resourceId} AND p.resource_version=${member.resourceVersion}
      AND p.blob_sha256=${member.blobSha256} AND p.declaration_sha256=${member.declarationSha256} LIMIT 2`;
  const s = rows[0];
  if (rows.length !== 1 || !s) throw unavailable();
  let declaration: unknown;
  try {
    declaration = checkedJson(
      s.declaration_text,
      member.declarationSha256,
      65536,
    );
  } catch {
    throw unavailable();
  }
  const parsed =
    quizPackContentSchema.shape.resources.element.safeParse(declaration);
  if (!parsed.success) throw unavailable();
  const r = parsed.data;
  if (
    r.productId !== productId ||
    r.id !== member.resourceId ||
    r.version !== member.resourceVersion ||
    r.sha256 !== member.blobSha256 ||
    s.blob_hash !== r.sha256 ||
    s.blob_bytes !== r.bytes ||
    s.media_type !== r.mediaType ||
    s.width !== r.width ||
    s.height !== r.height ||
    s.frames !== 1 ||
    s.purpose !== r.purpose ||
    s.platform_approval !== "unverified" ||
    s.storage_key !== `blobs/${r.sha256}.blob`
  )
    throw unavailable();
  return r;
}
export async function readFixedPreviewSource(
  tx: Tx,
  scope: PreviewScope,
): Promise<{ binding: PreviewBinding; content: SupportedContent }> {
  await productRow(tx, scope.productId);
  const [row] = await tx<
    Body[]
  >`SELECT product_id,draft_id,revision,canonical_content_sha256,asset_set_sha256,resource_count,
    CASE WHEN octet_length(canonical_content_text)<=2097152 THEN canonical_content_text END canonical_content_text,
    CASE WHEN octet_length(asset_set_text)<=65536 THEN asset_set_text END asset_set_text,
    content_schema_version,content_kind,content_version,visual_version,report_version,resource_version,component_version,engine_id,engine_version
    FROM qf.draft_revision WHERE product_id=${scope.productId} AND draft_id=${scope.draftId} AND revision=${scope.revision}`;
  if (!row) throw new StudioError("DRAFT_REVISION_NOT_FOUND");
  const binding = fixedPreviewBinding(row),
    set = ledger(row);
  const parsed = parseSupportedContent(
    checkedJson(
      row.canonical_content_text,
      row.canonical_content_sha256,
      DRAFT_LIMITS.contentBytes,
    ),
  );
  if (!parsed.ok) throw invalid();
  const c = parsed.value;
  if (
    c.schemaVersion !== "quizpack-content.v2" ||
    c.schemaVersion !== row.content_schema_version ||
    c.kind !== row.content_kind ||
    c.product.productId !== scope.productId ||
    c.contentVersion !== row.content_version ||
    c.visualVersion !== row.visual_version ||
    c.reportVersion !== row.report_version ||
    c.resourceVersion !== row.resource_version ||
    c.componentVersion !== row.component_version ||
    c.engine.id !== row.engine_id ||
    c.engine.version !== row.engine_version ||
    validateParsedContentReferences(c, scope.productId).length ||
    c.resources.length !== set.resources.length
  )
    throw invalid();
  const members = new Map(
    set.resources.map((r) => [
      JSON.stringify([r.productId, r.resourceId, r.resourceVersion]),
      r,
    ]),
  );
  for (const resource of c.resources) {
    const member = members.get(refKey(resource));
    if (
      !member ||
      member.blobSha256 !== resource.sha256 ||
      member.declarationSha256 !== hash(canonicalP1Json(resource))
    )
      throw invalid();
    const stored = await storedResource(tx, scope.productId, member);
    if (canonicalP1Json(stored) !== canonicalP1Json(resource))
      throw unavailable();
  }
  return { binding, content: c };
}
/** Image requests read only fixed metadata + asset set + exactly one declared alias/blob. */
export async function resolveFixedPreviewResource(
  tx: Tx,
  scope: PreviewScope,
  ref: ContentReference,
) {
  await productRow(tx, scope.productId);
  const [row] = await tx<
    Revision[]
  >`SELECT product_id,draft_id,revision,canonical_content_sha256,asset_set_sha256,resource_count,
    CASE WHEN octet_length(asset_set_text)<=65536 THEN asset_set_text END asset_set_text
    FROM qf.draft_revision WHERE product_id=${scope.productId} AND draft_id=${scope.draftId} AND revision=${scope.revision}`;
  if (!row) throw new StudioError("DRAFT_REVISION_NOT_FOUND");
  const binding = fixedPreviewBinding(row),
    set = ledger(row);
  const member = set.resources.find(
    (r) =>
      r.productId === ref.productId &&
      r.resourceId === ref.id &&
      r.resourceVersion === ref.version,
  );
  if (!member || ref.productId !== scope.productId) throw unavailable();
  const r = await storedResource(tx, scope.productId, member);
  const resource: ResolvedPreviewResource = {
    resourceRef: { productId: r.productId, id: r.id, version: r.version },
    sha256: r.sha256,
    bytes: r.bytes,
    mediaType: r.mediaType,
    width: r.width,
    height: r.height,
  };
  return { binding, resource };
}
