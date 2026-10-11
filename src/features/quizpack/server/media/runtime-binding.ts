import "server-only";
import { mediaStopFailureCode } from "./contracts";
import type {
  MediaOperationContext,
  MediaRuntimeBindingResult,
} from "./contracts";
import { readMediaOperationState } from "./operation-context";

/** The platform/deployment verifier is delivered by the following migration.
 * No source-only or unsealed identity can authorize execution in this milestone. */
export async function readMediaRuntimeBinding(
  context: MediaOperationContext,
): Promise<MediaRuntimeBindingResult> {
  try {
    const state = readMediaOperationState(context);
    if (state.phase === "stopping")
      return {
        outcome: "unavailable",
        code: mediaStopFailureCode(state.stop) as Extract<
          MediaRuntimeBindingResult,
          { outcome: "unavailable" }
        >["code"],
      };
    return { outcome: "unavailable", code: "ISOLATION_UNAVAILABLE" };
  } catch {
    return { outcome: "unavailable", code: "INVALID_INPUT" };
  }
}
