import "server-only";
import { randomUUID } from "node:crypto";
import {
  mediaStopFailureCode,
  type ImageDeclaration,
  type LaunchResult,
  type MediaOperationContext,
  type MediaRuntimeBindingResult,
} from "./contracts";
import {
  readMediaOperationState,
  requestMediaOperationStop,
} from "./operation-context";
import { parseLaunchResult, parseMediaRuntimeBinding } from "./evidence";
import { createTrustedMediaRuntime } from "./internal/runtime";
import { fixedMediaRuntimeRoots } from "./internal/runtime-location";
let runtime: ReturnType<typeof createTrustedMediaRuntime> | undefined;
function ordinaryRuntime() {
  return (runtime ??= createTrustedMediaRuntime(fixedMediaRuntimeRoots()));
}
function before(
  context: MediaOperationContext,
): Extract<MediaRuntimeBindingResult, { outcome: "unavailable" }> | null {
  try {
    const state = readMediaOperationState(context);
    return state.phase === "stopping"
      ? { outcome: "unavailable", code: mediaStopFailureCode(state.stop) }
      : null;
  } catch {
    return { outcome: "unavailable", code: "INVALID_INPUT" };
  }
}
function unknown(context: MediaOperationContext) {
  try {
    requestMediaOperationStop(context, "STOP_UNCONFIRMED");
  } catch {
    /* In-flight runtime retains disposed context's authority. */
  }
  return { outcome: "unavailable", code: "STOP_UNCONFIRMED" } as const;
}
const bindingUnavailable = new Set([
  "INVALID_INPUT",
  "CANCELLED",
  "DEADLINE_EXCEEDED",
  "UNSUPPORTED_PLATFORM",
  "ISOLATION_UNAVAILABLE",
  "WORKER_FAILED",
  "STOP_UNCONFIRMED",
]);
function validBindingResult(value: MediaRuntimeBindingResult): boolean {
  if (!value || typeof value !== "object") return false;
  if (value.outcome === "bound")
    return (
      Object.keys(value).sort().join() === "binding,outcome" &&
      parseMediaRuntimeBinding(Buffer.from(JSON.stringify(value.binding))).ok
    );
  return (
    value.outcome === "unavailable" &&
    Object.keys(value).sort().join() === "code,outcome" &&
    bindingUnavailable.has(value.code)
  );
}
export async function readMediaRuntimeBinding(
  context: MediaOperationContext,
): Promise<MediaRuntimeBindingResult> {
  const unavailable = before(context);
  if (unavailable) return unavailable;
  let entry: ReturnType<typeof createTrustedMediaRuntime>;
  try {
    entry = ordinaryRuntime();
  } catch {
    return (
      before(context) ?? {
        outcome: "unavailable",
        code: "ISOLATION_UNAVAILABLE",
      }
    );
  }
  try {
    const result = await entry.readBinding(context, "sealed");
    if (!validBindingResult(result)) return unknown(context);
    if (result.outcome === "unavailable" && result.code === "STOP_UNCONFIRMED")
      unknown(context);
    const final = before(context);
    if (final?.code === "STOP_UNCONFIRMED") return final;
    return result;
  } catch {
    return unknown(context);
  }
}
const failed = (
  code: Extract<MediaRuntimeBindingResult, { outcome: "unavailable" }>["code"],
): LaunchResult => ({
  outcome: "failed",
  runId: randomUUID(),
  profileId: null,
  code,
  stopped: code === "STOP_UNCONFIRMED" ? "unknown" : "not-started",
});
/** Fixed compiler locator and mandatory seal; ordinary callers cannot select a root or mode. */
export async function runFixedIsolatedImage(
  bytes: Uint8Array,
  declaration: ImageDeclaration,
  context: MediaOperationContext,
): Promise<LaunchResult> {
  const unavailable = before(context);
  if (unavailable) return failed(unavailable.code);
  let entry: ReturnType<typeof createTrustedMediaRuntime>;
  try {
    entry = ordinaryRuntime();
  } catch {
    return failed(before(context)?.code ?? "ISOLATION_UNAVAILABLE");
  }
  try {
    const result = await entry.run(bytes, declaration, context, "sealed");
    const parsed = parseLaunchResult(Buffer.from(JSON.stringify(result)));
    if (!parsed.ok) return failed(unknown(context).code);
    if (
      parsed.value.outcome === "failed" &&
      parsed.value.code === "STOP_UNCONFIRMED"
    )
      unknown(context);
    if (before(context)?.code === "STOP_UNCONFIRMED")
      return {
        outcome: "failed",
        runId: parsed.value.runId,
        profileId: parsed.value.profileId,
        code: "STOP_UNCONFIRMED",
        stopped: "unknown",
      };
    return parsed.value;
  } catch {
    return failed(unknown(context).code);
  }
}
