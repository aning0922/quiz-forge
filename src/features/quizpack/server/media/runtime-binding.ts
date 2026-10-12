import "server-only";
import { randomUUID } from "node:crypto";
import {
  mediaStopFailureCode,
  type ImageDeclaration,
  type LaunchResult,
  type MediaOperationContext,
  type MediaRuntimeBindingResult,
} from "./contracts";
import { readMediaOperationState } from "./operation-context";
import { createTrustedMediaRuntime } from "./internal/runtime";
import { fixedMediaRuntimeRoots } from "./internal/runtime-location";
let runtime: ReturnType<typeof createTrustedMediaRuntime> | undefined;
function ordinaryRuntime() {
  return (runtime ??= createTrustedMediaRuntime(fixedMediaRuntimeRoots()));
}
function before(
  context: MediaOperationContext,
): MediaRuntimeBindingResult | null {
  try {
    const state = readMediaOperationState(context);
    if (state.phase === "stopping")
      return { outcome: "unavailable", code: mediaStopFailureCode(state.stop) };
    return null;
  } catch {
    return { outcome: "unavailable", code: "INVALID_INPUT" };
  }
}
export async function readMediaRuntimeBinding(
  context: MediaOperationContext,
): Promise<MediaRuntimeBindingResult> {
  const unavailable = before(context);
  if (unavailable) return unavailable;
  try {
    return await ordinaryRuntime().readBinding(context, "sealed");
  } catch {
    return (
      before(context) ?? {
        outcome: "unavailable",
        code: "ISOLATION_UNAVAILABLE",
      }
    );
  }
}
/** Fixed compiler locator and mandatory seal; ordinary callers cannot select a root or mode. */
export async function runFixedIsolatedImage(
  bytes: Uint8Array,
  declaration: ImageDeclaration,
  context: MediaOperationContext,
): Promise<LaunchResult> {
  const unavailable = before(context);
  try {
    if (!unavailable)
      return await ordinaryRuntime().run(bytes, declaration, context, "sealed");
  } catch {
    /* Undefined build macros fail closed, without an env/cwd fallback. */
  }
  const final = unavailable ?? before(context);
  const code =
    final?.outcome === "unavailable" ? final.code : "ISOLATION_UNAVAILABLE";
  return {
    outcome: "failed",
    runId: randomUUID(),
    profileId: null,
    code,
    stopped: code === "STOP_UNCONFIRMED" ? "unknown" : "not-started",
  };
}
