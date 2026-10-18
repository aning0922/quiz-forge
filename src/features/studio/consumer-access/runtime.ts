import "server-only";
import { createConsumerRequestOwner } from "@/features/fulfillment/consumer-flow/request-owner";
import { createInternalPlayService } from "@/features/product/internal-play/service";
import { createAccessKeyService } from "@/features/fulfillment/access/service";
import {
  handleStudioConsumerHttpV1,
  type StudioConsumerEndpointV1,
} from "./http";

/** Composition only: real factories share the handler's one original request clock/owner. */
export function handleStudioConsumerRouteV1(
  request: Request,
  endpoint: StudioConsumerEndpointV1,
  startedAt: number,
) {
  return handleStudioConsumerHttpV1(
    request,
    endpoint,
    {
      createOwner: createConsumerRequestOwner,
      createPlayService: createInternalPlayService,
      createAccessService: createAccessKeyService,
    },
    startedAt,
  );
}
