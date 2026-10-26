import "server-only";
import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "@/features/theme/preview/v3-projection";
import {
  CONSUMER_IMPLEMENTATION_AVAILABILITY_V2,
  consumerImplementationAvailableV2,
  findConsumerImplementationDescriptorV2,
} from "./implementation-catalog-v2";

/** Source projection only; caller still proves parent, authorization, engine and transaction facts. */
export function resolveConsumerImplementationV2(input: unknown) {
  if (!consumerImplementationAvailableV2(input)) return null;
  const entry = findConsumerImplementationDescriptorV2(input)!;
  return Object.freeze({
    identity: CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.structured,
    descriptor: entry.descriptor,
    projectEntry: projectContentEntryV3,
    projectResult: projectPreparedResultV3,
  });
}
