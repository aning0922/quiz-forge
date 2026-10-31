import { z } from "zod";
import { createElement, type ComponentType } from "react";
import type { ConsumerExperiencePropsV2 } from "@/features/theme/consumer-v2/interfaces";
import { QIANZAI_PRESENTATION_V11 } from "@/features/report/qianzai-tongxin/role-profiles-v11";
import { ConsumerExperienceV2 } from "@/features/theme/consumer-v2/host";
import { consumerRendererIdentitySchema } from "@/lib/consumer-contract/v1/identities";
import {
  consumerComponentMappingV2Schema,
  consumerFontIdentityV2Schema,
} from "@/lib/consumer-contract/v2/identities";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerImplementationAvailableV2,
  findConsumerImplementationDescriptorV2,
  consumerImplementationIdentityV2,
} from "./implementation-catalog-v2";
import { QianzaiTongxinRuntime } from "@/features/theme/qianzai-tongxin/runtime";
import { QIANZAI_CONSUMER_RENDERER } from "@/features/theme/qianzai-tongxin/component-map";

// Only exact installed entries reach this cache. Stable component identity keeps
// the controller's reading/resource owners mounted through ordinary updates.
const qianzaiRuntimes = new Map<
  string,
  ComponentType<ConsumerExperiencePropsV2>
>();
function boundQianzaiRuntime(
  identity: ReturnType<typeof consumerImplementationIdentityV2>,
) {
  let runtime = qianzaiRuntimes.get(identity.entrySha256);
  if (!runtime) {
    const presentationBinding = Object.freeze({
      renderer: identity,
      profileVersion: QIANZAI_PRESENTATION_V11,
    });
    runtime = function QianzaiRegisteredRuntime(
      props: ConsumerExperiencePropsV2,
    ) {
      return createElement(QianzaiTongxinRuntime, {
        ...props,
        presentationBinding,
      });
    };
    qianzaiRuntimes.set(identity.entrySha256, runtime);
  }
  return runtime;
}

export function resolveConsumerRendererClientV2(input: unknown) {
  if (!consumerImplementationAvailableV2(input)) return null;
  const entry = findConsumerImplementationDescriptorV2(input)!;
  const identity = consumerImplementationIdentityV2(entry);
  return Object.freeze({
    identity,
    descriptor: entry.descriptor,
    Experience:
      entry.descriptor.id === QIANZAI_CONSUMER_RENDERER.id
        ? boundQianzaiRuntime(identity)
        : ConsumerExperienceV2,
  });
}
const runtimeFactsSchema = z.strictObject({
  renderer: consumerRendererIdentitySchema,
  mapping: consumerComponentMappingV2Schema,
  font: consumerFontIdentityV2Schema,
});
/** No nearest-version fallback; all facts must match one exact compiled descriptor. */
export function resolveConsumerExperienceRuntimeV2(input: unknown) {
  const parsed = runtimeFactsSchema.safeParse(input);
  if (!parsed.success) return null;
  const runtime = resolveConsumerRendererClientV2(parsed.data.renderer);
  if (
    !runtime ||
    !sameConsumerFact(
      parsed.data.mapping,
      runtime.descriptor.mapping,
      L.playRequestBytes,
    ) ||
    !sameConsumerFact(
      parsed.data.font,
      "kind" in runtime.descriptor.font
        ? runtime.descriptor.font
        : {
            id: runtime.descriptor.font.id,
            version: runtime.descriptor.font.version,
            weight: runtime.descriptor.font.weight,
            fileSha256: runtime.descriptor.font.fileSha256,
            coverageSha256: runtime.descriptor.font.coverageSha256,
            licenseSha256: runtime.descriptor.font.licenseSha256,
          },
      L.operationRequestBytes,
    )
  )
    return null;
  return runtime;
}
