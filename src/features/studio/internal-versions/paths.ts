import {
  internalRevisionScopeSchema,
  internalReviewPageUrl,
} from "@/features/product/internal-versions/urls";
import { importIdSchema } from "@/features/quizpack/import/contracts";
export { internalReviewPageUrl };
export const internalVersionsPageUrl = (productId: string) =>
  `/studio/products/${internalRevisionScopeSchema.shape.productId.parse(productId)}/internal-versions`;
export const internalVersionPageUrl = (productId: string, versionId: string) =>
  `${internalVersionsPageUrl(productId)}/${importIdSchema.length(36).parse(versionId)}`;
