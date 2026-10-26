import "server-only";
import { bindEngineV2 } from "./implementations/engine-v2";
import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "@/features/theme/preview/v3-projection";
import {
  IMPLEMENTATION_AVAILABILITY_V2,
  engineImplementationAvailableV2,
  rendererImplementationAvailableV2,
  findEngineImplementationDescriptorV2,
  findRendererImplementationDescriptorV2,
} from "./implementation-catalog-v2";

const engine = bindEngineV2({ id: "archetype-l1", version: "1.0.0" });
export function resolveEngineImplementationV2(input: unknown) {
  if (!engineImplementationAvailableV2(input)) return null;
  const entry = findEngineImplementationDescriptorV2(input)!;
  return Object.freeze({
    identity: IMPLEMENTATION_AVAILABILITY_V2.engine,
    descriptor: entry.descriptor,
    ...engine,
  });
}
export function resolveRendererServerV2(input: unknown) {
  if (!rendererImplementationAvailableV2(input)) return null;
  const entry = findRendererImplementationDescriptorV2(input)!;
  return Object.freeze({
    identity: IMPLEMENTATION_AVAILABILITY_V2.renderer,
    descriptor: entry.descriptor,
    projectEntry: projectContentEntryV3,
    projectResult: projectPreparedResultV3,
  });
}
