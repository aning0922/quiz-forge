import {
  draftApplicationScopeSchema,
  draftIdSchema,
} from "@/features/product/drafts/contracts";
import {
  DRAFT_REVISION_LIMITS,
  draftRevisionHistoryQuerySchema,
  type AppendDraftBinding,
  type DraftRevisionHistoryQuery,
} from "@/features/product/draft-revisions/contracts";

export function appendRevisionEndpoint(binding: AppendDraftBinding) {
  const s = draftApplicationScopeSchema.parse({
    productId: binding.productId,
    sourceImportId: binding.sourceImportId,
    sourceValidationId: binding.sourceValidationId,
  });
  return `/api/studio/products/${encodeURIComponent(s.productId)}/imports/${encodeURIComponent(s.sourceImportId)}/validations/${encodeURIComponent(s.sourceValidationId)}/draft-revisions`;
}
export function resolveRevisionEndpoint(productId: string) {
  const id = draftApplicationScopeSchema.shape.productId.parse(productId);
  return `/api/studio/products/${encodeURIComponent(id)}/draft/revision-applications/resolve`;
}
export function revisionHistoryEndpoint(
  productId: string,
  draftId: string,
  input: DraftRevisionHistoryQuery,
) {
  const id = draftApplicationScopeSchema.shape.productId.parse(productId),
    draft = draftIdSchema.parse(draftId),
    query = draftRevisionHistoryQuerySchema.parse(input);
  const parameters = new URLSearchParams({ pageSize: String(query.pageSize) });
  if (query.anchorRevision !== undefined)
    parameters.set("anchorRevision", String(query.anchorRevision));
  if (query.beforeRevision !== undefined)
    parameters.set("beforeRevision", String(query.beforeRevision));
  return `/api/studio/products/${encodeURIComponent(id)}/drafts/${encodeURIComponent(draft)}/revisions?${parameters}`;
}
/** Only canonical decimal scalars; no coerce, duplicates, extra fields or new per-body budget. */
export function parseRevisionHistoryQuery(url: URL): DraftRevisionHistoryQuery {
  if (
    new TextEncoder().encode(url.search).byteLength >
    DRAFT_REVISION_LIMITS.queryBytes
  )
    throw Error("INVALID_HISTORY_QUERY");
  const value: Record<string, number> = {};
  for (const [key, text] of url.searchParams) {
    if (
      !["pageSize", "anchorRevision", "beforeRevision"].includes(key) ||
      Object.hasOwn(value, key) ||
      !/^[1-9][0-9]{0,2}$/.test(text)
    )
      throw Error("INVALID_HISTORY_QUERY");
    value[key] = Number(text);
  }
  return draftRevisionHistoryQuerySchema.parse(value);
}
