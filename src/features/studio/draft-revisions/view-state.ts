import {
  draftRevisionHistorySchema,
  type AppendDraftBinding,
  type DraftRevisionHistory,
} from "@/features/product/draft-revisions/contracts";
import type { DraftSummaryDto } from "@/features/product/drafts/contracts";
export function matchesAppendSelection(
  binding: AppendDraftBinding,
  source: {
    productId: string;
    importId: string;
    id: string;
    stateRevision: number;
    candidateSha256: string | null;
  },
  base: DraftSummaryDto,
) {
  return (
    binding.productId === source.productId &&
    binding.productId === base.productId &&
    binding.sourceImportId === source.importId &&
    binding.sourceValidationId === source.id &&
    binding.expectedValidationStateRevision === source.stateRevision &&
    binding.expectedCandidateSha256 === source.candidateSha256 &&
    binding.target.draftId === base.draftId &&
    binding.target.expectedRevision === base.revision &&
    binding.target.expectedCanonicalContentSha256 ===
      base.canonicalContentSha256 &&
    binding.target.expectedAssetSetSha256 === base.assetSetSha256
  );
}
export function joinRevisionHistory(
  previous: readonly DraftRevisionHistory[],
  input: DraftRevisionHistory,
): readonly DraftRevisionHistory[] {
  const next = draftRevisionHistorySchema.parse(input),
    last = previous.at(-1);
  if (
    last &&
    (last.productId !== next.productId ||
      last.draftId !== next.draftId ||
      last.anchorRevision !== next.anchorRevision ||
      last.pageSize !== next.pageSize ||
      last.nextBeforeRevision !== next.beforeRevision)
  )
    throw Error("HISTORY_ANCHOR_CHANGED");
  if (
    previous.reduce((count, p) => count + p.items.length, 0) +
      next.items.length >
    100
  )
    throw Error("HISTORY_LIMIT");
  return [...previous, next];
}
