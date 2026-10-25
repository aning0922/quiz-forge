import { CONSUMER_PROTOCOLS_V1 } from "@/lib/consumer-contract/v1/identities";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY } from "./implementation-catalog";

/**
 * The unauthenticated platform gateway is a build-time choice. It does not
 * select, upgrade or override the renderer stored in an authenticated play.
 */
export const CONSUMER_ACCESS_GATEWAY = Object.freeze({
  renderer: CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1_2,
  protocol: CONSUMER_PROTOCOLS_V1.access,
  sourcePath: "src/features/theme/consumer-v1-1/access.tsx",
  exportName: "ConsumerAccessV1_1",
});
