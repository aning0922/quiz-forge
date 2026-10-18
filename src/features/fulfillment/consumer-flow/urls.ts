import {
  consumerIdSchema,
  consumerUuidSchema,
} from "@/lib/consumer-contract/v1/primitives";
import {
  consumerResourceSelectorSchema,
  type ConsumerResourceSelector,
} from "./display-contract";
const product = (productId: string) =>
  `/api/studio/products/${consumerIdSchema.parse(productId)}`;
export const consumerAccessPageUrl = "/access";
export const consumerExchangeUrl = "/access/exchange";
export const consumerPlayPageUrl = (sessionId: string) =>
  `/play/${consumerUuidSchema.parse(sessionId)}`;
export const consumerReportPageUrl = (sessionId: string) =>
  `${consumerPlayPageUrl(sessionId)}/report`;
export const consumerSessionUrl = (sessionId: string) =>
  `${consumerPlayPageUrl(sessionId)}/api/session`;
export const consumerEntryUrl = (sessionId: string) =>
  `${consumerPlayPageUrl(sessionId)}/api/entry`;
export const consumerSaveUrl = (sessionId: string) =>
  `${consumerPlayPageUrl(sessionId)}/api/save`;
export const consumerSaveResolveUrl = (sessionId: string) =>
  `${consumerSaveUrl(sessionId)}/resolve`;
export const consumerCompleteUrl = (sessionId: string) =>
  `${consumerPlayPageUrl(sessionId)}/api/complete`;
export const consumerCompleteResolveUrl = (sessionId: string) =>
  `${consumerCompleteUrl(sessionId)}/resolve`;
export const consumerReportUrl = (sessionId: string) =>
  `${consumerPlayPageUrl(sessionId)}/api/report`;
export const consumerLogoutUrl = (sessionId: string) =>
  `${consumerPlayPageUrl(sessionId)}/api/logout`;
export function consumerResourceUrl(
  sessionId: string,
  input: ConsumerResourceSelector,
) {
  const s = consumerResourceSelectorSchema.parse(input);
  const query = new URLSearchParams({
    resourceId: s.resourceId,
    resourceVersion: s.resourceVersion,
    sha256: s.sha256,
  });
  return `${consumerPlayPageUrl(sessionId)}/api/resources?${query}`;
}
export const internalPlaysUrl = (productId: string) =>
  `${product(productId)}/play-versions`;
export const internalPlayUrl = (productId: string, playId: string) =>
  `${internalPlaysUrl(productId)}/${consumerUuidSchema.parse(playId)}`;
export const internalPlayResolveUrl = (productId: string) =>
  `${product(productId)}/play-version-applications/resolve`;
export const accessKeysUrl = (productId: string) =>
  `${product(productId)}/access-keys`;
export const accessKeyUrl = (productId: string, keyId: string) =>
  `${accessKeysUrl(productId)}/${consumerUuidSchema.parse(keyId)}`;
export const accessKeyVoidUrl = (productId: string, keyId: string) =>
  `${accessKeyUrl(productId, keyId)}/void`;
export const accessKeyIssueResolveUrl = (productId: string) =>
  `${product(productId)}/access-key-applications/resolve`;
export const accessKeyVoidResolveUrl = (productId: string) =>
  `${product(productId)}/access-key-void-applications/resolve`;
