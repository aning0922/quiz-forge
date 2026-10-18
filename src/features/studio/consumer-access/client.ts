import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  ConsumerClientError,
  requestConsumerJson,
  type ConsumerFetch,
} from "@/features/theme/consumer-v1/request";
import {
  createInternalPlayBindingSchema,
  internalPlayListSchema,
  verifyInternalPlayDetail,
  type CreateInternalPlayBinding,
} from "@/features/product/internal-play/contracts";
import {
  issueAccessKeyBindingSchema,
  voidUnusedAccessKeyBindingSchema,
  accessKeyCursorSchema,
  accessKeyListSchema,
  verifyAccessKeyDetail,
  type IssueAccessKeyBinding,
  type VoidUnusedAccessKeyBinding,
  type AccessKeyCursor,
} from "@/features/fulfillment/access/contracts";
import {
  verifyInternalPlayResolution,
  verifyIssueAccessKeyResolution,
  verifyVoidUnusedAccessKeyResolution,
} from "@/features/fulfillment/consumer-flow/operator-resolutions";
import {
  internalPlaysUrl,
  internalPlayUrl,
  internalPlayResolveUrl,
  accessKeysUrl,
  accessKeyUrl,
  accessKeyIssueResolveUrl,
  accessKeyVoidUrl,
  accessKeyVoidResolveUrl,
} from "@/features/fulfillment/consumer-flow/urls";
import {
  checkKeyIssuedV1,
  checkPlayCreatedV1,
  checkPlayReceiptV1,
} from "./facts";
export type StudioConsumerContextV1 = Readonly<{
  signal: AbortSignal;
  csrf: string;
  fetcher?: ConsumerFetch;
  onAuthorityFailure?: (error: ConsumerClientError) => void;
}>;
const transportContext = (c: StudioConsumerContextV1) => ({
  signal: c.signal,
  ...(c.fetcher ? { fetcher: c.fetcher } : {}),
  ...(c.onAuthorityFailure ? { onAuthorityFailure: c.onAuthorityFailure } : {}),
});
const readOptions = (c: StudioConsumerContextV1, maximum: number) => ({
  ...transportContext(c),
  method: "GET" as const,
  maximum,
  statuses: [200],
});
const postOptions = (
  c: StudioConsumerContextV1,
  body: unknown,
  maximum: number,
  create = false,
) => ({
  signal: c.signal,
  ...(c.fetcher ? { fetcher: c.fetcher } : {}),
  ...(c.onAuthorityFailure ? { onAuthorityFailure: c.onAuthorityFailure } : {}),
  method: "POST" as const,
  body,
  headers: { "x-csrf-token": c.csrf },
  maximum,
  statuses: create ? [200, 201] : [200],
});
export function createStudioPlayV1(
  input: CreateInternalPlayBinding,
  c: StudioConsumerContextV1,
) {
  const binding = createInternalPlayBindingSchema.parse(input);
  return requestConsumerJson(
    internalPlaysUrl(binding.parent.productId),
    postOptions(c, binding, L.operationReceiptBytes, true),
    (v, status) => checkPlayCreatedV1(v, status, binding),
  );
}
export function resolveStudioPlayV1(
  input: CreateInternalPlayBinding,
  c: StudioConsumerContextV1,
) {
  const binding = createInternalPlayBindingSchema.parse(input);
  return requestConsumerJson(
    internalPlayResolveUrl(binding.parent.productId),
    postOptions(c, binding, L.operationReceiptBytes),
    (v) => verifyInternalPlayResolution(v, binding),
  );
}
export function readStudioPlaysV1(
  productId: string,
  c: StudioConsumerContextV1,
) {
  return requestConsumerJson(
    internalPlaysUrl(productId),
    readOptions(c, L.playListResponseBytes),
    async (input) => {
      const value = internalPlayListSchema.parse(input);
      if (value.productId !== productId)
        throw new ConsumerClientError("UNAVAILABLE");
      await Promise.all(value.versions.map(checkPlayReceiptV1));
      return value;
    },
  );
}
export function readStudioPlayV1(
  productId: string,
  playId: string,
  c: StudioConsumerContextV1,
) {
  return requestConsumerJson(
    internalPlayUrl(productId, playId),
    readOptions(c, L.playSnapshotBytes + L.operationReceiptBytes),
    async (input) => {
      const value = await verifyInternalPlayDetail(input);
      if (
        value.play.id !== playId ||
        value.snapshot.parent.productId !== productId
      )
        throw new ConsumerClientError("UNAVAILABLE");
      return value;
    },
  );
}
export function issueStudioKeyV1(
  input: IssueAccessKeyBinding,
  c: StudioConsumerContextV1,
) {
  const binding = issueAccessKeyBindingSchema.parse(input);
  return requestConsumerJson(
    accessKeysUrl(binding.play.productId),
    postOptions(c, binding, L.operationReceiptBytes, true),
    (v, status) => checkKeyIssuedV1(v, status, binding),
  );
}
export function resolveStudioIssueV1(
  input: IssueAccessKeyBinding,
  c: StudioConsumerContextV1,
) {
  const binding = issueAccessKeyBindingSchema.parse(input);
  return requestConsumerJson(
    accessKeyIssueResolveUrl(binding.play.productId),
    postOptions(c, binding, L.operationReceiptBytes),
    (v) => verifyIssueAccessKeyResolution(v, binding),
  );
}
export function voidStudioKeyV1(
  input: VoidUnusedAccessKeyBinding,
  c: StudioConsumerContextV1,
  resolve = false,
) {
  const binding = voidUnusedAccessKeyBindingSchema.parse(input);
  return requestConsumerJson(
    resolve
      ? accessKeyVoidResolveUrl(binding.productId)
      : accessKeyVoidUrl(binding.productId, binding.keyId),
    postOptions(c, binding, L.operationReceiptBytes),
    (v) => verifyVoidUnusedAccessKeyResolution(v, binding),
  );
}
export function readStudioKeysV1(
  productId: string,
  c: StudioConsumerContextV1,
  cursor: AccessKeyCursor | null = null,
) {
  const selected = cursor === null ? null : accessKeyCursorSchema.parse(cursor);
  if (selected && selected.productId !== productId)
    throw new ConsumerClientError("INVALID_REQUEST");
  const query = selected
    ? "?" +
      new URLSearchParams({
        issuedAt: selected.issuedAt,
        keyId: selected.keyId,
      }).toString()
    : "";
  return requestConsumerJson(
    accessKeysUrl(productId) + query,
    readOptions(c, L.keyListResponseBytes),
    async (input) => {
      const value = accessKeyListSchema.parse(input);
      if (value.productId !== productId)
        throw new ConsumerClientError("UNAVAILABLE");
      await Promise.all(value.keys.map(verifyAccessKeyDetail));
      return value;
    },
  );
}
export function readStudioKeyV1(
  productId: string,
  keyId: string,
  c: StudioConsumerContextV1,
) {
  return requestConsumerJson(
    accessKeyUrl(productId, keyId),
    readOptions(c, L.operationReceiptBytes),
    async (input) => {
      const value = await verifyAccessKeyDetail(input);
      if (
        value.issue.binding.play.productId !== productId ||
        value.issue.binding.keyId !== keyId
      )
        throw new ConsumerClientError("UNAVAILABLE");
      return value;
    },
  );
}
