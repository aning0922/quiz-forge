import { createHash } from "node:crypto";
import {
  draftApplicationFingerprint,
  type DraftApplicationBinding,
  type DraftSummaryDto,
} from "@/features/product/drafts/contracts";
export const tuple: DraftApplicationBinding = {
  productId: "synthetic-draft",
  sourceImportId: "11111111-1111-4111-8111-111111111111",
  sourceValidationId: "22222222-2222-4222-8222-222222222222",
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
  expectedValidationStateRevision: 4,
  expectedCandidateSha256: "a".repeat(64),
  target: { kind: "new-draft" },
};
export const textHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const summary: DraftSummaryDto = {
  productId: tuple.productId,
  draftId: "44444444-4444-4444-8444-444444444444",
  revision: 1,
  applicationId: "55555555-5555-4555-8555-555555555555",
  sourceImportId: tuple.sourceImportId,
  sourceValidationId: tuple.sourceValidationId,
  canonicalContentSha256: textHash("{}"),
  assetSetSha256: textHash("[]"),
  canonicalManifestSha256: "b".repeat(64),
  candidateSha256: tuple.expectedCandidateSha256,
  containerSchemaVersion: "quizpack.v1",
  contentSchemaVersion: "quizpack-content.v1",
  contentKind: "synthetic",
  packId: "synthetic-pack",
  packVersion: "1.0.0",
  versions: {
    contentVersion: "1.0.0",
    visualVersion: "1.0.0",
    reportVersion: "1.0.0",
    resourceVersion: "1.0.0",
    componentVersion: "1.0.0",
    engine: { id: "archetype", version: "1.0.0" },
  },
  resourceCount: 1,
  createdAt: "2026-10-15T00:00:00.000Z",
  createdBy: "66666666-6666-4666-8666-666666666666",
  platformApproval: "unverified",
  publishable: false,
};
export async function receipt() {
  const { idempotencyKey: _key, ...input } = tuple;
  void _key;
  return {
    ...summary,
    ...tuple,
    fingerprint: await draftApplicationFingerprint(input),
  };
}
export function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}
