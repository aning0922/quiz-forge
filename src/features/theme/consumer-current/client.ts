import { verifyConsumerSessionView } from "@/features/fulfillment/consumer-flow/contracts";
import { verifyConsumerSessionViewV2 } from "@/features/fulfillment/consumer-flow/contracts-v2";
import { consumerSessionUrl } from "@/features/fulfillment/consumer-flow/urls";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  ConsumerClientError,
  requestConsumerJson,
  type ConsumerFetch,
} from "../consumer-v1/request";

/** Only an authorized, verified fixed-session observation selects the protocol. No parse-failure fallback. */
export async function readConsumerProtocol(
  sessionId: string,
  context: { signal: AbortSignal; fetcher?: ConsumerFetch },
): Promise<"v1" | "v2"> {
  return requestConsumerJson(
    consumerSessionUrl(sessionId),
    {
      ...context,
      method: "GET",
      maximum: L.stateResponseBytes,
      statuses: [200],
    },
    async (input) => {
      if (!input || typeof input !== "object" || !("schemaVersion" in input))
        throw new ConsumerClientError("UNAVAILABLE");
      switch (input.schemaVersion) {
        case "quizforge.consumer-session-view.v1":
          await verifyConsumerSessionView(input, sessionId);
          return "v1";
        case "quizforge.consumer-session-view.v2":
          await verifyConsumerSessionViewV2(input, sessionId);
          return "v2";
        default:
          throw new ConsumerClientError("UNAVAILABLE");
      }
    },
  );
}
