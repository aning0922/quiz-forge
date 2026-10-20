import { summary, tuple as first } from "../drafts/fixtures.test-support";
import {
  appendDraftFingerprint,
  fingerprintInputFromAppendBinding,
  type AppendDraftBinding,
  type AppendDraftApplication,
} from "@/features/product/draft-revisions/contracts";
import type { DraftSummaryDto } from "@/features/product/drafts/contracts";
export const tuple: AppendDraftBinding = {
  ...first,
  sourceImportId: "55555555-5555-4555-8555-555555555555",
  sourceValidationId: "66666666-6666-4666-8666-666666666666",
  target: {
    kind: "append-revision",
    draftId: summary.draftId,
    expectedRevision: 1,
    expectedCanonicalContentSha256: summary.canonicalContentSha256,
    expectedAssetSetSha256: summary.assetSetSha256,
  },
};
export const base: DraftSummaryDto = { ...summary };
export async function receipt(
  input: AppendDraftBinding = tuple,
): Promise<AppendDraftApplication> {
  return {
    ...summary,
    productId: input.productId,
    sourceImportId: input.sourceImportId,
    sourceValidationId: input.sourceValidationId,
    draftId: input.target.draftId,
    revision: input.target.expectedRevision + 1,
    candidateSha256: input.expectedCandidateSha256,
    idempotencyKey: input.idempotencyKey,
    expectedValidationStateRevision: input.expectedValidationStateRevision,
    expectedCandidateSha256: input.expectedCandidateSha256,
    target: input.target,
    fingerprint: await appendDraftFingerprint(
      fingerprintInputFromAppendBinding(input),
    ),
  };
}
export async function observation(
  kind: "unresolved" | "not-applied-obsolete" = "unresolved",
) {
  return {
    kind,
    binding: tuple,
    fingerprint: await appendDraftFingerprint(
      fingerprintInputFromAppendBinding(tuple),
    ),
    base,
    observedCurrentRevision: kind === "unresolved" ? 1 : 2,
  };
}
export function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
