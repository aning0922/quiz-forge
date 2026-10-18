import "server-only";
import { createConsumerRequestOwner } from "../request-owner";
import { createConsumerFlowService } from "../service";
import { handleConsumerHttp, type ConsumerHttpEndpoint } from "./handler";

/** Actual factories only. Resource transfer and final closure remain with the original owner. */
export function handleConsumerRouteV1(
  request: Request,
  endpoint: ConsumerHttpEndpoint,
  startedAt: number,
) {
  return handleConsumerHttp(
    request,
    endpoint,
    {
      createOwner: createConsumerRequestOwner,
      createService: createConsumerFlowService,
    },
    startedAt,
  );
}
