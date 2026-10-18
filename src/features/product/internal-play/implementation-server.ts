import "server-only";
import { consumerRendererIdentitySchema } from "@/lib/consumer-contract/v1/identities";
import {
  findConsumerImplementationDescriptor,
  consumerImplementationAvailable,
} from "./implementation-catalog";
import { CONSUMER_SERVER_DISPLAY_V1 } from "@/features/theme/consumer-v1/renderer-server-v1";
/** Source/projection only: caller still owns actual parent, authorization, engine and transaction proof. */
export function resolveConsumerImplementation(input: unknown) {
  const parsed = consumerRendererIdentitySchema.safeParse(input);
  if (!parsed.success || !consumerImplementationAvailable(parsed.data))
    return null;
  const entry = findConsumerImplementationDescriptor(parsed.data);
  if (!entry) return null;
  return Object.freeze({
    identity: Object.freeze(parsed.data),
    descriptor: entry.descriptor,
    ...CONSUMER_SERVER_DISPLAY_V1,
  });
}
