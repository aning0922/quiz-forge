import type { ConsumerSessionRef } from "@/lib/consumer-contract/v1/primitives";
import {
  consumerSaveInputSchema,
  consumerSaveBindingSchema,
  verifyConsumerSaveInput,
} from "@/lib/consumer-contract/v1/state";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  CONSUMER_EXCHANGE_HEADER_V1,
  CONSUMER_EXCHANGE_HEADER_VALUE_V1,
} from "@/lib/consumer-contract/v1/credentials";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import {
  consumerExchangeInputSchema,
  consumerExchangeResultSchema,
  verifyConsumerSessionView,
  verifyConsumerSaveResolution,
  verifyConsumerCompleteResolution,
} from "@/features/fulfillment/consumer-flow/contracts";
import { verifyConsumerEntryView } from "@/features/fulfillment/consumer-flow/display-contract";
import {
  consumerCompleteBindingSchema,
  verifyPersistedReportView,
  type PersistedReportReceipt,
} from "@/features/report/persisted/view-contracts";
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
} from "./request";
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
export async function exchangeConsumerAccessV1(
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
export const readConsumerSessionV1 = (
  sessionId: string,
  context: ReadContext,
) =>
  requestConsumerJson(
    consumerSessionUrl(sessionId),
    options(context, L.stateResponseBytes),
    (input) => verifyConsumerSessionView(input, sessionId),
  );
export const readConsumerEntryV1 = (
  session: ConsumerSessionRef,
  context: ReadContext,
) =>
  requestConsumerJson(
    consumerEntryUrl(session.sessionId),
    options(context, L.entryResponseBytes),
    (input) => verifyConsumerEntryView(input, session),
  );
export async function saveConsumerStateV1(
  input: unknown,
  context: WriteContext,
) {
  const value = await verifyConsumerSaveInput(
    consumerSaveInputSchema.parse(input),
  );
  return requestConsumerJson(
    consumerSaveUrl(value.binding.session.sessionId),
    {
      ...options(context, L.stateResponseBytes, "POST"),
      csrf: context.csrf,
      body: value,
    },
    (result) => verifyConsumerSaveResolution(result, value.binding),
  );
}
export async function resolveConsumerSaveV1(
  input: unknown,
  context: WriteContext,
) {
  const binding = consumerSaveBindingSchema.parse(input);
  return requestConsumerJson(
    consumerSaveResolveUrl(binding.session.sessionId),
    {
      ...options(context, L.stateResponseBytes, "POST"),
      csrf: context.csrf,
      body: binding,
    },
    (result) => verifyConsumerSaveResolution(result, binding),
  );
}
export async function completeConsumerStateV1(
  input: unknown,
  context: WriteContext,
  resolve = false,
) {
  const binding = consumerCompleteBindingSchema.parse(input),
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
    (result) => verifyConsumerCompleteResolution(result, binding),
  );
}
export async function readConsumerReportV1(
  session: ConsumerSessionRef,
  receipt: PersistedReportReceipt,
  context: ReadContext,
) {
  return requestConsumerJson(
    consumerReportUrl(session.sessionId),
    options(context, L.reportResponseBytes),
    async (input) => {
      const value = await verifyPersistedReportView(input);
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
export const logoutConsumerV1 = (sessionId: string, context: WriteContext) =>
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
