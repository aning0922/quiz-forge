import "server-only";
import { bindEngineV2 } from "./implementations/engine-v2";
import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "@/features/theme/preview/v3-projection";
import {
  engineImplementationAvailableV2,
  rendererImplementationAvailableV2,
  findEngineImplementationDescriptorV2,
  findRendererImplementationDescriptorV2,
  implementationIdentityV2,
} from "./implementation-catalog-v2";
import {
  projectQianzaiEntry,
  projectQianzaiResult,
} from "@/features/theme/qianzai-tongxin/projection";
import { QIANZAI_PREVIEW_RENDERER } from "@/features/theme/qianzai-tongxin/component-map";

const engine = bindEngineV2({ id: "archetype-l1", version: "1.0.0" });
export function resolveEngineImplementationV2(input: unknown) {
  if (!engineImplementationAvailableV2(input)) return null;
  const entry = findEngineImplementationDescriptorV2(input)!;
  return Object.freeze({
    identity: implementationIdentityV2(entry),
    descriptor: entry.descriptor,
    ...engine,
  });
}
export function resolveRendererServerV2(input: unknown) {
  if (!rendererImplementationAvailableV2(input)) return null;
  const entry = findRendererImplementationDescriptorV2(input)!;
  const qianzai = entry.descriptor.id === QIANZAI_PREVIEW_RENDERER.id;
  return Object.freeze({
    identity: implementationIdentityV2(entry),
    descriptor: entry.descriptor,
    requiresPreferenceScene: qianzai,
    projectEntry: qianzai ? projectQianzaiEntry : projectContentEntryV3,
    projectResult: qianzai ? projectQianzaiResult : projectPreparedResultV3,
  });
}
