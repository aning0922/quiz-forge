import "server-only";
import { randomUUID } from "node:crypto";
import type {
  ImageDeclaration,
  LaunchResult,
  MediaOperationContext,
} from "./contracts";
import { readMediaRuntimeBinding } from "./runtime-binding";

export * from "./contracts";
export {
  mediaRuntimeBindingSchema,
  launchResultSchema,
  parseMediaRuntimeBinding,
  parseLaunchResult,
  MEDIA_EVIDENCE_LIMITS,
} from "./evidence";
export {
  createMediaOperationContext,
  disposeMediaOperationContext,
  readMediaOperationState,
  requestMediaOperationStop,
} from "./operation-context";
export { readMediaRuntimeBinding } from "./runtime-binding";

/** Fixed public entry. Until platform migration is complete every call fails closed. */
export async function runIsolatedImage(
  _bytes: Uint8Array,
  _declaration: ImageDeclaration,
  context: MediaOperationContext,
): Promise<LaunchResult> {
  const runId = randomUUID();
  const binding = await readMediaRuntimeBinding(context);
  return {
    outcome: "failed",
    runId,
    profileId: null,
    code:
      binding.outcome === "unavailable"
        ? binding.code
        : "ISOLATION_UNAVAILABLE",
    stopped: "not-started",
  };
}
