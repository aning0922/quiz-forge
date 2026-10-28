import "server-only";
import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "@/features/theme/preview/v3-projection";
import {
  consumerImplementationAvailableV2,
  findConsumerImplementationDescriptorV2,
  consumerImplementationIdentityV2,
} from "./implementation-catalog-v2";
import {
  projectQianzaiEntry,
  projectQianzaiResult,
} from "@/features/theme/qianzai-tongxin/projection";
import { QIANZAI_CONSUMER_RENDERER } from "@/features/theme/qianzai-tongxin/component-map";

/** Source projection only; caller still proves parent, authorization, engine and transaction facts. */
export function resolveConsumerImplementationV2(input: unknown) {
  if (!consumerImplementationAvailableV2(input)) return null;
  const entry = findConsumerImplementationDescriptorV2(input)!;
  const qianzai = entry.descriptor.id === QIANZAI_CONSUMER_RENDERER.id;
  return Object.freeze({
    identity: consumerImplementationIdentityV2(entry),
    descriptor: entry.descriptor,
    requiresPreferenceScene: qianzai,
    projectEntry: qianzai ? projectQianzaiEntry : projectContentEntryV3,
    projectResult: qianzai ? projectQianzaiResult : projectPreparedResultV3,
  });
}
