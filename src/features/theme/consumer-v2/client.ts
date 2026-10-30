import {
  consumerExchangeInputSchema,
  consumerExchangeResultSchema,
} from "@/features/fulfillment/consumer-flow/contracts";
import { consumerCompleteBindingV2Schema } from "@/lib/consumer-contract/v2/state";
import type { ConsumerSessionRef } from "@/lib/consumer-contract/v1/primitives";
import {
  consumerSaveInputV2Schema,
  consumerSaveBindingV2Schema,
  verifyConsumerSaveInputV2,
} from "@/lib/consumer-contract/v2/state";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  CONSUMER_EXCHANGE_HEADER_V1,
  CONSUMER_EXCHANGE_HEADER_VALUE_V1,
} from "@/lib/consumer-contract/v1/credentials";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import {
  verifyConsumerSessionViewV2,
  verifyConsumerSaveResolutionV2,
  verifyConsumerCompleteResolutionV2,
} from "@/features/fulfillment/consumer-flow/contracts-v2";
import { verifyConsumerEntryViewV2 } from "@/features/fulfillment/consumer-flow/display-contract-v2";
import {
  verifyPersistedReportViewV2,
  type PersistedReportReceiptV2,
} from "@/features/report/persisted/view-contracts-v2";
import {
  consumerExchangeUrl,
  consumerSessionUrl,
  consumerEntryUrl,
  consumerSaveUrl,
  consumerSaveResolveUrl,
  consumerCompleteUrl,
  consumerCompleteResolveUrl,
  consumerReportUrl,
  consumerLogoutUrl,
} from "@/features/fulfillment/consumer-flow/urls";
import {
  ConsumerClientError,
  requestConsumerJson,
  type ConsumerFetch,
} from "../consumer-v1/request";
type ReadContext = Readonly<{
  signal: AbortSignal;
  fetcher?: ConsumerFetch;
  onAuthorityFailure?: (error: ConsumerClientError) => void;
}>;
type WriteContext = ReadContext & Readonly<{ csrf: string }>;
const options = (
  context: ReadContext,
  maximum: number,
  method: "GET" | "POST" = "GET",
) => ({ ...context, maximum, method, statuses: [200] });

/** Raw stays only in this request's memory; errors never attach input/response/URL values. */
export async function exchangeConsumerAccessV2(
  rawKey: string,
  context: ReadContext,
) {
  let body: ReturnType<typeof consumerExchangeInputSchema.parse>;
  try {
    body = consumerExchangeInputSchema.parse({ rawKey });
  } catch {
    throw new ConsumerClientError("INVALID_REQUEST");
  }
  return requestConsumerJson(
    consumerExchangeUrl,
    {
      ...options(context, L.operationRequestBytes, "POST"),
      body,
      headers: {
        [CONSUMER_EXCHANGE_HEADER_V1]: CONSUMER_EXCHANGE_HEADER_VALUE_V1,
      },
    },
    (input) => consumerExchangeResultSchema.parse(input),
  );
}
export const readConsumerSessionV2 = (
  sessionId: string,
  context: ReadContext,
) =>
  requestConsumerJson(
    consumerSessionUrl(sessionId),
    options(context, L.stateResponseBytes),
    (input) => verifyConsumerSessionViewV2(input, sessionId),
  );
export const readConsumerEntryV2 = (
  session: ConsumerSessionRef,
  context: ReadContext,
) =>
  requestConsumerJson(
    consumerEntryUrl(session.sessionId),
    options(context, L.entryResponseBytes),
    (input) => verifyConsumerEntryViewV2(input, session),
  );
export async function saveConsumerStateV2(
  input: unknown,
  context: WriteContext,
) {
  const value = await verifyConsumerSaveInputV2(
    consumerSaveInputV2Schema.parse(input),
  );
  return requestConsumerJson(
    consumerSaveUrl(value.binding.session.sessionId),
    {
      ...options(context, L.stateResponseBytes, "POST"),
      csrf: context.csrf,
      body: value,
    },
    (result) => verifyConsumerSaveResolutionV2(result, value.binding),
  );
}
export async function resolveConsumerSaveV2(
  input: unknown,
  context: WriteContext,
) {
  const binding = consumerSaveBindingV2Schema.parse(input);
  return requestConsumerJson(
    consumerSaveResolveUrl(binding.session.sessionId),
    {
      ...options(context, L.stateResponseBytes, "POST"),
      csrf: context.csrf,
      body: binding,
    },
    (result) => verifyConsumerSaveResolutionV2(result, binding),
  );
}
export async function completeConsumerStateV2(
  input: unknown,
  context: WriteContext,
  resolve = false,
) {
  const binding = consumerCompleteBindingV2Schema.parse(input),
    url = resolve
      ? consumerCompleteResolveUrl(binding.session.sessionId)
      : consumerCompleteUrl(binding.session.sessionId);
  return requestConsumerJson(
    url,
    {
      ...options(context, L.stateResponseBytes, "POST"),
      csrf: context.csrf,
      body: binding,
    },
    (result) => verifyConsumerCompleteResolutionV2(result, binding),
  );
}
export async function readConsumerReportV2(
  session: ConsumerSessionRef,
  receipt: PersistedReportReceiptV2,
  context: ReadContext,
) {
  return requestConsumerJson(
    consumerReportUrl(session.sessionId),
    options(context, L.reportResponseBytes),
    async (input) => {
      const value = await verifyPersistedReportViewV2(input);
      if (
        !sameConsumerFact(
          value.view.session,
          session,
          L.operationRequestBytes,
        ) ||
        !sameConsumerFact(value.receipt, receipt, L.operationReceiptBytes)
      )
        throw new ConsumerClientError("UNAVAILABLE");
      return value;
    },
  );
}
export const logoutConsumerV2 = (sessionId: string, context: WriteContext) =>
  requestConsumerJson(
    consumerLogoutUrl(sessionId),
    {
      ...options(context, L.operationRequestBytes, "POST"),
      statuses: [204],
      csrf: context.csrf,
      body: {},
    },
    () => undefined,
  );
