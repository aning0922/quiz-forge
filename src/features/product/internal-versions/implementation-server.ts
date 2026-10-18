import "server-only";
import { projectContentScoreForDisplay } from "@/features/theme/preview/result-projection";
import { bindEngineV1 } from "./implementations/engine-v1";
import {
  rendererIdentitySchema,
  engineIdentitySchema,
} from "./identity-contracts";
import {
  findRendererImplementationDescriptor,
  findEngineImplementationDescriptor,
  rendererImplementationAvailable,
  engineImplementationAvailable,
} from "./implementation-catalog";
const engines = Object.freeze({
  archetype: bindEngineV1({ id: "archetype", version: "1.0.0" }),
  dimensions: bindEngineV1({ id: "dimensions", version: "1.0.0" }),
});
export function resolveRendererServer(input: unknown) {
  const parsed = rendererIdentitySchema.safeParse(input);
  if (!parsed.success || !rendererImplementationAvailable(parsed.data))
    return null;
  const entry = findRendererImplementationDescriptor(parsed.data);
  if (!entry) return null;
  return Object.freeze({
    identity: parsed.data,
    descriptor: entry.descriptor,
    projectResult: projectContentScoreForDisplay,
  });
}
export function resolveEngineImplementation(input: unknown) {
  const parsed = engineIdentitySchema.safeParse(input);
  if (!parsed.success || !engineImplementationAvailable(parsed.data))
    return null;
  const entry = findEngineImplementationDescriptor(parsed.data);
  if (!entry) return null;
  return Object.freeze({
    identity: parsed.data,
    descriptor: entry.descriptor,
    ...engines[entry.descriptor.algorithm.id],
  });
}
