import { z } from "zod";
import { assessmentIdSchema } from "@/lib/assessment-contract/primitives";
import { importIdSchema } from "@/features/quizpack/import/contracts";
export const internalRevisionScopeSchema = z.strictObject({
  productId: assessmentIdSchema.refine((v) => !/[\r\n]/.test(v)),
  draftId: importIdSchema.length(36),
  revision: z.number().int().min(1).max(100),
});
export type InternalRevisionScope = z.infer<typeof internalRevisionScopeSchema>;
const product = (id: unknown) =>
  `/api/studio/products/${internalRevisionScopeSchema.shape.productId.parse(id)}`;
export function internalReviewUrl(input: InternalRevisionScope) {
  const s = internalRevisionScopeSchema.parse(input);
  return `${product(s.productId)}/drafts/${s.draftId}/revisions/${s.revision}/internal-review`;
}
export const internalReviewResolveUrl = (productId: string) =>
  `${product(productId)}/internal-review-applications/resolve`;
export const internalVersionResolveUrl = (productId: string) =>
  `${product(productId)}/internal-version-applications/resolve`;
export const internalVersionsUrl = (productId: string) =>
  `${product(productId)}/internal-versions`;
export const internalVersionUrl = (productId: string, versionId: string) =>
  `${internalVersionsUrl(productId)}/${importIdSchema.length(36).parse(versionId)}`;
export function internalReviewPageUrl(input: InternalRevisionScope) {
  const s = internalRevisionScopeSchema.parse(input);
  return `/studio/products/${s.productId}/drafts/${s.draftId}/revisions/${s.revision}/internal-review`;
}
export function internalRevisionParam(value: unknown): number {
  const text = z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
    .parse(value);
  return Number(text);
}
